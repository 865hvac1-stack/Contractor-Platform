import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { getAvailability, findNextAvailableOptions, loadSchedulingPolicy } from "@/lib/scheduling/capacity";
import { interpretSchedulingIntent, mergeSchedulingIntent } from "@/lib/scheduling/intent";
import {
  cancelConfirmationMessage,
  clarificationMessage,
  maintenanceDuplicateMessage,
  noAvailabilityMessage,
  noPlanMessage,
  officeReviewMessage,
  suggestedBookingMessage,
} from "@/lib/scheduling/templates";
import { formatClockMinutes, formatLocalDateShort, formatWindowClock } from "@/lib/scheduling/time";
import { bookAppointment, cancelAppointment, rescheduleAppointment } from "@/lib/scheduling/booking";
import { findOpenMaintenanceVisit } from "@/lib/scheduling/maintenance";
import { conversationCanAutoBook } from "@/lib/scheduling/auto-book";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";
import { matchesDaypart } from "@/lib/scheduling/daypart";

const ACTIVE_STATES = ["OPEN", "CLARIFYING", "SUGGESTED", "NEEDS_REVIEW"] as const;

export async function processInboundScheduling(input: {
  companyId: string;
  threadId: string;
  customerId?: string | null;
  messageId: string;
  body?: string | null;
  direction?: string | null;
  channel?: string | null;
  phone?: string | null;
}) {
  const direction = (input.direction || "").toUpperCase();
  if (direction && direction !== "INBOUND") return { handled: false as const };
  if (!input.body?.trim()) return { handled: false as const };
  const channel = (input.channel || "SMS").toUpperCase();
  if (channel === "CALL" || channel === "VOICEMAIL") return { handled: false as const };

  await ensureSchedulingSetup(prisma, input.companyId);
  const existingByMessage = await prisma.conversationSchedulingState.findFirst({
    where: { companyId: input.companyId, lastInboundMessageId: input.messageId },
  });
  if (existingByMessage) return { handled: true as const, duplicate: true as const, stateId: existingByMessage.id };

  const company = await prisma.company.findFirst({
    where: { id: input.companyId },
    select: { timezone: true },
  });
  const timeZone = company?.timezone || "America/New_York";
  const windows = await prisma.appointmentWindow.findMany({
    where: { companyId: input.companyId, active: true },
    orderBy: { sortOrder: "asc" },
  });
  const fresh = interpretSchedulingIntent({ text: input.body, timeZone, windows });
  if (fresh.confidence === "low" && !fresh.requestedDate && !fresh.requestedDaypart && !fresh.maintenanceIntent && !fresh.cancelIntent && !fresh.rescheduleIntent && !fresh.humanRequested) {
    return { handled: false as const };
  }

  const previous = await prisma.conversationSchedulingState.findFirst({
    where: {
      companyId: input.companyId,
      threadId: input.threadId,
      status: { in: [...ACTIVE_STATES] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (previous?.paused && !fresh.humanRequested) {
    return { handled: false as const, paused: true as const };
  }

  const previousIntent = previous
    ? {
        requestedDate: previous.requestedDate?.toISOString().slice(0, 10) ?? null,
        requestedDateEnd: previous.requestedDateEnd?.toISOString().slice(0, 10) ?? null,
        requestedDaypart: previous.requestedDaypart,
        requestedWindowId: previous.requestedWindowId,
        serviceIntent: previous.serviceIntent,
        maintenanceIntent: previous.maintenanceIntent,
        urgency: (previous.urgency as "normal" | "emergency" | null) ?? null,
        rescheduleIntent: previous.rescheduleIntent,
        cancelIntent: previous.cancelIntent,
        missingField: previous.missingField as "date" | "daypart" | "window" | "appointment" | "service" | null,
        confidence: "high" as const,
      }
    : null;
  const intent = previousIntent ? mergeSchedulingIntent(previousIntent, fresh) : fresh;
  const policy = await loadSchedulingPolicy(prisma, input.companyId);
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);

  const state = previous
    ? await prisma.conversationSchedulingState.update({
        where: { id: previous.id },
        data: {
          customerId: input.customerId ?? previous.customerId,
          lastInboundMessageId: input.messageId,
          requestedDate: intent.requestedDate ? new Date(`${intent.requestedDate}T00:00:00.000Z`) : previous.requestedDate,
          requestedDateEnd: intent.requestedDateEnd ? new Date(`${intent.requestedDateEnd}T00:00:00.000Z`) : previous.requestedDateEnd,
          requestedDaypart: intent.requestedDaypart,
          requestedWindowId: intent.requestedWindowId,
          serviceIntent: intent.serviceIntent,
          maintenanceIntent: intent.maintenanceIntent,
          urgency: intent.urgency,
          rescheduleIntent: intent.rescheduleIntent,
          cancelIntent: intent.cancelIntent,
          missingField: intent.missingField,
          expiresAt,
        },
      })
    : await prisma.conversationSchedulingState.create({
        data: {
          companyId: input.companyId,
          threadId: input.threadId,
          customerId: input.customerId,
          lastInboundMessageId: input.messageId,
          requestedDate: intent.requestedDate ? new Date(`${intent.requestedDate}T00:00:00.000Z`) : null,
          requestedDateEnd: intent.requestedDateEnd ? new Date(`${intent.requestedDateEnd}T00:00:00.000Z`) : null,
          requestedDaypart: intent.requestedDaypart,
          requestedWindowId: intent.requestedWindowId,
          serviceIntent: intent.serviceIntent,
          maintenanceIntent: intent.maintenanceIntent,
          urgency: intent.urgency,
          rescheduleIntent: intent.rescheduleIntent,
          cancelIntent: intent.cancelIntent,
          missingField: intent.missingField,
          expiresAt,
        },
      });

  if (!input.customerId) {
    await markNeedsReview(state.id, input.companyId, "ambiguous_customer");
    await reply(input, officeReviewMessage());
    return { handled: true as const, stateId: state.id, outcome: "needs_review" as const };
  }

  if (intent.humanRequested) {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { paused: true, status: "PAUSED" },
    });
    await markNeedsReview(state.id, input.companyId, "human_requested");
    await reply(input, officeReviewMessage());
    return { handled: true as const, stateId: state.id, outcome: "paused" as const };
  }

  const upcoming = await prisma.job.findMany({
    where: {
      companyId: input.companyId,
      customerId: input.customerId,
      status: { in: ["SCHEDULED", "DISPATCHED"] },
      scheduledStart: { gte: new Date() },
    },
    include: { appointmentWindow: true, assignments: true },
    orderBy: { scheduledStart: "asc" },
  });

  if (intent.cancelIntent) {
    if (upcoming.length !== 1) {
      await prisma.conversationSchedulingState.update({
        where: { id: state.id },
        data: { status: "CLARIFYING", missingField: "appointment" },
      });
      await reply(input, clarificationMessage({ policy, missing: "appointment" }));
      return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
    }
    const canceled = await cancelAppointment({
      companyId: input.companyId,
      jobId: upcoming[0].id,
      auto: true,
    });
    if (canceled.needsReview) {
      await markNeedsReview(state.id, input.companyId, "cancel_requires_office");
      await reply(input, officeReviewMessage());
      return { handled: true as const, stateId: state.id, outcome: "needs_review" as const };
    }
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CANCELED" },
    });
    const when = upcoming[0].appointmentWindow
      ? `${formatLocalDateShort(upcoming[0].scheduledStart!.toISOString().slice(0, 10), timeZone)} ${formatWindowClock(upcoming[0].appointmentWindow.startMinutes, upcoming[0].appointmentWindow.endMinutes)}`
      : "that appointment";
    await reply(input, cancelConfirmationMessage(when));
    return { handled: true as const, stateId: state.id, outcome: "canceled" as const };
  }

  let maintenanceVisitId: string | null = null;
  if (intent.maintenanceIntent) {
    const visit = await findOpenMaintenanceVisit(input.companyId, input.customerId);
    if (!visit) {
      if (policy.allowPaidOneTimeMaintenance) {
        intent.serviceIntent = "maintenance";
      } else {
        await prisma.conversationSchedulingState.update({
          where: { id: state.id },
          data: { status: "NEEDS_REVIEW" },
        });
        await markNeedsReview(state.id, input.companyId, "no_maintenance_plan");
        await reply(input, noPlanMessage({ policy }));
        return { handled: true as const, stateId: state.id, outcome: "no_plan" as const };
      }
    } else if (visit.status === "SCHEDULED" && visit.jobId) {
      await writeAudit({
        companyId: input.companyId,
        action: "scheduling.maintenance_duplicate_prevented",
        entityType: "MaintenanceVisit",
        entityId: visit.id ?? visit.cycleKey,
        metadata: { jobId: visit.jobId },
      });
      const start = visit.scheduledWindow ? Number(visit.scheduledWindow.split("-")[0]) : 9 * 60;
      const end = visit.scheduledWindow ? Number(visit.scheduledWindow.split("-")[1]) : 11 * 60;
      await reply(
        input,
        maintenanceDuplicateMessage({
          policy,
          dateKey: visit.scheduledDate || visit.dueStart,
          startMinutes: start,
          endMinutes: end,
          timeZone,
        })
      );
      await prisma.conversationSchedulingState.update({
        where: { id: state.id },
        data: { status: "CLARIFYING", missingField: "appointment" },
      });
      return { handled: true as const, stateId: state.id, outcome: "duplicate_maintenance" as const };
    } else {
      maintenanceVisitId = visit.id;
    }
  }

  if (intent.missingField === "date" || intent.missingField === "daypart" || intent.missingField === "service") {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CLARIFYING", missingField: intent.missingField },
    });
    await reply(input, clarificationMessage({ policy, missing: intent.missingField }));
    return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
  }

  if (intent.rescheduleIntent) {
    if (upcoming.length !== 1) {
      await prisma.conversationSchedulingState.update({
        where: { id: state.id },
        data: { status: "CLARIFYING", missingField: "appointment" },
      });
      await reply(input, clarificationMessage({ policy, missing: "appointment" }));
      return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
    }
  }

  const serviceTypeId = intent.maintenanceIntent
    ? policy.maintenanceServiceTypeId ?? policy.defaultServiceTypeId
    : policy.defaultServiceTypeId;
  const rule = serviceTypeId
    ? await prisma.serviceTypeSchedulingRule.findFirst({
        where: { companyId: input.companyId, serviceTypeId },
      })
    : null;
  const canAutoBook = conversationCanAutoBook(policy, rule);

  const dates = intent.requestedDateEnd && intent.requestedDate
    ? expandDates(intent.requestedDate, intent.requestedDateEnd)
    : intent.requestedDate
      ? [intent.requestedDate]
      : [];

  let chosen: Awaited<ReturnType<typeof getAvailability>>["options"][number] | null = null;
  for (const date of dates) {
    const availability = await getAvailability({
      companyId: input.companyId,
      date,
      appointmentWindowId: intent.requestedWindowId,
      serviceTypeId,
      maintenance: intent.maintenanceIntent,
    });
    const filtered = availability.options.filter((option) => {
      if (intent.requestedWindowId && option.windowId !== intent.requestedWindowId) return false;
      if (intent.requestedDaypart && !matchesDaypart(option, intent.requestedDaypart)) return false;
      if (intent.requestedStartMinutes != null) {
        return intent.requestedStartMinutes >= option.startMinutes && intent.requestedStartMinutes < option.endMinutes;
      }
      return true;
    });
    if (filtered[0]) {
      chosen = filtered[0];
      break;
    }
  }

  if (!chosen) {
    const alternatives = await findNextAvailableOptions({
      companyId: input.companyId,
      startDate: intent.requestedDate || dates[0] || new Date().toISOString().slice(0, 10),
      days: intent.maintenanceIntent ? 60 : 14,
      serviceTypeId,
      daypart: intent.requestedDaypart,
      maintenance: intent.maintenanceIntent,
    });
    const requestedLabel = intent.requestedDate
      ? `${formatLocalDateShort(intent.requestedDate, timeZone)}${intent.requestedDaypart ? ` ${intent.requestedDaypart.toLowerCase()}` : ""}`
      : "for that time";
    await reply(
      input,
      noAvailabilityMessage({
        policy,
        requestedLabel,
        alternatives: alternatives.map((row) => ({
          dateKey: row.date,
          startMinutes: row.startMinutes,
          endMinutes: row.endMinutes,
          timeZone,
        })),
      })
    );
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CLARIFYING" },
    });
    return { handled: true as const, stateId: state.id, outcome: "alternatives" as const };
  }

  if (!canAutoBook) {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "SUGGESTED" },
    });
    await markNeedsReview(state.id, input.companyId, "office_approval");
    await reply(
      input,
      suggestedBookingMessage({
        dateKey: chosen.date,
        startMinutes: chosen.startMinutes,
        endMinutes: chosen.endMinutes,
        timeZone,
      })
    );
    return { handled: true as const, stateId: state.id, outcome: "suggested" as const };
  }

  const booked = intent.rescheduleIntent && upcoming[0]
    ? await rescheduleAppointment({
        companyId: input.companyId,
        jobId: upcoming[0].id,
        date: chosen.date,
        windowId: chosen.windowId,
        threadId: input.threadId,
        inboundMessageId: input.messageId,
        sendConfirmation: true,
      })
    : await bookAppointment({
        companyId: input.companyId,
        customerId: input.customerId,
        serviceTypeId,
        date: chosen.date,
        windowId: chosen.windowId,
        source: intent.maintenanceIntent ? "MAINTENANCE" : "CONVERSATION",
        threadId: input.threadId,
        inboundMessageId: input.messageId,
        idempotencyKey: `inbound:${input.messageId}`,
        maintenanceVisitId,
        sendConfirmation: true,
        maintenance: intent.maintenanceIntent,
      });

  if (!booked.ok) {
    if (booked.code === "DUPLICATE_MAINTENANCE") {
      await reply(input, officeReviewMessage());
      return { handled: true as const, stateId: state.id, outcome: "duplicate_maintenance" as const };
    }
    const alternatives = await findNextAvailableOptions({
      companyId: input.companyId,
      startDate: chosen.date,
      serviceTypeId,
      daypart: intent.requestedDaypart,
      maintenance: intent.maintenanceIntent,
    });
    await reply(
      input,
      noAvailabilityMessage({
        policy,
        requestedLabel: "that window",
        alternatives: alternatives.map((row) => ({
          dateKey: row.date,
          startMinutes: row.startMinutes,
          endMinutes: row.endMinutes,
          timeZone,
        })),
      })
    );
    return { handled: true as const, stateId: state.id, outcome: "alternatives" as const };
  }

  await prisma.conversationSchedulingState.update({
    where: { id: state.id },
    data: { status: "BOOKED", bookedJobId: booked.jobId },
  });
  return { handled: true as const, stateId: state.id, outcome: "booked" as const, jobId: booked.jobId };
}

