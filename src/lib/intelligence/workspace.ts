import { getCommandCenterData } from "@/lib/dashboard";
import { listRecentActionRequests } from "@/lib/actions/approvals";
import { getBusinessContext, type BusinessContext } from "@/lib/intelligence/operating-context";
import { getOpportunities } from "@/lib/intelligence/opportunities";
import { assembleIntelligenceView, type IntelligenceFacts } from "@/lib/intelligence/notices";
import { prisma } from "@/lib/db";
import { openaiConfigured } from "@/lib/intelligence/config";

export async function getIntelligenceWorkspace(companyId: string, firstName: string) {
  const [command, opportunities, context, recentActions, automations, setting] = await Promise.all([
    getCommandCenterData(companyId),
    getOpportunities(companyId),
    getBusinessContext(companyId),
    listRecentActionRequests(companyId, 5),
    prisma.automation.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, name: true, trigger: true, action: true, enabled: true, status: true },
    }),
    prisma.companyIntelligenceSetting.findFirst({
      where: { companyId },
      select: { dailyBriefEnabled: true },
    }),
  ]);

  const facts: IntelligenceFacts = {
    firstName,
    companyName: context?.companyName || "this company",
    generatedAt: command.generatedAt,
    health: command.health,
    today: {
      jobsToday: command.today.jobsToday,
      completedJobs: command.today.completedJobs,
      runningBehind: command.today.runningBehind,
      unassignedJobs: command.today.unassignedJobs,
    },
    sales: {
      openEstimates: command.sales.openEstimates,
      estimateValue: command.sales.estimateValue,
      closeRate: command.sales.closeRate,
      opportunities: command.sales.opportunities.map((row) => ({
        customerName: row.customerName,
        amountCents: row.amountCents,
      })),
    },
    money: {
      revenueThisMonth: command.money.revenueThisMonth,
      lastMonthRevenue: command.money.lastMonthRevenue,
      revenueChangePercent: command.money.revenueChangePercent,
      overdueBalance: command.money.overdueBalance,
      overdueInvoices: command.money.overdueInvoices,
      outstandingBalance: command.money.outstandingBalance,
      aging: command.money.aging,
      revenueGoalCents: command.money.revenueGoalCents,
      closeRateGoal: command.money.closeRateGoal,
      grossMarginPercent: command.money.grossMarginPercent,
    },
    memberships: command.memberships,
    reviews: { month: command.reviews.month, average: command.reviews.average },
    marketing: {
      leadsThisMonth: command.marketing.leadsThisMonth,
      bookedLeads: command.marketing.bookedLeads,
      bestSource: command.marketing.bestSource
        ? {
            source: command.marketing.bestSource.label,
            booked: command.marketing.bestSource.booked,
            leads: command.marketing.bestSource.leads,
          }
        : null,
    },
    operations: {
      callbacks: command.operations.callbacks,
      unassignedJobs: command.operations.unassignedJobs,
      completedThisMonth: command.operations.completedThisMonth,
    },
    team: {
      insights: command.team.insights,
      averageTicketCents: command.team.averageTicketCents,
    },
    followUp: command.followUp,
    goals: command.goals,
  };

  const view = assembleIntelligenceView(facts, opportunities, context);
  return {
    facts,
    context: context as BusinessContext | null,
    ...view,
    recentActions: recentActions.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      targetCount: row.targets.length,
      createdAt: row.createdAt,
    })),
    automations,
    dailyBriefEnabled: setting?.dailyBriefEnabled ?? true,
    providerConfigured: openaiConfigured(),
    attentionCounts: command.attentionCounts,
  };
}

export type IntelligenceWorkspace = Awaited<ReturnType<typeof getIntelligenceWorkspace>>;
