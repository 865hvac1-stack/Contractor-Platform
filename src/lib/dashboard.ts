import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  subMonths,
  addDays,
} from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { homeAttentionItems, prioritizeAttention } from "@/lib/attention-priority";
import { BOOKED_LEAD_STATUSES, LEAD_SOURCE_LABELS } from "@/lib/leads/sources";
import { technicianScorecard } from "@/lib/performance/scorecard";

export async function getCommandCenterData(companyId: string) {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [
    jobsToday,
    jobsCompletedToday,
    openJobs,
    openEstimates,
    wonEstimatesThisMonth,
    paidInvoicesThisMonth,
    unpaidInvoices,
    overdueInvoices,
    overdueInvoiceRows,
    lastMonthPaid,
    jobsInProgress,
    jobsCompletedThisMonth,
    callbackJobs,
    unscheduledApproved,
    jobsNeedingAttention,
    attention,
    technicians,
    scheduledJobsToday,
    expensesThisMonth,
    jobCostsThisMonth,
    unassignedJobs,
    membershipsSoldThisMonth,
    activeMemberships,
    renewalsDue,
    membershipRevenue,
    leadsThisMonthRows,
    missedCallsOpen,
    reports,
    openEstimateRows,
    techMembers,
  ] = await Promise.all([
    prisma.job.count({
      where: {
        companyId,
        scheduledStart: { gte: dayStart, lte: dayEnd },
        status: { not: "CANCELED" },
      },
    }),
    prisma.job.count({
      where: {
        companyId,
        status: "COMPLETED",
        completedAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.job.count({
      where: {
        companyId,
        status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD"] },
      },
    }),
    prisma.estimate.findMany({
      where: { companyId, status: { in: ["DRAFT", "SENT", "VIEWED"] } },
      select: { totalCents: true, status: true },
    }),
    prisma.estimate.findMany({
      where: {
        companyId,
        status: "APPROVED",
        approvedAt: { gte: monthStart, lte: monthEnd },
      },
      select: { totalCents: true },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        status: "PAID",
        updatedAt: { gte: monthStart, lte: monthEnd },
      },
      _sum: { totalCents: true },
    }),
    prisma.invoice.findMany({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
      },
      select: { balanceCents: true },
    }),
    prisma.invoice.count({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
        dueDate: { lt: now },
      },
    }),
    prisma.invoice.findMany({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
        dueDate: { lt: now },
      },
      include: { customer: { select: { firstName: true, lastName: true, businessName: true } } },
      orderBy: { balanceCents: "desc" },
      take: 3,
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        status: "PAID",
        updatedAt: { gte: startOfMonth(subMonths(now, 1)), lte: endOfMonth(subMonths(now, 1)) },
      },
      _sum: { totalCents: true },
    }),
    prisma.job.count({
      where: {
        companyId,
        status: { in: ["DISPATCHED", "IN_PROGRESS"] },
        scheduledStart: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.job.count({
      where: { companyId, status: "COMPLETED", completedAt: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.job.count({
      where: {
        companyId,
        completedAt: { gte: monthStart, lte: monthEnd },
        OR: [{ jobType: { contains: "callback", mode: "insensitive" } }, { description: { contains: "callback", mode: "insensitive" } }],
      },
    }),
    prisma.estimate.count({
      where: {
        companyId,
        status: "APPROVED",
        linkedJob: null,
        job: { is: null },
      },
    }),
    prisma.job.count({
      where: {
        companyId,
        status: { in: ["ON_HOLD", "DISPATCHED", "IN_PROGRESS"] },
      },
    }),
    getNeedsAttention(companyId),
    prisma.membership.count({
      where: {
        companyId,
        status: "ACTIVE",
        role: { in: ["TECHNICIAN", "INSTALLER"] },
      },
    }),
    getScheduleJobs(companyId, "today"),
    prisma.expense.aggregate({
      where: { companyId, date: { gte: monthStart, lte: monthEnd } },
      _sum: { amountCents: true },
    }),
    prisma.jobCost.aggregate({
      where: { companyId, createdAt: { gte: monthStart, lte: monthEnd }, confirmed: true },
      _sum: { amountCents: true },
    }),
    prisma.job.count({
      where: {
        companyId,
        status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED"] },
        assignments: { none: {} },
      },
    }),
    prisma.customerMembership.count({
      where: { companyId, saleDate: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.customerMembership.count({
      where: { companyId, status: "ACTIVE" },
    }),
    prisma.customerMembership.count({
      where: {
        companyId,
        status: "ACTIVE",
        renewalDate: { gte: now, lte: addDays(now, 30) },
      },
    }),
    prisma.customerMembership.aggregate({
      where: { companyId, status: "ACTIVE" },
      _sum: { priceCents: true },
    }),
    prisma.lead.findMany({
      where: { companyId, receivedAt: { gte: monthStart, lte: monthEnd } },
      select: { source: true, status: true, attributedRevenueCents: true },
    }),
    prisma.callRecord.count({
      where: { companyId, missed: true, booked: { not: true } },
    }),
    getReportsSummary(companyId),
    prisma.estimate.findMany({
      where: { companyId, status: { in: ["SENT", "VIEWED"] } },
      include: { customer: { select: { firstName: true, lastName: true, businessName: true } } },
      orderBy: { totalCents: "desc" },
      take: 3,
    }),
    prisma.membership.findMany({
      where: { companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      take: 8,
    }),
  ]);

  const openEstimateValue = openEstimates.reduce((s, e) => s + e.totalCents, 0);
  const awaitingDecision = openEstimates.filter((estimate) => estimate.status === "SENT" || estimate.status === "VIEWED").length;
  const wonEstimateValue = wonEstimatesThisMonth.reduce((s, e) => s + e.totalCents, 0);
  const outstandingBalance = unpaidInvoices.reduce((s, i) => s + i.balanceCents, 0);
  const overdueBalance = overdueInvoiceRows.reduce((s, i) => s + i.balanceCents, 0);
  const revenueThisMonth = paidInvoicesThisMonth._sum.totalCents ?? 0;
  const lastMonthRevenue = lastMonthPaid._sum.totalCents ?? 0;
  const expensesCents = expensesThisMonth._sum.amountCents ?? 0;
  const jobCostCents = jobCostsThisMonth._sum.amountCents ?? 0;
  const revenueChangePercent =
    lastMonthRevenue > 0 ? Math.round(((revenueThisMonth - lastMonthRevenue) / lastMonthRevenue) * 100) : null;
  const grossMarginPercent =
    revenueThisMonth > 0 && jobCostCents > 0
      ? Math.round(((revenueThisMonth - jobCostCents) / revenueThisMonth) * 1000) / 10
      : null;

  const rankedAttention = prioritizeAttention(attention);
  const estimatesNeedingFollowUp = attention.filter((a) => a.type === "estimate_not_followed_up").length;
  const runningBehind = attention.filter((a) => a.type === "job_running_behind").length;
  const nextJobs = scheduledJobsToday
    .filter((job) => job.status !== "COMPLETED" && job.status !== "CANCELED")
    .slice(0, 4);
  const upcomingJobs = Math.max(0, jobsToday - jobsCompletedToday - jobsInProgress);

  const bookedLeads = leadsThisMonthRows.filter((lead) => BOOKED_LEAD_STATUSES.includes(lead.status)).length;
  const marketingRevenue = leadsThisMonthRows.reduce((sum, lead) => sum + (lead.attributedRevenueCents ?? 0), 0);
  const sourceTotals = new Map<string, { leads: number; booked: number; revenue: number }>();
  for (const lead of leadsThisMonthRows) {
    const current = sourceTotals.get(lead.source) ?? { leads: 0, booked: 0, revenue: 0 };
    current.leads += 1;
    if (BOOKED_LEAD_STATUSES.includes(lead.status)) current.booked += 1;
    current.revenue += lead.attributedRevenueCents ?? 0;
    sourceTotals.set(lead.source, current);
  }
  const bestSource = [...sourceTotals.entries()]
    .map(([source, totals]) => ({
      source,
      label: LEAD_SOURCE_LABELS[source as keyof typeof LEAD_SOURCE_LABELS] ?? source.replaceAll("_", " "),
      ...totals,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.booked - a.booked || b.leads - a.leads)[0] ?? null;

  const teamCards = await Promise.all(
    techMembers.map(async (member) => ({
      name: `${member.user.firstName} ${member.user.lastName}`.trim(),
      card: await technicianScorecard({ companyId, userId: member.userId, period: "this_month" }),
    }))
  );
  const ticketLeaders = teamCards
    .filter((row) => row.card.averageTicketCents != null)
    .sort((a, b) => (b.card.averageTicketCents ?? 0) - (a.card.averageTicketCents ?? 0));
  const callbackLeaders = teamCards
    .filter((row) => row.card.callbacks > 0)
    .sort((a, b) => b.card.callbacks - a.card.callbacks);
  const teamInsights = [
    ticketLeaders[0]
      ? `${ticketLeaders[0].name} leads the team in average ticket this month.`
      : null,
    callbackLeaders[0] && callbackLeaders[0].card.callbacks >= 2
      ? `${callbackLeaders[0].name} has ${callbackLeaders[0].card.callbacks} callbacks this month.`
      : null,
  ].filter((value): value is string => Boolean(value));

  const nameOf = (customer: { firstName: string; lastName: string; businessName: string | null }) =>
    `${customer.firstName} ${customer.lastName}`.trim() || customer.businessName || "Customer";

  return {
    today: {
      jobsToday,
      completedJobs: jobsCompletedToday,
      inProgressJobs: jobsInProgress,
      upcomingJobs,
      openJobs,
      unassignedJobs,
      runningBehind,
      technicianCount: technicians,
    },
    sales: {
      openEstimates: openEstimates.length,
      estimateValue: openEstimateValue,
      awaitingDecision,
      closeRate: reports.estimateConversionPercent,
      wonEstimateValue,
      membershipsSoldThisMonth,
      opportunities: openEstimateRows.map((estimate) => ({
        id: estimate.id,
        href: `/estimates/${estimate.id}`,
        customerName: nameOf(estimate.customer),
        amountCents: estimate.totalCents,
        status: estimate.status,
        updatedAt: estimate.updatedAt,
      })),
    },
    marketing: {
      leadsThisMonth: leadsThisMonthRows.length,
      bookedLeads,
      revenueCents: marketingRevenue,
      missedCallsOpen,
      bestSource: bestSource && (bestSource.revenue > 0 || bestSource.booked > 0 || bestSource.leads > 0) ? bestSource : null,
    },
    money: {
      revenueThisMonth,
      lastMonthRevenue,
      revenueChangePercent,
      unpaidInvoices: unpaidInvoices.length,
      outstandingBalance,
      overdueInvoices,
      overdueBalance,
      expensesThisMonth: expensesCents,
      contributionThisMonth: revenueThisMonth - expensesCents,
      grossMarginPercent,
      issues: overdueInvoiceRows.map((invoice) => ({
        id: invoice.id,
        href: `/invoices/${invoice.id}`,
        customerName: nameOf(invoice.customer),
        amountCents: invoice.balanceCents,
        dueDate: invoice.dueDate,
      })),
    },
    memberships: {
      active: activeMemberships,
      renewalsDue,
      revenueCents: membershipRevenue._sum.priceCents ?? 0,
      soldThisMonth: membershipsSoldThisMonth,
    },
    followUp: {
      estimatesNeedingFollowUp,
      overdueInvoices,
      unscheduledApprovedJobs: unscheduledApproved,
    },
    operations: {
      jobsNeedingAttention,
      technicianCount: technicians,
      completedThisMonth: jobsCompletedThisMonth,
      callbacks: callbackJobs,
      unassignedJobs,
    },
    team: {
      workingToday: technicians,
      averageTicketCents: ticketLeaders[0]?.card.averageTicketCents ?? null,
      insights: teamInsights.slice(0, 2),
    },
    attention: rankedAttention,
    homeAttention: homeAttentionItems(rankedAttention),
    scheduledJobsToday: nextJobs,
  };
}

export async function getScheduleJobs(companyId: string, view: "today" | "week") {
  const now = new Date();
  const start = view === "today" ? startOfDay(now) : startOfWeek(now, { weekStartsOn: 0 });
  const end = view === "today" ? endOfDay(now) : endOfWeek(now, { weekStartsOn: 0 });

  return prisma.job.findMany({
    where: {
      companyId,
      status: { not: "CANCELED" },
      OR: [
        { scheduledStart: { gte: start, lte: end } },
        {
          AND: [
            { scheduledStart: { lte: start } },
            { scheduledEnd: { gte: start } },
          ],
        },
      ],
    },
    include: {
      customer: true,
      property: true,
      assignments: { include: { user: true } },
    },
    orderBy: { scheduledStart: "asc" },
  });
}

export async function getReportsSummary(companyId: string) {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [revenue, openEstimates, allEstimates, outstanding, completedJobs, expenses] =
    await Promise.all([
      prisma.invoice.aggregate({
        where: { companyId, status: "PAID", updatedAt: { gte: monthStart, lte: monthEnd } },
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.estimate.aggregate({
        where: { companyId, status: { in: ["DRAFT", "SENT", "VIEWED"] } },
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.estimate.groupBy({
        by: ["status"],
        where: { companyId },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: {
          companyId,
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
          balanceCents: { gt: 0 },
        },
        _sum: { balanceCents: true },
        _count: true,
      }),
      prisma.job.count({
        where: { companyId, status: "COMPLETED", completedAt: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.expense.aggregate({
        where: { companyId, date: { gte: monthStart, lte: monthEnd } },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);

  const approved = allEstimates.find((g) => g.status === "APPROVED")?._count ?? 0;
  const decided = allEstimates
    .filter((g) => ["APPROVED", "DECLINED", "EXPIRED"].includes(g.status))
    .reduce((s, g) => s + g._count, 0);
  const conversionRate = decided > 0 ? Math.round((approved / decided) * 100) : null;

  return {
    revenueCents: revenue._sum.totalCents ?? 0,
    revenueCount: revenue._count,
    openEstimatesCount: openEstimates._count,
    openEstimatesValue: openEstimates._sum.totalCents ?? 0,
    estimateConversionPercent: conversionRate,
    outstandingCount: outstanding._count,
    outstandingCents: outstanding._sum.balanceCents ?? 0,
    jobsCompletedThisMonth: completedJobs,
    expensesCents: expenses._sum.amountCents ?? 0,
    expensesCount: expenses._count,
  };
}
