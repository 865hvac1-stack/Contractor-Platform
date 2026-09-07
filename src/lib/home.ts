import { endOfDay, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { homeAttentionItems, prioritizeAttention } from "@/lib/attention-priority";

export async function getHomeSummary(companyId: string) {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [
    jobsToday,
    inProgressToday,
    completedToday,
    waitingCount,
    scheduledInvoiceTotals,
    monthRevenue,
    monthCollected,
    outstanding,
    openEstimates,
    attentionRaw,
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
  ]);

  const scheduledRevenueCents = scheduledInvoiceTotals._sum.totalCents ?? 0;
  const revenueCents = monthRevenue._sum.totalCents ?? 0;
  const collectedCents = monthCollected._sum.amountCents ?? 0;
  const arCents = outstanding._sum.balanceCents ?? 0;
  const openEstimateCents = openEstimates._sum.totalCents ?? 0;
  const snapshotHasData = revenueCents > 0 || collectedCents > 0 || arCents > 0 || openEstimateCents > 0;

  return {
    today: {
      jobsToday,
      inProgressToday,
      completedToday,
      waitingCount,
      scheduledRevenueCents: scheduledRevenueCents > 0 ? scheduledRevenueCents : null,
    },
    snapshot: snapshotHasData
      ? { revenueCents, collectedCents, arCents, openEstimateCents }
      : null,
    needsYou: homeAttentionItems(prioritizeAttention(attentionRaw), 5),
    needsYouTotal: attentionRaw.length,
  };
}
