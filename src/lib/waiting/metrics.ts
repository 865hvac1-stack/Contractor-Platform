import { differenceInCalendarDays } from "date-fns";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { parseWaitingMetadata } from "@/lib/waiting/types";

export type WaitingMetrics = {
  currentlyWaiting: number;
  waitingOnParts: number;
  readyToSchedule: number;
  overdue: number;
  averageDaysWaiting: number | null;
  updatesDueToday: number;
  revenueTiedUpCents: number;
  revenueTiedUpAvailable: boolean;
};

export async function waitingRevenueCents(companyId: string, jobIds: string[], db: PrismaClient = defaultPrisma) {
  if (jobIds.length === 0) return { cents: 0, available: true };
  const [invoices, estimates] = await Promise.all([
    db.invoice.findMany({
      where: { companyId, jobId: { in: jobIds }, status: { not: "VOID" } },
      select: { jobId: true, balanceCents: true, totalCents: true },
    }),
    db.estimate.findMany({
      where: { companyId, status: "APPROVED", OR: [{ jobId: { in: jobIds } }, { linkedJob: { id: { in: jobIds } } }] },
      select: { jobId: true, totalCents: true, linkedJob: { select: { id: true } } },
    }),
  ]);
  const byJob = new Map<string, number>();
  for (const invoice of invoices) {
    if (!invoice.jobId) continue;
    byJob.set(invoice.jobId, (byJob.get(invoice.jobId) ?? 0) + invoice.balanceCents);
  }
  for (const estimate of estimates) {
    const jobId = estimate.jobId ?? estimate.linkedJob?.id;
    if (!jobId || byJob.has(jobId)) continue;
    if (estimate.totalCents > 0) byJob.set(jobId, estimate.totalCents);
  }
  let cents = 0;
  for (const value of byJob.values()) cents += value;
  return { cents, available: invoices.length > 0 || estimates.length > 0 };
}

export async function loadWaitingMetrics(companyId: string, db: PrismaClient = defaultPrisma): Promise<WaitingMetrics> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const records = await db.waitingRecord.findMany({
    where: { companyId, state: "ACTIVE" },
    include: { column: { select: { key: true, kind: true, warningDays: true, urgentDays: true } } },
  });

  const waitingOnParts = records.filter((row) => row.column.key === "WAITING_ON_PART").length;
  const readyToSchedule = records.filter((row) => row.column.kind === "READY" || row.column.key === "READY_TO_SCHEDULE").length;
  const overdue = records.filter((row) => {
    if (!row.expectedResolutionAt) return false;
    return row.expectedResolutionAt.getTime() < now.getTime() && row.column.kind !== "READY";
  }).length;
  const days = records.map((row) => differenceInCalendarDays(now, row.enteredAt));
  const averageDaysWaiting = days.length ? Math.round((days.reduce((sum, value) => sum + value, 0) / days.length) * 10) / 10 : null;
  const updatesDueToday = records.filter((row) => {
    if (!row.nextCustomerUpdateAt || !row.automationEnabled) return false;
    return row.nextCustomerUpdateAt >= startOfToday && row.nextCustomerUpdateAt <= endOfToday;
  }).length;
  const revenue = await waitingRevenueCents(
    companyId,
    records.map((row) => row.jobId),
    db
  );

  return {
    currentlyWaiting: records.length,
    waitingOnParts,
    readyToSchedule,
    overdue,
    averageDaysWaiting,
    updatesDueToday,
    revenueTiedUpCents: revenue.cents,
    revenueTiedUpAvailable: revenue.available && records.length > 0,
  };
}

export function vendorDelayRows(
  records: Array<{ enteredAt: Date; metadata: unknown; column: { key: string } }>
) {
  const now = new Date();
  const vendors = new Map<string, { vendor: string; count: number; totalDays: number }>();
  for (const record of records) {
    if (record.column.key !== "WAITING_ON_PART") continue;
    const meta = parseWaitingMetadata(record.metadata);
    const vendor = meta.part?.vendor?.trim() || meta.vendor?.trim();
    if (!vendor) continue;
    const current = vendors.get(vendor) ?? { vendor, count: 0, totalDays: 0 };
    current.count += 1;
    current.totalDays += Math.max(0, differenceInCalendarDays(now, record.enteredAt));
    vendors.set(vendor, current);
  }
  return [...vendors.values()]
    .map((row) => ({ ...row, averageDays: row.count ? Math.round((row.totalDays / row.count) * 10) / 10 : 0 }))
    .sort((a, b) => b.count - a.count || b.averageDays - a.averageDays);
}
