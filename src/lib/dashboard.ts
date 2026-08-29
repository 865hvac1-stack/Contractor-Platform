import { startOfDay, endOfDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";

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
    unscheduledApproved,
    jobsNeedingAttention,
    attention,
    technicians,
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
      select: { totalCents: true },
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
  ]);

  const openEstimateValue = openEstimates.reduce((s, e) => s + e.totalCents, 0);
  const wonEstimateValue = wonEstimatesThisMonth.reduce((s, e) => s + e.totalCents, 0);
  const outstandingBalance = unpaidInvoices.reduce((s, i) => s + i.balanceCents, 0);
  const revenueThisMonth = paidInvoicesThisMonth._sum.totalCents ?? 0;

  const estimatesNeedingFollowUp = attention.filter((a) => a.type === "estimate_not_followed_up").length;

  return {
    today: {
      jobsToday,
      completedJobs: jobsCompletedToday,
      openJobs,
    },
    sales: {
      openEstimates: openEstimates.length,
      estimateValue: openEstimateValue,
      wonEstimateValue,
    },
    money: {
      revenueThisMonth,
      unpaidInvoices: unpaidInvoices.length,
      outstandingBalance,
    },
    followUp: {
      estimatesNeedingFollowUp,
      overdueInvoices,
      unscheduledApprovedJobs: unscheduledApproved,
    },
    operations: {
      jobsNeedingAttention,
      technicianCount: technicians,
    },
    attention,
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
