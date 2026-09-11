import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { homeAttentionItems, prioritizeAttention } from "@/lib/attention-priority";
import { presentAttentionItem } from "@/lib/attention-present";
import { loadFinancialSnapshot } from "@/lib/finance/snapshot";
import { parseFinanceRange, type FinanceRange } from "@/lib/finance/period";
import { refreshBillingWatchdog } from "@/lib/billing-watchdog/service";

export async function getHomeSummary(companyId: string, range: FinanceRange | string = "month") {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const [jobsToday, inProgressToday, completedToday, waitingCount, readyToSchedule, snapshot, attentionRaw, watchdog] =
    await Promise.all([
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
      loadFinancialSnapshot(companyId, parseFinanceRange(range), now),
      getNeedsAttention(companyId),
      refreshBillingWatchdog(prisma, companyId, now),
    ]);

  const ranked = prioritizeAttention(attentionRaw);
  return {
    today: {
      jobsToday,
      inProgressToday,
      completedToday,
      waitingCount,
      readyToSchedule,
    },
    snapshot,
    needsYou: homeAttentionItems(ranked, 5).map(presentAttentionItem),
    needsYouTotal: attentionRaw.length,
    watchdog: watchdog.summary,
  };
}
