import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  subMonths,
  subYears,
  addDays,
} from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { attentionFilterCounts, homeAttentionItems, prioritizeAttention } from "@/lib/attention-priority";
import { BOOKED_LEAD_STATUSES, LEAD_SOURCE_LABELS } from "@/lib/leads/sources";
import { technicianScorecard } from "@/lib/performance/scorecard";
import { arAgingBuckets, bucketRevenueSeries, computeHealthScore } from "@/lib/health-score";
import { buildCommandObservations } from "@/lib/command-observations";

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
      select: { totalCents: true, approvedAt: true },
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
      select: { balanceCents: true, dueDate: true },
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

  const [
    paymentsForSeries,
    membershipsSoldToday,
    reviewsTodayRows,
    reviewsMonthRows,
    reviewRequestsPending,
    newCustomersToday,
    estimateStages,
    companyGoals,
    completedTodayJobs,
    membershipsSoldTodayRows,
    repeatCustomerGroups,
    lostEstimatesThisMonth,
    leadsTodayRows,
    callsToday,
    missedCallsToday,
    reviewCount,
  ] = await Promise.all([
    prisma.payment.findMany({
      where: {
        companyId,
        status: "SUCCEEDED",
        paidAt: { gte: subMonths(now, 12) },
      },
      select: { paidAt: true, amountCents: true },
    }),
    prisma.customerMembership.count({
      where: { companyId, saleDate: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.review.findMany({
      where: { companyId, reviewedAt: { gte: dayStart, lte: dayEnd } },
      select: { rating: true },
    }),
    prisma.review.findMany({
      where: { companyId, reviewedAt: { gte: monthStart, lte: monthEnd } },
      select: { rating: true },
    }),
    prisma.reviewRequest.count({
      where: { companyId, status: { in: ["SUGGESTED", "QUEUED", "SENT"] } },
    }),
    prisma.customer.count({
      where: { companyId, createdAt: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.estimate.groupBy({
      by: ["status"],
      where: { companyId },
      _count: true,
      _sum: { totalCents: true },
    }),
    prisma.performanceGoal.findMany({
      where: { companyId, userId: null },
      select: { metricKey: true, target: true, period: true },
    }),
    prisma.job.findMany({
      where: {
        companyId,
        status: "COMPLETED",
        completedAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        assignments: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
        invoices: { select: { totalCents: true, status: true } },
      },
    }),
    prisma.customerMembership.findMany({
      where: { companyId, saleDate: { gte: dayStart, lte: dayEnd } },
      select: { soldById: true, priceCents: true },
    }),
    prisma.job.groupBy({
      by: ["customerId"],
      where: {
        companyId,
        status: "COMPLETED",
        completedAt: { gte: subYears(now, 1) },
      },
      _count: { customerId: true },
    }),
    prisma.estimate.aggregate({
      where: { companyId, status: "DECLINED", updatedAt: { gte: monthStart, lte: monthEnd } },
      _count: true,
      _sum: { totalCents: true },
    }),
    prisma.lead.findMany({
      where: { companyId, receivedAt: { gte: dayStart, lte: dayEnd } },
      select: { status: true, attributedRevenueCents: true },
    }),
    prisma.callRecord.count({
      where: { companyId, startedAt: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.callRecord.count({
      where: { companyId, startedAt: { gte: dayStart, lte: dayEnd }, missed: true },
    }),
    prisma.review.count({ where: { companyId } }),
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

  const collectedToday = paymentsForSeries
    .filter((payment) => payment.paidAt && payment.paidAt >= dayStart && payment.paidAt <= dayEnd)
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const soldTodayCents = wonEstimatesThisMonth
    .filter((estimate) => estimate.approvedAt && estimate.approvedAt >= dayStart && estimate.approvedAt <= dayEnd)
    .reduce((sum, estimate) => sum + estimate.totalCents, 0);
  const aging = arAgingBuckets(unpaidInvoices, now);
  const paymentPoints = paymentsForSeries
    .filter((payment) => payment.paidAt)
    .map((payment) => ({ at: payment.paidAt as Date, amountCents: payment.amountCents }));
  const revenueSeries = {
    d30: bucketRevenueSeries(paymentPoints, "30d", now),
    d90: bucketRevenueSeries(paymentPoints, "90d", now),
    m12: bucketRevenueSeries(paymentPoints, "12m", now),
  };
  const reviewRatings = (rows: Array<{ rating: number | null }>) => {
    const rated = rows.map((row) => row.rating).filter((value): value is number => value != null);
    const average = rated.length > 0 ? Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) / 10 : null;
    return { count: rows.length, average };
  };
  const reviewsToday = reviewRatings(reviewsTodayRows);
  const reviewsMonth = reviewRatings(reviewsMonthRows);
  const goalByKey = (key: string) => companyGoals.find((goal) => goal.metricKey === key)?.target ?? null;
  const revenueGoalCents = goalByKey("revenue");
  const closeRateGoal = goalByKey("close_rate") != null ? goalByKey("close_rate")! / 10 : null;
  const membershipGoal = goalByKey("memberships") ?? goalByKey("membership_conversion");
  const stageValue = (status: string) => estimateStages.find((row) => row.status === status)?._sum.totalCents ?? 0;
  const stageCount = (status: string) => estimateStages.find((row) => row.status === status)?._count ?? 0;
  const techToday = new Map<
    string,
    { name: string; revenueCents: number; jobsCompleted: number; membershipsSold: number }
  >();
  for (const job of completedTodayJobs) {
    const revenue = job.invoices
      .filter((invoice) => invoice.status !== "DRAFT" && invoice.status !== "VOID")
      .reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const assignees = job.assignments.length > 0 ? job.assignments : [];
    for (const assignment of assignees) {
      const current = techToday.get(assignment.userId) ?? {
        name: `${assignment.user.firstName} ${assignment.user.lastName}`.trim(),
        revenueCents: 0,
        jobsCompleted: 0,
        membershipsSold: 0,
      };
      current.revenueCents += revenue;
      current.jobsCompleted += 1;
      techToday.set(assignment.userId, current);
    }
  }
  for (const membership of membershipsSoldTodayRows) {
    if (!membership.soldById) continue;
    const current = techToday.get(membership.soldById);
    if (current) current.membershipsSold += 1;
  }
  const leaderboard = [...techToday.values()]
    .sort((a, b) => b.revenueCents - a.revenueCents || b.jobsCompleted - a.jobsCompleted)
    .slice(0, 3)
    .map((row) => ({
      ...row,
      averageTicketCents: row.jobsCompleted > 0 ? Math.round(row.revenueCents / row.jobsCompleted) : null,
    }));
  const topTechToday = leaderboard[0] && leaderboard[0].revenueCents > 0 ? leaderboard[0] : null;
  const health = computeHealthScore({
    closeRate: reports.estimateConversionPercent,
    openEstimateValue,
    estimatesNeedingFollowUp,
    revenueThisMonth,
    outstandingBalance,
    overdueBalance,
    jobsToday,
    runningLate: runningBehind,
    unassignedJobs,
    callbacks: callbackJobs,
    completedThisMonth: jobsCompletedThisMonth,
    activeMemberships,
    reviewsThisMonth: reviewsMonth.count,
    missedCallsOpen,
    averageTicketCents: ticketLeaders[0]?.card.averageTicketCents ?? null,
    teamCallbacks: callbackLeaders[0]?.card.callbacks ?? 0,
    leadsThisMonth: leadsThisMonthRows.length,
    bookedLeads,
  });
  const observations = buildCommandObservations({
    revenueThisMonth,
    lastMonthRevenue,
    overdueBalance,
    openEstimateValue,
    estimatesNeedingFollowUp,
    topTechName: topTechToday?.name ?? null,
    topTechRevenueCents: topTechToday?.revenueCents ?? null,
    runningLate: runningBehind,
  });
  const repeatCustomers = repeatCustomerGroups.filter((row) => row._count.customerId >= 2).length;

  return {
    generatedAt: now,
    health,
    observations,
    today: {
      jobsToday,
      completedJobs: jobsCompletedToday,
      inProgressJobs: jobsInProgress,
      upcomingJobs,
      openJobs,
      unassignedJobs,
      runningBehind,
      technicianCount: technicians,
      collectedCents: collectedToday,
      soldCents: soldTodayCents,
      membershipsSold: membershipsSoldToday,
      reviews: reviewsToday.count,
      topTech: topTechToday,
    },
    sales: {
      openEstimates: openEstimates.length,
      estimateValue: openEstimateValue,
      awaitingDecision,
      closeRate: reports.estimateConversionPercent,
      wonEstimateValue,
      membershipsSoldThisMonth,
      pipeline: {
        draft: { count: stageCount("DRAFT"), valueCents: stageValue("DRAFT") },
        sent: { count: stageCount("SENT"), valueCents: stageValue("SENT") },
        viewed: { count: stageCount("VIEWED"), valueCents: stageValue("VIEWED") },
        approved: { count: stageCount("APPROVED"), valueCents: stageValue("APPROVED") },
        declinedThisMonth: lostEstimatesThisMonth._count,
      },
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
      leadsToday: leadsTodayRows.length,
      bookedToday: leadsTodayRows.filter((lead) => BOOKED_LEAD_STATUSES.includes(lead.status)).length,
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
      aging,
      revenueSeries,
      revenueGoalCents,
      closeRateGoal,
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
      soldToday: membershipsSoldToday,
      goal: membershipGoal,
    },
    reviews: {
      today: reviewsToday.count,
      month: reviewsMonth.count,
      average: reviewsToday.average ?? reviewsMonth.average,
      pendingRequests: reviewRequestsPending,
      connected: reviewCount > 0,
    },
    customers: {
      newToday: newCustomersToday,
      repeatLastYear: repeatCustomers,
      missedCallsOpen,
      callsToday,
      missedCallsToday,
      bookedToday: leadsTodayRows.filter((lead) => BOOKED_LEAD_STATUSES.includes(lead.status)).length,
    },
    goals: {
      revenueCents: revenueGoalCents,
      closeRate: closeRateGoal,
      memberships: membershipGoal,
      marginPercent: goalByKey("gross_margin") != null ? goalByKey("gross_margin")! / 10 : null,
    },
    team: {
      workingToday: technicians,
      averageTicketCents: ticketLeaders[0]?.card.averageTicketCents ?? null,
      insights: teamInsights.slice(0, 2),
      leaderboard,
      topTechToday,
    },
    attentionCounts: attentionFilterCounts(rankedAttention),
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
