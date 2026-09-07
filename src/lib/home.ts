import { endOfDay, endOfMonth, startOfDay, startOfMonth, subDays, subMonths } from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { homeAttentionItems, prioritizeAttention } from "@/lib/attention-priority";
import { presentAttentionItem } from "@/lib/attention-present";

export async function getHomeSummary(companyId: string) {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const priorStart = startOfMonth(subMonths(now, 1));
  const priorEnd = endOfMonth(subMonths(now, 1));
  const sparkStart = startOfDay(subDays(now, 29));

  const [
    jobsToday,
    inProgressToday,
    completedToday,
    waitingCount,
    readyToSchedule,
    scheduledInvoiceTotals,
    monthRevenue,
    priorRevenue,
    monthCollected,
    outstanding,
    openEstimates,
    attentionRaw,
    recentPaid,
  ] = await Promise.all([
    prisma.job.count({
      where: { companyId, scheduledStart: { gte: dayStart, lte: dayEnd }, status: { not: "CANCELED" } },
    }),
    prisma.job.count({
      where: {
        companyId,
        status: { in: ["DISPATCHED", "IN_PROGRESS"] },
        scheduledStart: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.job.count({
      where: { companyId, status: "COMPLETED", completedAt: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.waitingRecord.count({
      where: { companyId, state: "ACTIVE", column: { kind: { not: "READY" } } },
    }),
    prisma.waitingRecord.count({
      where: { companyId, state: "ACTIVE", column: { kind: "READY" } },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        status: { notIn: ["VOID", "DRAFT"] },
        job: { scheduledStart: { gte: dayStart, lte: dayEnd }, status: { not: "CANCELED" } },
      },
      _sum: { totalCents: true },
    }),
    prisma.invoice.aggregate({
      where: { companyId, status: "PAID", updatedAt: { gte: monthStart, lte: monthEnd } },
      _sum: { totalCents: true },
    }),
    prisma.invoice.aggregate({
      where: { companyId, status: "PAID", updatedAt: { gte: priorStart, lte: priorEnd } },
      _sum: { totalCents: true },
    }),
    prisma.payment.aggregate({
      where: {
        companyId,
        status: { in: ["SUCCEEDED", "RECORDED", "CONFIRMED"] },
        paidAt: { gte: monthStart, lte: monthEnd },
      },
      _sum: { amountCents: true },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
      },
      _sum: { balanceCents: true },
    }),
    prisma.estimate.aggregate({
      where: { companyId, status: { in: ["DRAFT", "SENT", "VIEWED"] } },
      _sum: { totalCents: true },
    }),
    getNeedsAttention(companyId),
    prisma.invoice.findMany({
      where: { companyId, status: "PAID", updatedAt: { gte: sparkStart } },
      select: { updatedAt: true, totalCents: true },
      take: 400,
    }),
  ]);

  const scheduledRevenueCents = scheduledInvoiceTotals._sum.totalCents ?? 0;
  const revenueCents = monthRevenue._sum.totalCents ?? 0;
  const priorRevenueCents = priorRevenue._sum.totalCents ?? 0;
  const collectedCents = monthCollected._sum.amountCents ?? 0;
  const arCents = outstanding._sum.balanceCents ?? 0;
  const openEstimateCents = openEstimates._sum.totalCents ?? 0;
  const snapshotHasData = revenueCents > 0 || collectedCents > 0 || arCents > 0 || openEstimateCents > 0;
  const revenueTrend =
    snapshotHasData && priorRevenueCents > 0
      ? Math.round(((revenueCents - priorRevenueCents) / priorRevenueCents) * 1000) / 10
      : null;

  const sparkBuckets = new Map<string, number>();
  for (const row of recentPaid) {
    const key = startOfDay(row.updatedAt).toISOString();
    sparkBuckets.set(key, (sparkBuckets.get(key) ?? 0) + row.totalCents);
  }
  const sparkline =
    sparkBuckets.size >= 3
      ? Array.from({ length: 30 }, (_, index) => {
          const day = startOfDay(subDays(now, 29 - index)).toISOString();
          return sparkBuckets.get(day) ?? 0;
        })
      : null;

  const ranked = prioritizeAttention(attentionRaw);
  return {
    today: {
      jobsToday,
      inProgressToday,
      completedToday,
      waitingCount,
      readyToSchedule,
      scheduledRevenueCents: scheduledRevenueCents > 0 ? scheduledRevenueCents : null,
    },
    snapshot: snapshotHasData
      ? { revenueCents, collectedCents, arCents, openEstimateCents, revenueTrend, sparkline }
      : null,
    needsYou: homeAttentionItems(ranked, 5).map(presentAttentionItem),
    needsYouTotal: attentionRaw.length,
  };
}
