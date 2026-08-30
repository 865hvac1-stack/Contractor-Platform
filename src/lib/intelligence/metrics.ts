import { endOfDay, startOfDay, startOfMonth, endOfMonth, subDays, subMonths } from "date-fns";
import { prisma } from "@/lib/db";
import { BOOKED_LEAD_STATUSES, SOLD_LEAD_STATUSES } from "@/lib/leads/sources";
import { getMarketingHubMetrics } from "@/lib/marketing/metrics";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";

export type MetricUnit = "count" | "cents" | "percent";

export type MetricResult = {
  key: string;
  label: string;
  definition: string;
  available: boolean;
  value: number | null;
  unit: MetricUnit;
  sampleSize: number;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  reason?: string;
  calculatedAt: string;
};

export type PeriodKey = "today" | "week" | "month" | "last_7" | "last_30";

export function resolvePeriod(key: PeriodKey = "month") {
  const now = new Date();
  if (key === "today") {
    return { start: startOfDay(now), end: endOfDay(now), label: "Today" };
  }
  if (key === "week" || key === "last_7") {
    return { start: startOfDay(subDays(now, 6)), end: endOfDay(now), label: "Last 7 days" };
  }
  if (key === "last_30") {
    return { start: startOfDay(subDays(now, 29)), end: endOfDay(now), label: "Last 30 days" };
  }
  return { start: startOfMonth(now), end: endOfMonth(now), label: "This month" };
}

function metric(partial: Omit<MetricResult, "calculatedAt">): MetricResult {
  return { ...partial, calculatedAt: new Date().toISOString() };
}

function unavailable(
  key: string,
  label: string,
  definition: string,
  unit: MetricUnit,
  period: { start: Date; end: Date; label: string },
  reason: string
): MetricResult {
  return metric({
    key,
    label,
    definition,
    available: false,
    value: null,
    unit,
    sampleSize: 0,
    periodLabel: period.label,
    periodStart: period.start,
    periodEnd: period.end,
    reason,
  });
}

