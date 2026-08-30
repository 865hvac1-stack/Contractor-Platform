import { prisma } from "@/lib/db";
import { BOOKED_LEAD_STATUSES, OPEN_LEAD_STATUSES, SOLD_LEAD_STATUSES } from "@/lib/leads/sources";
import { attributedGrossProfitCents, attributedRevenueCents } from "@/lib/attribution/engine";
import type { MarketingRange } from "@/lib/marketing/period";
import { marketingPeriod } from "@/lib/marketing/period";
import type { Prisma } from "@prisma/client";

export type KpiAvailability = {
  key: string;
  label: string;
  value: string | number;
  available: boolean;
  reason?: string;
  href?: string;
};

export async function getMarketingHubMetrics(companyId: string, range: MarketingRange) {
  const period = marketingPeriod(range);
  const wherePeriod: Prisma.LeadWhereInput = {
    companyId,
    receivedAt: { gte: period.start, lte: period.end },
  };

  const [
    newLeads,
    bookedLeads,
    openOpportunities,
    unansweredLeads,
    advertisingSpend,
    recordedSpend,
    attribution,
    attributedProfit,
    callCount,
    missedCalls,
    reviews,
    sourceGroups,
    soldLeads,
  ] = await Promise.all([
    prisma.lead.count({ where: wherePeriod }),
    prisma.lead.count({
      where: { ...wherePeriod, status: { in: BOOKED_LEAD_STATUSES } },
    }),
    prisma.lead.count({
      where: { companyId, status: { in: OPEN_LEAD_STATUSES } },
    }),
    prisma.lead.count({
      where: {
        companyId,
        firstRespondedAt: null,
        status: { in: ["NEW", "CONTACTED"] },
      },
    }),
    prisma.expense.aggregate({
      where: {
        companyId,
        category: "ADVERTISING",
        date: { gte: period.start, lte: period.end },
      },
      _sum: { amountCents: true },
    }),
    prisma.marketingSpend.aggregate({
      where: {
        companyId,
        periodStart: { lte: period.end },
        periodEnd: { gte: period.start },
      },
      _sum: { amountCents: true },
    }),
    attributedRevenueCents(companyId, period),
    attributedGrossProfitCents(companyId, period),
    prisma.callRecord.count({
      where: { companyId, startedAt: { gte: period.start, lte: period.end } },
    }),
    prisma.callRecord.count({
      where: {
        companyId,
        missed: true,
        startedAt: { gte: period.start, lte: period.end },
      },
    }),
    prisma.review.count({
      where: {
        companyId,
        reviewedAt: { gte: period.start, lte: period.end },
      },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: wherePeriod,
      _count: { _all: true },
    }),
    prisma.lead.count({
      where: { ...wherePeriod, status: { in: SOLD_LEAD_STATUSES } },
    }),
  ]);

  const spendCents =
    (advertisingSpend._sum?.amountCents ?? 0) + (recordedSpend._sum?.amountCents ?? 0);
  const bookingRate = newLeads > 0 ? Math.round((bookedLeads / newLeads) * 100) : null;
  const costPerLead = newLeads > 0 && spendCents > 0 ? Math.round(spendCents / newLeads) : null;
  const costPerBooked = bookedLeads > 0 && spendCents > 0 ? Math.round(spendCents / bookedLeads) : null;
  const roas =
    spendCents > 0 && attribution.events > 0 ? attribution.cents / spendCents : null;

  return {
    period,
    newLeads,
    bookedLeads,
    bookingRate,
    openOpportunities,
    marketingSpendCents: spendCents,
    costPerLeadCents: costPerLead,
    costPerBookedCents: costPerBooked,
    attributedRevenueCents: attribution.events > 0 ? attribution.cents : null,
    attributedGrossProfitCents: attributedProfit > 0 ? attributedProfit : null,
    roas,
    missedCalls: callCount > 0 ? missedCalls : null,
    unansweredLeads,
    reviewsGenerated: reviews > 0 ? reviews : null,
    soldLeads,
    sourceCounts: sourceGroups,
    hasAttribution: attribution.events > 0,
    hasCallData: callCount > 0,
    hasReviewData: reviews > 0,
  };
}

export async function getPerformanceBySource(companyId: string, range: MarketingRange) {
  const period = marketingPeriod(range);
  const leads = await prisma.lead.findMany({
    where: {
      companyId,
      receivedAt: { gte: period.start, lte: period.end },
    },
    select: {
      source: true,
      status: true,
      attributedRevenueCents: true,
      attributedGrossProfitCents: true,
    },
  });

  const spendRows = await prisma.marketingSpend.findMany({
    where: {
      companyId,
      periodStart: { lte: period.end },
      periodEnd: { gte: period.start },
    },
    select: { source: true, amountCents: true },
  });

  const map = new Map<
    string,
    { leads: number; booked: number; sold: number; spend: number; revenue: number; profit: number }
  >();

  for (const lead of leads) {
    const row = map.get(lead.source) ?? {
      leads: 0,
      booked: 0,
      sold: 0,
      spend: 0,
      revenue: 0,
      profit: 0,
    };
    row.leads += 1;
    if (BOOKED_LEAD_STATUSES.includes(lead.status)) row.booked += 1;
    if (SOLD_LEAD_STATUSES.includes(lead.status)) row.sold += 1;
    if (lead.attributedRevenueCents != null) row.revenue += lead.attributedRevenueCents;
    if (lead.attributedGrossProfitCents != null) row.profit += lead.attributedGrossProfitCents;
    map.set(lead.source, row);
  }

  for (const spend of spendRows) {
    const row = map.get(spend.source) ?? {
      leads: 0,
      booked: 0,
      sold: 0,
      spend: 0,
      revenue: 0,
      profit: 0,
    };
    row.spend += spend.amountCents;
    map.set(spend.source, row);
  }

  return Array.from(map.entries()).map(([source, row]) => ({ source, ...row }));
}