function expandDates(start: string, end: string) {
  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < 40 && cursor <= end; i += 1) {
    dates.push(cursor);
    const [y, m, d] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return dates;
}

async function reply(input: { companyId: string; customerId?: string | null; phone?: string | null }, body: string) {
  const customer = input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId, companyId: input.companyId },
        select: { phone: true },
      })
    : null;
  const to = customer?.phone || input.phone;
  if (!to) return;
  await sendCompanyCommunication({
    companyId: input.companyId,
    channel: "SMS",
    to,
    body,
    customerId: input.customerId,
  });
}

async function markNeedsReview(stateId: string, companyId: string, reason: string) {
  await prisma.conversationSchedulingState.update({
    where: { id: stateId },
    data: { status: reason === "human_requested" ? "PAUSED" : "NEEDS_REVIEW" },
  });
  await writeAudit({
    companyId,
    action: "scheduling.needs_review",
    entityType: "ConversationSchedulingState",
    entityId: stateId,
    metadata: { reason },
  });
  const existing = await prisma.companyTask.findFirst({
    where: { companyId, relatedType: "ConversationSchedulingState", relatedId: stateId, status: "OPEN" },
  });
  if (!existing) {
    await prisma.companyTask.create({
      data: {
        companyId,
        title: "Scheduling needs office review",
        details: reason.replaceAll("_", " "),
        relatedType: "ConversationSchedulingState",
        relatedId: stateId,
        status: "OPEN",
      },
    });
  }
}

export async function setConversationAutoBooking(input: {
  db?: PrismaClient;
  companyId: string;
  threadId: string;
  paused: boolean;
  actorId?: string | null;
}) {
  const db = input.db ?? prisma;
  const state = await db.conversationSchedulingState.findFirst({
    where: { companyId: input.companyId, threadId: input.threadId },
    orderBy: { updatedAt: "desc" },
  });
  if (!state) {
    await db.conversationSchedulingState.create({
      data: {
        companyId: input.companyId,
        threadId: input.threadId,
        paused: input.paused,
        status: input.paused ? "PAUSED" : "OPEN",
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
  } else {
    await db.conversationSchedulingState.update({
      where: { id: state.id },
      data: { paused: input.paused, status: input.paused ? "PAUSED" : "OPEN" },
    });
  }
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: input.paused ? "scheduling.auto_booking_paused" : "scheduling.auto_booking_resumed",
    entityType: "CommunicationThread",
    entityId: input.threadId,
  });
}