export async function getCompanyMetrics(
  companyId: string,
  periodKey: PeriodKey = "month",
  customPeriod?: { start: Date; end: Date; label: string }
) {
  const period = customPeriod ?? resolvePeriod(periodKey);
  const whereCompany = scopedCompanyWhere(companyId);
  const inPeriod = { gte: period.start, lte: period.end };

  const [
    jobsInPeriod,
    jobsCompleted,
    jobsCanceled,
    jobsUnscheduled,
    jobsToday,
    completedJobs,
    estimatesCreated,
    estimatesSent,
    estimatesOpen,
    estimatesSold,
    staleEstimates,
    invoiced,
    collected,
    outstanding,
    overdue,
    expenses,
    leads,
    marketing,
  ] = await Promise.all([
    prisma.job.count({
      where: { ...whereCompany, createdAt: inPeriod, status: { not: "CANCELED" } },
    }),
    prisma.job.count({ where: { ...whereCompany, status: "COMPLETED", completedAt: inPeriod } }),
    prisma.job.count({ where: { ...whereCompany, status: "CANCELED", updatedAt: inPeriod } }),
    prisma.job.count({
      where: { ...whereCompany, status: { in: ["NEW", "UNSCHEDULED"] } },
    }),
    prisma.job.count({
      where: {
        ...whereCompany,
        status: { not: "CANCELED" },
        scheduledStart: { gte: startOfDay(new Date()), lte: endOfDay(new Date()) },
      },
    }),
    prisma.job.findMany({
      where: { ...whereCompany, status: "COMPLETED", completedAt: inPeriod },
      select: { id: true },
    }),
    prisma.estimate.count({ where: { ...whereCompany, createdAt: inPeriod } }),
    prisma.estimate.count({
      where: { ...whereCompany, status: { in: ["SENT", "VIEWED", "APPROVED", "DECLINED"] }, issueDate: inPeriod },
    }),
    prisma.estimate.findMany({
      where: { ...whereCompany, status: { in: ["SENT", "VIEWED"] } },
      select: { totalCents: true },
    }),
    prisma.estimate.findMany({
      where: { ...whereCompany, status: "APPROVED", approvedAt: inPeriod },
      select: { totalCents: true },
    }),
    prisma.estimate.count({
      where: {
        ...whereCompany,
        status: { in: ["SENT", "VIEWED"] },
        issueDate: { lte: subDays(new Date(), 3) },
      },
    }),
    prisma.invoice.aggregate({
      where: { ...whereCompany, issueDate: inPeriod, status: { not: "VOID" } },
      _sum: { totalCents: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { ...whereCompany, status: "PAID", updatedAt: inPeriod },
      _sum: { totalCents: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { ...whereCompany, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, balanceCents: { gt: 0 } },
      _sum: { balanceCents: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: {
        ...whereCompany,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
        dueDate: { lt: new Date() },
      },
      _sum: { balanceCents: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { ...whereCompany, date: inPeriod, status: { not: "REJECTED" } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.lead.findMany({
      where: { ...whereCompany, receivedAt: inPeriod },
      select: { status: true },
    }),
    getMarketingHubMetrics(
      companyId,
      periodKey === "today"
        ? "today"
        : periodKey === "week" || periodKey === "last_7"
          ? "7d"
          : periodKey === "last_30"
            ? "30d"
            : "this_month"
    ),
  ]);

  const jobInvoices = await prisma.invoice.findMany({
    where: {
      ...whereCompany,
      jobId: { in: completedJobs.map((j) => j.id) },
      status: { not: "VOID" },
    },
    select: { totalCents: true, jobId: true },
  });
  const jobExpenses = await prisma.expense.aggregate({
    where: { ...whereCompany, jobId: { in: completedJobs.map((j) => j.id) } },
    _sum: { amountCents: true },
  });

  const jobRevenue = jobInvoices.reduce((s, i) => s + i.totalCents, 0);
  const jobCost = jobExpenses._sum.amountCents ?? 0;
  const avgJobValue =
    completedJobs.length > 0 && jobRevenue > 0 ? Math.round(jobRevenue / completedJobs.length) : null;
  const bookedLeads = leads.filter((l) => BOOKED_LEAD_STATUSES.includes(l.status)).length;
  const soldLeads = leads.filter((l) => SOLD_LEAD_STATUSES.includes(l.status)).length;
  const openEstimatesValue = estimatesOpen.reduce((s, e) => s + e.totalCents, 0);
  const soldValue = estimatesSold.reduce((s, e) => s + e.totalCents, 0);
  const closeRate =
    estimatesSent > 0 ? Math.round((estimatesSold.length / estimatesSent) * 100) : null;
  const bookingRate = leads.length > 0 ? Math.round((bookedLeads / leads.length) * 100) : null;
  const avgSoldTicket =
    estimatesSold.length > 0 ? Math.round(soldValue / estimatesSold.length) : null;
  const grossProfit = completedJobs.length > 0 && (jobRevenue > 0 || jobCost > 0) ? jobRevenue - jobCost : null;
  const grossMargin =
    grossProfit != null && jobRevenue > 0 ? Math.round((grossProfit / jobRevenue) * 100) : null;

  const list: MetricResult[] = [
    metric({
      key: "jobs.today",
      label: "Jobs today",
      definition: "Jobs scheduled today that are not canceled.",
      available: true,
      value: jobsToday,
      unit: "count",
      sampleSize: jobsToday,
      periodLabel: "Today",
      periodStart: startOfDay(new Date()),
      periodEnd: endOfDay(new Date()),
    }),
    metric({
      key: "jobs.in_period",
      label: "Jobs created",
      definition: "Jobs created in the period, excluding canceled.",
      available: true,
      value: jobsInPeriod,
      unit: "count",
      sampleSize: jobsInPeriod,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "jobs.completed",
      label: "Jobs completed",
      definition: "Jobs marked completed in the period.",
      available: true,
      value: jobsCompleted,
      unit: "count",
      sampleSize: jobsCompleted,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "jobs.canceled",
      label: "Jobs canceled",
      definition: "Jobs canceled in the period.",
      available: true,
      value: jobsCanceled,
      unit: "count",
      sampleSize: jobsCanceled,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "jobs.unscheduled",
      label: "Unscheduled jobs",
      definition: "Open jobs in NEW or UNSCHEDULED.",
      available: true,
      value: jobsUnscheduled,
      unit: "count",
      sampleSize: jobsUnscheduled,
      periodLabel: "Now",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    avgJobValue != null
      ? metric({
          key: "jobs.average_value",
          label: "Average completed job value",
          definition: "Invoice totals on completed jobs in the period ÷ completed jobs.",
          available: true,
          value: avgJobValue,
          unit: "cents",
          sampleSize: completedJobs.length,
          periodLabel: period.label,
          periodStart: period.start,
          periodEnd: period.end,
        })
      : unavailable(
          "jobs.average_value",
          "Average completed job value",
          "Invoice totals on completed jobs ÷ completed jobs.",
          "cents",
          period,
          "Not enough completed jobs with invoices yet."
        ),
    metric({
      key: "sales.leads_new",
      label: "New leads",
      definition: "Leads received in the period.",
      available: true,
      value: leads.length,
      unit: "count",
      sampleSize: leads.length,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
    }),
    bookingRate != null
      ? metric({
          key: "sales.booking_rate",
          label: "Booking rate",
          definition: "Booked-through-won leads ÷ new leads in the period.",
          available: true,
          value: bookingRate,
          unit: "percent",
          sampleSize: leads.length,
          periodLabel: period.label,
          periodStart: period.start,
          periodEnd: period.end,
        })
      : unavailable(
          "sales.booking_rate",
          "Booking rate",
          "Booked leads ÷ new leads.",
          "percent",
          period,
          "Not enough leads yet."
        ),
    metric({
      key: "sales.leads_booked",
      label: "Booked leads",
      definition: "Leads in booked, estimate, or won status received in the period.",
      available: true,
      value: bookedLeads,
      unit: "count",
      sampleSize: bookedLeads,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "sales.estimates_created",
      label: "Estimates created",
      definition: "Estimates created in the period.",
      available: true,
      value: estimatesCreated,
      unit: "count",
      sampleSize: estimatesCreated,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "sales.estimates_open_value",
      label: "Open estimate value",
      definition: "Sum of SENT and VIEWED estimate totals. Not sold or declined.",
      available: true,
      value: openEstimatesValue,
      unit: "cents",
      sampleSize: estimatesOpen.length,
      periodLabel: "Open now",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "sales.stale_estimates",
      label: "Stale estimates",
      definition: "SENT or VIEWED estimates issued more than 3 days ago.",
      available: true,
      value: staleEstimates,
      unit: "count",
      sampleSize: staleEstimates,
      periodLabel: "Now",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    closeRate != null
      ? metric({
          key: "sales.close_rate",
          label: "Close rate",
          definition: "Approved estimates in the period ÷ estimates sent in the period.",
          available: true,
          value: closeRate,
          unit: "percent",
          sampleSize: estimatesSent,
          periodLabel: period.label,
          periodStart: period.start,
          periodEnd: period.end,
        })
      : unavailable(
          "sales.close_rate",
          "Close rate",
          "Approved estimates ÷ sent estimates.",
          "percent",
          period,
          "Not enough sent estimates yet."
        ),
    avgSoldTicket != null
      ? metric({
          key: "sales.average_sold_ticket",
          label: "Average sold ticket",
          definition: "Approved estimate totals ÷ sold estimates in the period.",
          available: true,
          value: avgSoldTicket,
          unit: "cents",
          sampleSize: estimatesSold.length,
          periodLabel: period.label,
          periodStart: period.start,
          periodEnd: period.end,
        })
      : unavailable(
          "sales.average_sold_ticket",
          "Average sold ticket",
          "Approved estimate totals ÷ sold count.",
          "cents",
          period,
          "No sold estimates in this period."
        ),
    metric({
      key: "money.invoiced",
      label: "Invoiced",
      definition: "Invoice totals issued in the period, excluding void. Operational view, not a P&L.",
      available: invoiced._count > 0,
      value: invoiced._count > 0 ? invoiced._sum.totalCents ?? 0 : null,
      unit: "cents",
      sampleSize: invoiced._count,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      reason: invoiced._count > 0 ? undefined : "No invoices issued in this period.",
    }),
    metric({
      key: "money.collected",
      label: "Collected",
      definition: "Paid invoice totals marked paid in the period.",
      available: collected._count > 0,
      value: collected._count > 0 ? collected._sum.totalCents ?? 0 : null,
      unit: "cents",
      sampleSize: collected._count,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      reason: collected._count > 0 ? undefined : "No paid invoices in this period.",
    }),
    metric({
      key: "money.outstanding",
      label: "Outstanding invoices",
      definition: "Unpaid balance on sent, partial, or overdue invoices.",
      available: true,
      value: outstanding._sum.balanceCents ?? 0,
      unit: "cents",
      sampleSize: outstanding._count,
      periodLabel: "Now",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "money.overdue",
      label: "Overdue invoices",
      definition: "Unpaid invoices past due date.",
      available: true,
      value: overdue._sum.balanceCents ?? 0,
      unit: "cents",
      sampleSize: overdue._count,
      periodLabel: "Now",
      periodStart: period.start,
      periodEnd: period.end,
    }),
    metric({
      key: "money.expenses",
      label: "Expenses",
      definition: "Recorded expenses in the period, excluding rejected.",
      available: expenses._count > 0,
      value: expenses._count > 0 ? expenses._sum.amountCents ?? 0 : null,
      unit: "cents",
      sampleSize: expenses._count,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      reason: expenses._count > 0 ? undefined : "No expenses recorded in this period.",
    }),
    grossProfit != null
      ? metric({
          key: "money.job_gross_profit",
          label: "Job gross profit",
          definition: "Invoice totals minus expenses on completed jobs in the period. Operational, not accounting-grade.",
          available: true,
          value: grossProfit,
          unit: "cents",
          sampleSize: completedJobs.length,
          periodLabel: period.label,
          periodStart: period.start,
          periodEnd: period.end,
        })
      : unavailable(
          "money.job_gross_profit",
          "Job gross profit",
          "Invoice totals minus job expenses on completed jobs.",
          "cents",
          period,
          "Not enough job cost and invoice data yet."
        ),
    grossMargin != null
      ? metric({
          key: "money.job_gross_margin",
          label: "Job gross margin",
          definition: "Job gross profit ÷ job invoice totals for completed jobs.",
          available: true,
          value: grossMargin,
          unit: "percent",
          sampleSize: completedJobs.length,
          periodLabel: period.label,
          periodStart: period.start,
          periodEnd: period.end,
        })
      : unavailable(
          "money.job_gross_margin",
          "Job gross margin",
          "Job gross profit ÷ job invoice totals.",
          "percent",
          period,
          "Not enough data to calculate margin yet."
        ),
    marketing.costPerLeadCents != null
      ? metric({
          key: "marketing.cpl",
          label: "Cost per lead",
          definition: "Recorded marketing spend ÷ new leads. Spend is advertising expenses plus imported campaign spend.",
          available: true,
          value: marketing.costPerLeadCents,
          unit: "cents",
          sampleSize: marketing.newLeads,
          periodLabel: marketing.period.label,
          periodStart: marketing.period.start,
          periodEnd: marketing.period.end,
        })
      : unavailable(
          "marketing.cpl",
          "Cost per lead",
          "Spend ÷ new leads.",
          "cents",
          period,
          "Need both recorded spend and leads."
        ),
    metric({
      key: "sales.sold_leads",
      label: "Sold leads",
      definition: "Leads marked won in the period.",
      available: true,
      value: soldLeads,
      unit: "count",
      sampleSize: soldLeads,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
    }),
  ];

  return { period, metrics: list, marketing };
}

export function findMetric(metrics: MetricResult[], key: string) {
  return metrics.find((m) => m.key === key) ?? null;
}

export function previousPeriod(periodKey: PeriodKey) {
  if (periodKey === "today") {
    const day = subDays(new Date(), 1);
    return { start: startOfDay(day), end: endOfDay(day), label: "Yesterday" };
  }
  if (periodKey === "week" || periodKey === "last_7") {
    return { start: startOfDay(subDays(new Date(), 13)), end: endOfDay(subDays(new Date(), 7)), label: "Prior 7 days" };
  }
  if (periodKey === "last_30") {
    return { start: startOfDay(subDays(new Date(), 59)), end: endOfDay(subDays(new Date(), 30)), label: "Prior 30 days" };
  }
  const prior = subMonths(new Date(), 1);
  return { start: startOfMonth(prior), end: endOfMonth(prior), label: "Previous month" };
}
