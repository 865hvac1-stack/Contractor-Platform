import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequences";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { assignPlaybookToJob } from "@/lib/playbooks/assign";
import { evaluateCapacity } from "@/lib/scheduling/capacity-engine";
import { loadCapacitySnapshot, loadSchedulingPolicy } from "@/lib/scheduling/capacity";
import { confirmationMessage, suggestedBookingMessage } from "@/lib/scheduling/templates";
import { zonedLocalDateTime } from "@/lib/scheduling/time";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";

type Db = typeof prisma | Prisma.TransactionClient;

export type BookAppointmentInput = {
  companyId: string;
  customerId: string;
  propertyId?: string | null;
  serviceTypeId?: string | null;
  date: string;
  windowId: string;
  technicianId?: string | null;
  source: "AUTO" | "MANUAL" | "CONVERSATION" | "MAINTENANCE";
  actorId?: string | null;
  threadId?: string | null;
  inboundMessageId?: string | null;
  idempotencyKey: string;
  maintenanceVisitId?: string | null;
  description?: string | null;
  allowEmergencyReserve?: boolean;
  sendConfirmation?: boolean;
  maintenance?: boolean;
};

export type BookAppointmentResult =
  | {
      ok: true;
      committed: boolean;
      jobId: string;
      technicianId: string;
      windowId: string;
      date: string;
      confirmationStatus: "SENT" | "FAILED" | "PENDING" | "SKIPPED";
      confirmationBody?: string;
      duplicate: boolean;
    }
  | { ok: false; error: string; code: "NO_CAPACITY" | "NOT_FOUND" | "DUPLICATE_MAINTENANCE" | "VALIDATION" };

async function existingByIdempotency(db: Db, companyId: string, key: string) {
  return db.schedulingBooking.findFirst({
    where: { companyId, idempotencyKey: key },
    include: { job: true, window: true },
  });
}

