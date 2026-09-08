import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { evaluateCapacity, type EngineSnapshot } from "@/lib/scheduling/capacity-engine";
import { DEFAULT_POLICY, type CapacityQuery, type SchedulingPolicyView } from "@/lib/scheduling/types";
import { addLocalDays, companyTodayKey, zonedLocalDateTime } from "@/lib/scheduling/time";
import { matchesDaypart } from "@/lib/scheduling/daypart";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";

type Db = typeof prisma | Prisma.TransactionClient;

export async function loadSchedulingPolicy(db: Db, companyId: string): Promise<SchedulingPolicyView> {
  const row = await db.schedulingPolicy.findUnique({ where: { companyId } });
  if (!row) return DEFAULT_POLICY;
  return {
    autoBookingEnabled: row.autoBookingEnabled,
    allowSameDay: row.allowSameDay,
    allowWeekend: row.allowWeekend,
    minNoticeMinutes: row.minNoticeMinutes,
    standardHorizonDays: row.standardHorizonDays,
    maintenanceHorizonDays: row.maintenanceHorizonDays,
    maxJobsPerWindow: row.maxJobsPerWindow,
    maxJobsPerDay: row.maxJobsPerDay,
    emergencyReservePerWindow: row.emergencyReservePerWindow,
    allowEmergencyReserveUse: row.allowEmergencyReserveUse,
    allowTechnicianPreference: row.allowTechnicianPreference,
    allowOfficeOverride: row.allowOfficeOverride,
    autoCancelEnabled: row.autoCancelEnabled,
    showTechnicianName: row.showTechnicianName,
    allowPaidOneTimeMaintenance: row.allowPaidOneTimeMaintenance,
    confirmationTemplate: row.confirmationTemplate,
    noAvailabilityTemplate: row.noAvailabilityTemplate,
    clarificationTemplate: row.clarificationTemplate,
    maintenanceDuplicateTemplate: row.maintenanceDuplicateTemplate,
    noPlanTemplate: row.noPlanTemplate,
    defaultServiceTypeId: row.defaultServiceTypeId,
    maintenanceServiceTypeId: row.maintenanceServiceTypeId,
    proactiveOutreachEnabled: row.proactiveOutreachEnabled,
  };
}

export async function loadCapacitySnapshot(
  db: Db,
  companyId: string,
  dates: string[],
  now = new Date()
): Promise<EngineSnapshot> {
  const start = dates.slice().sort()[0];
  const end = dates.slice().sort()[dates.length - 1];
  const company = await db.company.findFirst({
    where: { id: companyId },
    select: { id: true, timezone: true },
  });
  if (!company) throw new Error("Company not found.");

  const rangeStart = zonedLocalDateTime(company.timezone, start, 0);
  const rangeEnd = zonedLocalDateTime(company.timezone, addLocalDays(end, 1), 0);

  const [policy, windows, techs, weekly, overrides, eligibility, bookings, assignedJobs] = await Promise.all([
    loadSchedulingPolicy(db, companyId),
    db.appointmentWindow.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }],
    }),
    db.membership.findMany({
      where: { companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.technicianWindowAvailability.findMany({ where: { companyId } }),
    db.availabilityOverride.findMany({
      where: { companyId, date: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T00:00:00.000Z`) } },
    }),
    db.technicianServiceEligibility.findMany({ where: { companyId } }),
    db.schedulingBooking.findMany({
      where: {
        companyId,
        releasedAt: null,
        localDate: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T00:00:00.000Z`) },
        job: { status: { not: "CANCELED" } },
      },
      include: { job: { select: { status: true, scheduleLocked: true } } },
    }),
    db.job.findMany({
      where: {
        companyId,
        status: { not: "CANCELED" },
        scheduledStart: { gte: rangeStart, lt: rangeEnd },
        assignments: { some: {} },
      },
      select: {
        id: true,
        scheduleLocked: true,
        appointmentWindowId: true,
        scheduledStart: true,
        assignments: { select: { userId: true } },
      },
    }),
  ]);

  const bookingRows = bookings.map((row) => ({
    technicianId: row.technicianUserId,
    windowId: row.windowId,
    date: row.localDate.toISOString().slice(0, 10),
    jobId: row.jobId,
    scheduleLocked: row.job.scheduleLocked,
  }));
  const bookingJobIds = new Set(bookingRows.map((row) => row.jobId));
  for (const job of assignedJobs) {
    if (bookingJobIds.has(job.id) || !job.appointmentWindowId || !job.scheduledStart) continue;
    const local = companyTodayKey(job.scheduledStart, company.timezone);
    for (const assignment of job.assignments) {
      bookingRows.push({
        technicianId: assignment.userId,
        windowId: job.appointmentWindowId,
        date: local,
        jobId: job.id,
        scheduleLocked: job.scheduleLocked,
      });
    }
  }

  return {
    timeZone: company.timezone,
    policy,
    windows: windows.map((window) => ({
      id: window.id,
      name: window.name,
      label: window.label,
      startMinutes: window.startMinutes,
      endMinutes: window.endMinutes,
      daypart: window.daypart,
      active: window.active,
    })),
    technicians: techs.map((row) => ({
      id: row.user.id,
      name: `${row.user.firstName} ${row.user.lastName}`.trim(),
      active: true,
    })),
    weekly: weekly.map((row) => ({
      userId: row.userId,
      windowId: row.windowId,
      weekday: row.weekday,
      available: row.available,
      capacity: row.capacity,
    })),
    overrides: overrides.map((row) => ({
      userId: row.userId,
      windowId: row.windowId,
      date: row.date.toISOString().slice(0, 10),
      available: row.available,
      capacity: row.capacity,
    })),
    eligibility: eligibility.map((row) => ({
      userId: row.userId,
      serviceTypeId: row.serviceTypeId,
      eligible: row.eligible,
    })),
    bookings: bookingRows,
    now,
  };
}

export async function getAvailability(query: CapacityQuery & { db?: Db }) {
  const db = query.db ?? prisma;
  await ensureSchedulingSetup(db, query.companyId);
  const snapshot = await loadCapacitySnapshot(db, query.companyId, [query.date], query.now);
  return evaluateCapacity(snapshot, query);
}

export async function getAvailabilityRange(input: {
  companyId: string;
  startDate: string;
  days: number;
  serviceTypeId?: string | null;
  technicianId?: string | null;
  daypart?: CapacityQuery extends never ? never : import("@prisma/client").AppointmentDaypart | null;
  maintenance?: boolean;
  now?: Date;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  await ensureSchedulingSetup(db, input.companyId);
  const dates = Array.from({ length: input.days }, (_, index) => addLocalDays(input.startDate, index));
  const snapshot = await loadCapacitySnapshot(db, input.companyId, dates, input.now);
  return dates.map((date) => {
    const result = evaluateCapacity(snapshot, {
      companyId: input.companyId,
      date,
      serviceTypeId: input.serviceTypeId,
      technicianId: input.technicianId,
      maintenance: input.maintenance,
      now: input.now,
    });
    return input.daypart
      ? { ...result, options: result.options.filter((option) => matchesDaypart(option, input.daypart)) }
      : result;
  });
}

export async function findNextAvailableOptions(input: {
  companyId: string;
  startDate: string;
  days?: number;
  serviceTypeId?: string | null;
  daypart?: import("@prisma/client").AppointmentDaypart | null;
  technicianId?: string | null;
  maintenance?: boolean;
  now?: Date;
  db?: Db;
}) {
  const results = await getAvailabilityRange({
    ...input,
    days: input.days ?? 14,
  });
  return results.flatMap((row) => row.options).slice(0, 4);
}
