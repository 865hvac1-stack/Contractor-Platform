import type { MaintenanceVisitStatus, PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addLocalDays, companyTodayKey, compareDateKeys, dateKeyFromParts, daysBetweenKeys } from "@/lib/scheduling/time";

type Db = PrismaClient | Prisma.TransactionClient;

export type MaintenanceVisitView = {
  id: string | null;
  membershipId: string;
  customerId: string;
  customerName: string;
  planName: string;
  cycleKey: string;
  label: string;
  dueStart: string;
  dueEnd: string;
  status: MaintenanceVisitStatus;
  jobId: string | null;
  jobNumber: string | null;
  scheduledDate: string | null;
  scheduledWindow: string | null;
  technicianName: string | null;
};

const OPEN_JOB = ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD"];

export function classifyMaintenanceVisit(input: {
  today: string;
  dueStart: string;
  dueEnd: string;
  dueSoonDays: number;
  jobStatus?: string | null;
  jobId?: string | null;
  completedAt?: Date | string | null;
  canceled?: boolean;
}): MaintenanceVisitStatus {
  if (input.canceled) return "CANCELED";
  if (input.completedAt || input.jobStatus === "COMPLETED") return "COMPLETED";
  if (input.jobStatus === "CANCELED" && input.jobId) return "NEEDS_RESCHEDULE";
  if (input.jobId && input.jobStatus && OPEN_JOB.includes(input.jobStatus)) return "SCHEDULED";
  if (compareDateKeys(input.today, input.dueEnd) > 0) return "OVERDUE";
  if (compareDateKeys(input.today, input.dueStart) >= 0) return "UNSCHEDULED";
  if (daysBetweenKeys(input.today, input.dueStart) <= input.dueSoonDays) return "DUE_SOON";
  return "NOT_YET_DUE";
}

export function plannedCycles(input: {
  startDate: Date;
  visitsPerYear: number;
  years?: number;
  today: string;
}) {
  const visits = Math.max(1, input.visitsPerYear);
  const years = input.years ?? 2;
  const startYear = input.startDate.getUTCFullYear();
  const startMonth = input.startDate.getUTCMonth() + 1;
  const cycles: Array<{ cycleKey: string; label: string; dueStart: string; dueEnd: string }> = [];
  const span = Math.max(1, Math.round(12 / visits));
  for (let yearOffset = 0; yearOffset < years + 1; yearOffset += 1) {
    for (let index = 0; index < visits; index += 1) {
      const monthOffset = startMonth - 1 + index * span;
      const year = startYear + yearOffset + Math.floor(monthOffset / 12);
      const month = (monthOffset % 12) + 1;
      const dueStart = dateKeyFromParts(year, month, 1);
      const dueEnd = addLocalDays(dateKeyFromParts(year, month === 12 ? 1 : month + 1, 1), month === 12 ? 364 : 59);
      const dueEndSafe = addLocalDays(dueStart, Math.min(59, span * 30 - 1));
      cycles.push({
        cycleKey: `${year}-${index}`,
        label: defaultVisitLabel(visits, index, month),
        dueStart,
        dueEnd: dueEndSafe ?? dueEnd,
      });
    }
  }
  return cycles.filter((cycle) => compareDateKeys(cycle.dueEnd, addLocalDays(input.today, -180)) >= 0);
}

function defaultVisitLabel(visitsPerYear: number, index: number, month: number) {
  if (visitsPerYear === 2) {
    if (month >= 2 && month <= 5) return "Spring Maintenance";
    if (month >= 8 && month <= 11) return "Fall Maintenance";
  }
  return `Visit ${index + 1}`;
}