export async function bookAppointment(input: BookAppointmentInput): Promise<BookAppointmentResult> {
  await ensureSchedulingSetup(prisma, input.companyId);
  const existing = await existingByIdempotency(prisma, input.companyId, input.idempotencyKey);
  if (existing?.job && existing.job.status !== "CANCELED") {
    return {
      ok: true,
      committed: true,
      jobId: existing.jobId,
      technicianId: existing.technicianUserId,
      windowId: existing.windowId,
      date: existing.localDate.toISOString().slice(0, 10),
      confirmationStatus: (existing.confirmationStatus as "SENT" | "FAILED" | "PENDING" | "SKIPPED") ?? "SKIPPED",
      duplicate: true,
    };
  }

  if (input.maintenanceVisitId) {
    const visit = await prisma.maintenanceVisit.findFirst({
      where: { id: input.maintenanceVisitId, companyId: input.companyId },
      include: { job: true },
    });
    if (visit?.jobId && visit.job && visit.job.status !== "CANCELED") {
      await writeAudit({
        companyId: input.companyId,
        actorId: input.actorId,
        action: "scheduling.maintenance_duplicate_prevented",
        entityType: "MaintenanceVisit",
        entityId: visit.id,
        metadata: { existingJobId: visit.jobId },
      });
      return { ok: false, error: "A maintenance visit is already scheduled for this cycle.", code: "DUPLICATE_MAINTENANCE" };
    }
  }

  const company = await prisma.company.findFirst({
    where: { id: input.companyId },
    select: { id: true, timezone: true, industry: true },
  });
  if (!company) return { ok: false, error: "Company not found.", code: "NOT_FOUND" };

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId },
    include: { properties: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
  });
  if (!customer) return { ok: false, error: "Customer not found.", code: "NOT_FOUND" };
  const property =
    (input.propertyId
      ? customer.properties.find((row) => row.id === input.propertyId)
      : customer.properties.find((row) => row.isPrimary) ?? customer.properties[0]) ?? null;
  if (!property) return { ok: false, error: "Customer has no property to schedule.", code: "VALIDATION" };

  const window = await prisma.appointmentWindow.findFirst({
    where: { id: input.windowId, companyId: input.companyId, active: true },
  });
  if (!window) return { ok: false, error: "Appointment window not found.", code: "NOT_FOUND" };

  const policy = await loadSchedulingPolicy(prisma, input.companyId);
  const serviceType = input.serviceTypeId
    ? await prisma.serviceType.findFirst({ where: { id: input.serviceTypeId, companyId: input.companyId } })
    : input.maintenance && policy.maintenanceServiceTypeId
      ? await prisma.serviceType.findFirst({ where: { id: policy.maintenanceServiceTypeId, companyId: input.companyId } })
      : policy.defaultServiceTypeId
        ? await prisma.serviceType.findFirst({ where: { id: policy.defaultServiceTypeId, companyId: input.companyId } })
        : await prisma.serviceType.findFirst({
            where: { companyId: input.companyId, active: true, archivedAt: null },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          });

  const jobNumber = await nextNumber(input.companyId, "JOB", "JOB");

  let booked: {
    jobId: string;
    technicianId: string;
    windowId: string;
    date: string;
    rankingReason: Prisma.InputJsonValue;
  } | null = null;

  try {
    booked = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.companyId}), hashtext(${`${input.date}:${input.windowId}`}))`;
      const replay = await existingByIdempotency(tx, input.companyId, input.idempotencyKey);
      if (replay?.job && replay.job.status !== "CANCELED") {
        return {
          jobId: replay.jobId,
          technicianId: replay.technicianUserId,
          windowId: replay.windowId,
          date: replay.localDate.toISOString().slice(0, 10),
          rankingReason: (replay.rankingReason as Prisma.InputJsonValue) ?? {},
        };
      }

      const snapshot = await loadCapacitySnapshot(tx, input.companyId, [input.date]);
      const availability = evaluateCapacity(snapshot, {
        companyId: input.companyId,
        date: input.date,
        appointmentWindowId: input.windowId,
        serviceTypeId: serviceType?.id,
        technicianId: input.technicianId,
        maintenance: input.maintenance,
        allowEmergencyReserve: input.allowEmergencyReserve,
      });
      const choice = availability.options[0];
      if (!choice) throw new Error("NO_CAPACITY");

      const usedSlots = snapshot.bookings
        .filter((row) => row.technicianId === choice.technicianId && row.windowId === choice.windowId && row.date === input.date)
        .length;
      const start = zonedLocalDateTime(company.timezone, input.date, window.startMinutes);
      const end = zonedLocalDateTime(company.timezone, input.date, window.endMinutes);

      const job = await tx.job.create({
        data: {
          companyId: input.companyId,
          customerId: customer.id,
          propertyId: property.id,
          jobNumber,
          jobType: serviceType?.name || (input.maintenance ? "Maintenance" : "Service"),
          serviceTypeId: serviceType?.id ?? null,
          trade: company.industry,
          status: "SCHEDULED",
          source: input.source === "MANUAL" ? "office-schedule" : "conversation-auto",
          description: input.description || serviceType?.description || null,
          scheduledStart: start,
          scheduledEnd: end,
          arrivalWindowStart: start,
          arrivalWindowEnd: end,
          appointmentWindowId: window.id,
          bookedByContractorYou: true,
          schedulingIdempotencyKey: input.idempotencyKey,
          assignments: { create: { userId: choice.technicianId } },
        },
      });

      await tx.schedulingBooking.create({
        data: {
          companyId: input.companyId,
          jobId: job.id,
          windowId: window.id,
          technicianUserId: choice.technicianId,
          localDate: new Date(`${input.date}T00:00:00.000Z`),
          slotIndex: usedSlots,
          source: input.source,
          idempotencyKey: input.idempotencyKey,
          inboundMessageId: input.inboundMessageId,
          threadId: input.threadId,
          maintenanceVisitId: input.maintenanceVisitId,
          confirmationStatus: input.sendConfirmation === false ? "SKIPPED" : "PENDING",
          autoAssigned: !input.technicianId,
          rankingReason: choice.ranking as Prisma.InputJsonValue,
        },
      });

      if (input.maintenanceVisitId) {
        await tx.maintenanceVisit.updateMany({
          where: { id: input.maintenanceVisitId, companyId: input.companyId, jobId: null },
          data: { jobId: job.id, status: "SCHEDULED" },
        });
      }

      return {
        jobId: job.id,
        technicianId: choice.technicianId,
        windowId: window.id,
        date: input.date,
        rankingReason: choice.ranking as Prisma.InputJsonValue,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await existingByIdempotency(prisma, input.companyId, input.idempotencyKey);
      if (replay) {
        return {
          ok: true,
          committed: true,
          jobId: replay.jobId,
          technicianId: replay.technicianUserId,
          windowId: replay.windowId,
          date: replay.localDate.toISOString().slice(0, 10),
          confirmationStatus: "SKIPPED",
          duplicate: true,
        };
      }
    }
    if (error instanceof Error && error.message === "NO_CAPACITY") {
      return { ok: false, error: "That window no longer has available capacity.", code: "NO_CAPACITY" };
    }
    throw error;
  }

  if (!booked) return { ok: false, error: "Booking failed.", code: "VALIDATION" };

  if (serviceType?.playbookId) {
    await assignPlaybookToJob({
      companyId: input.companyId,
      jobId: booked.jobId,
      playbookId: serviceType.playbookId,
    }).catch(() => null);
  }

  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: input.source === "MANUAL" ? "scheduling.manual_booked" : "scheduling.auto_booked",
    entityType: "Job",
    entityId: booked.jobId,
    metadata: {
      technicianId: booked.technicianId,
      windowId: booked.windowId,
      date: booked.date,
      source: input.source,
      ranking: booked.rankingReason,
      maintenanceVisitId: input.maintenanceVisitId ?? null,
    },
  });

  if (input.sendConfirmation === false) {
    return {
      ok: true,
      committed: true,
      jobId: booked.jobId,
      technicianId: booked.technicianId,
      windowId: booked.windowId,
      date: booked.date,
      confirmationStatus: "SKIPPED",
      confirmationBody: suggestedBookingMessage({
        dateKey: booked.date,
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
        timeZone: company.timezone,
      }),
      duplicate: false,
    };
  }

  const tech = await prisma.user.findFirst({
    where: { id: booked.technicianId },
    select: { firstName: true, lastName: true },
  });
  const body = confirmationMessage({
    policy,
    dateKey: booked.date,
    startMinutes: window.startMinutes,
    endMinutes: window.endMinutes,
    technicianName: tech ? `${tech.firstName} ${tech.lastName}`.trim() : null,
    timeZone: company.timezone,
  });

  if (!customer.phone) {
    await markConfirmationFailed(input.companyId, booked.jobId, "Customer has no phone number.");
    return {
      ok: true,
      committed: true,
      jobId: booked.jobId,
      technicianId: booked.technicianId,
      windowId: booked.windowId,
      date: booked.date,
      confirmationStatus: "FAILED",
      confirmationBody: body,
      duplicate: false,
    };
  }

  const sent = await sendCompanyCommunication({
    companyId: input.companyId,
    channel: "SMS",
    to: customer.phone,
    body,
    customerId: customer.id,
  });

  if (!sent.ok) {
    await markConfirmationFailed(input.companyId, booked.jobId, sent.error || "Confirmation SMS failed.");
    return {
      ok: true,
      committed: true,
      jobId: booked.jobId,
      technicianId: booked.technicianId,
      windowId: booked.windowId,
      date: booked.date,
      confirmationStatus: "FAILED",
      confirmationBody: body,
      duplicate: false,
    };
  }

  await prisma.schedulingBooking.updateMany({
    where: { jobId: booked.jobId, companyId: input.companyId },
    data: { confirmationStatus: "SENT", confirmationError: null },
  });
  await prisma.job.update({
    where: { id: booked.jobId },
    data: { confirmationFailed: false },
  });

  return {
    ok: true,
    committed: true,
    jobId: booked.jobId,
    technicianId: booked.technicianId,
    windowId: booked.windowId,
    date: booked.date,
    confirmationStatus: "SENT",
    confirmationBody: body,
    duplicate: false,
  };
}

async function markConfirmationFailed(companyId: string, jobId: string, error: string) {
  await prisma.job.update({ where: { id: jobId }, data: { confirmationFailed: true } });
  await prisma.schedulingBooking.updateMany({
    where: { jobId, companyId },
    data: { confirmationStatus: "FAILED", confirmationError: error },
  });
  const existing = await prisma.companyTask.findFirst({
    where: { companyId, relatedType: "Job", relatedId: jobId, title: "Confirmation failed" },
  });
  if (!existing) {
    await prisma.companyTask.create({
      data: {
        companyId,
        title: "Confirmation failed",
        details: "The appointment was booked, but the confirmation text did not send. Retry from the conversation.",
        relatedType: "Job",
        relatedId: jobId,
        status: "OPEN",
      },
    });
  }
  await writeAudit({
    companyId,
    action: "scheduling.confirmation_failed",
    entityType: "Job",
    entityId: jobId,
    metadata: { error },
  });
}

export async function rescheduleAppointment(input: {
  companyId: string;
  jobId: string;
  date: string;
  windowId: string;
  technicianId?: string | null;
  actorId?: string | null;
  threadId?: string | null;
  inboundMessageId?: string | null;
  sendConfirmation?: boolean;
}) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    include: { schedulingBooking: true },
  });
  if (!job) return { ok: false as const, error: "Job not found.", code: "NOT_FOUND" as const };
  const previous = job.schedulingBooking;
  const booked = await bookAppointment({
    companyId: input.companyId,
    customerId: job.customerId,
    propertyId: job.propertyId,
    serviceTypeId: job.serviceTypeId,
    date: input.date,
    windowId: input.windowId,
    technicianId: input.technicianId,
    source: "MANUAL",
    actorId: input.actorId,
    threadId: input.threadId,
    inboundMessageId: input.inboundMessageId,
    idempotencyKey: input.inboundMessageId
      ? `reschedule:${input.inboundMessageId}`
      : `reschedule:${job.id}:${input.date}:${input.windowId}`,
    maintenanceVisitId: previous?.maintenanceVisitId,
    sendConfirmation: input.sendConfirmation,
    description: job.description,
  });
  if (!booked.ok) return booked;

  await prisma.$transaction(async (tx) => {
    if (previous) {
      await tx.schedulingBooking.update({
        where: { id: previous.id },
        data: { releasedAt: new Date() },
      });
    }
    if (booked.jobId !== job.id) {
      await tx.job.update({
        where: { id: job.id },
        data: { status: "CANCELED" },
      });
      if (previous?.maintenanceVisitId) {
        await tx.maintenanceVisit.updateMany({
          where: { id: previous.maintenanceVisitId, companyId: input.companyId },
          data: { jobId: booked.jobId, status: "SCHEDULED" },
        });
      }
    }
  });

  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "scheduling.rescheduled",
    entityType: "Job",
    entityId: booked.ok ? booked.jobId : job.id,
    metadata: { previousJobId: job.id, newJobId: booked.ok ? booked.jobId : null },
  });
  return booked;
}

export async function cancelAppointment(input: {
  companyId: string;
  jobId: string;
  actorId?: string | null;
  auto?: boolean;
}) {
  const policy = await loadSchedulingPolicy(prisma, input.companyId);
  if (input.auto && !policy.autoCancelEnabled) {
    await writeAudit({
      companyId: input.companyId,
      actorId: input.actorId,
      action: "scheduling.cancel_needs_review",
      entityType: "Job",
      entityId: input.jobId,
    });
    return { ok: true as const, canceled: false, needsReview: true as const };
  }
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    include: { schedulingBooking: true },
  });
  if (!job) return { ok: false as const, error: "Job not found." };
  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: job.id },
      data: { status: "CANCELED" },
    });
    if (job.schedulingBooking) {
      await tx.schedulingBooking.update({
        where: { id: job.schedulingBooking.id },
        data: { releasedAt: new Date() },
      });
      if (job.schedulingBooking.maintenanceVisitId) {
        await tx.maintenanceVisit.updateMany({
          where: { id: job.schedulingBooking.maintenanceVisitId, companyId: input.companyId },
          data: { status: "CANCELED", jobId: job.id },
        });
      }
    }
  });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "scheduling.canceled",
    entityType: "Job",
    entityId: job.id,
  });
  return { ok: true as const, canceled: true, needsReview: false as const };
}