export async function syncCustomerMaintenanceVisits(db: Db, companyId: string, customerId: string) {
  const memberships = await db.customerMembership.findMany({
    where: { companyId, customerId, status: "ACTIVE" },
    include: { plan: true, customer: true },
  });
  const company = await db.company.findFirst({ where: { id: companyId }, select: { timezone: true } });
  const today = companyTodayKey(new Date(), company?.timezone || "America/New_York");
  const views: MaintenanceVisitView[] = [];

  for (const membership of memberships) {
    const visitsPerYear = membership.plan.visitsPerYear || membership.plan.includedVisits || 1;
    const dueSoonDays = membership.plan.dueSoonDays || 45;
    const start = membership.startDate || membership.saleDate;
    const cycles = plannedCycles({ startDate: start, visitsPerYear, today });
    for (const cycle of cycles) {
      const existing = await db.maintenanceVisit.upsert({
        where: {
          companyId_membershipId_cycleKey: {
            companyId,
            membershipId: membership.id,
            cycleKey: cycle.cycleKey,
          },
        },
        create: {
          companyId,
          membershipId: membership.id,
          customerId,
          cycleKey: cycle.cycleKey,
          label: cycle.label,
          dueStart: new Date(`${cycle.dueStart}T00:00:00.000Z`),
          dueEnd: new Date(`${cycle.dueEnd}T00:00:00.000Z`),
          status: "UNSCHEDULED",
        },
        update: {
          label: cycle.label,
          dueStart: new Date(`${cycle.dueStart}T00:00:00.000Z`),
          dueEnd: new Date(`${cycle.dueEnd}T00:00:00.000Z`),
        },
        include: {
          job: {
            select: {
              id: true,
              jobNumber: true,
              status: true,
              scheduledStart: true,
              completedAt: true,
              appointmentWindow: { select: { startMinutes: true, endMinutes: true } },
              assignments: { include: { user: { select: { firstName: true, lastName: true } } }, take: 1 },
            },
          },
        },
      });
      const status = classifyMaintenanceVisit({
        today,
        dueStart: cycle.dueStart,
        dueEnd: cycle.dueEnd,
        dueSoonDays,
        jobId: existing.jobId,
        jobStatus: existing.job?.status,
        completedAt: existing.completedAt ?? existing.job?.completedAt,
      });
      if (existing.status !== status) {
        await db.maintenanceVisit.update({ where: { id: existing.id }, data: { status } });
      }
      views.push({
        id: existing.id,
        membershipId: membership.id,
        customerId,
        customerName: membership.customer.businessName || `${membership.customer.firstName} ${membership.customer.lastName}`.trim(),
        planName: membership.plan.name,
        cycleKey: cycle.cycleKey,
        label: cycle.label,
        dueStart: cycle.dueStart,
        dueEnd: cycle.dueEnd,
        status,
        jobId: existing.jobId,
        jobNumber: existing.job?.jobNumber ?? null,
        scheduledDate: existing.job?.scheduledStart ? existing.job.scheduledStart.toISOString().slice(0, 10) : null,
        scheduledWindow: existing.job?.appointmentWindow
          ? `${existing.job.appointmentWindow.startMinutes}-${existing.job.appointmentWindow.endMinutes}`
          : null,
        technicianName: existing.job?.assignments[0]
          ? `${existing.job.assignments[0].user.firstName} ${existing.job.assignments[0].user.lastName}`.trim()
          : null,
      });
    }
  }
  return views.sort((a, b) => a.dueStart.localeCompare(b.dueStart));
}

export async function getCustomerMaintenanceSummary(companyId: string, customerId: string) {
  const visits = await syncCustomerMaintenanceVisits(prisma, companyId, customerId);
  const active = visits.filter((visit) => !["COMPLETED", "CANCELED"].includes(visit.status));
  const next = active[0] ?? null;
  return { visits, next, hasActivePlan: visits.length > 0 };
}

export async function findOpenMaintenanceVisit(companyId: string, customerId: string) {
  const summary = await getCustomerMaintenanceSummary(companyId, customerId);
  return (
    summary.visits.find((visit) => visit.status === "SCHEDULED") ??
    summary.visits.find((visit) => ["OVERDUE", "UNSCHEDULED", "DUE_SOON", "NEEDS_RESCHEDULE"].includes(visit.status)) ??
    null
  );
}

export async function listCompanyMaintenance(companyId: string, status?: MaintenanceVisitStatus | "ALL") {
  const memberships = await prisma.customerMembership.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { customerId: true },
    take: 200,
  });
  const all: MaintenanceVisitView[] = [];
  const seen = new Set<string>();
  for (const row of memberships) {
    if (seen.has(row.customerId)) continue;
    seen.add(row.customerId);
    all.push(...(await syncCustomerMaintenanceVisits(prisma, companyId, row.customerId)));
  }
  if (!status || status === "ALL") return all;
  return all.filter((visit) => visit.status === status);
}
