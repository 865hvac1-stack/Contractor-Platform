import { prisma } from "@/lib/db";
import { collectedAmountCents } from "@/lib/payments/record";
import { authoritativeCosts, calculateJobProfit } from "@/lib/costing/profit";
import {
  AVERAGE_TICKET_DEFINITION,
  AR_DEFINITION,
  COLLECTED_DEFINITION,
  GROSS_PROFIT_DEFINITION,
  OPEN_ESTIMATE_DEFINITION,
  OVERDUE_AR_DEFINITION,
  READY_TO_INVOICE_DEFINITION,
  REVENUE_DEFINITION,
  revenueCategoryLabel,
  collectedPaymentWhere,
  openEstimateWhere,
  overdueInvoiceWhere,
  outstandingInvoiceWhere,
  readyToInvoiceWhere,
  revenueInvoiceWhere,
} from "@/lib/finance/definitions";
import {
  enumerateKeys,
  financeDayKey,
  financeMonthKey,
  financePeriod,
  parseFinanceRange,
  type FinancePeriod,
  type FinanceRange,
} from "@/lib/finance/period";
import { financeHref } from "@/lib/finance/hrefs";

export type FinanceMixSlice = {
  key: string;
  label: string;
  cents: number;
  percent: number;
  href: string;
};

export type FinanceTrendPoint = {
  key: string;
  label: string;
  revenueCents: number;
  collectedCents: number;
  href: string;
};

export type FinancialSnapshot = {
  period: FinancePeriod;
  hasData: boolean;
  revenueCents: number;
  collectedCents: number;
  arCents: number;
  openEstimateCents: number;
  overdueArCents: number;
  averageTicketCents: number | null;
  readyToInvoiceCount: number;
  grossProfitCents: number | null;
  grossProfitAvailable: boolean;
  costCoverageJobs: number;
  revenueJobs: number;
  trend: FinanceTrendPoint[];
  mix: FinanceMixSlice[];
  hrefs: {
    revenue: string;
    collected: string;
    grossProfit: string;
    ar: string;
    openEstimates: string;
    overdueAr: string;
    averageTicket: string;
    readyToInvoice: string;
    money: string;
    reports: string;
  };
  definitions: {
    revenue: string;
    collected: string;
    grossProfit: string;
    ar: string;
  };
};

export async function loadFinancialSnapshot(
  companyId: string,
  range: FinanceRange | string = "month",
  now = new Date()
): Promise<FinancialSnapshot> {
  const period = financePeriod(parseFinanceRange(range), now);
  const { start, end } = period;

  const [paidInvoices, payments, outstanding, overdue, openEstimates, readyJobs] = await Promise.all([
    prisma.invoice.findMany({
      where: revenueInvoiceWhere(companyId, start, end),
      select: {
        id: true,
        totalCents: true,
        updatedAt: true,
        jobId: true,
        serviceType: { select: { name: true } },
        job: { select: { id: true, jobType: true, serviceType: { select: { name: true } } } },
      },
    }),
    prisma.payment.findMany({
      where: collectedPaymentWhere(companyId, start, end),
      select: { amountCents: true, refundedCents: true, status: true, paidAt: true },
    }),
    prisma.invoice.aggregate({
      where: outstandingInvoiceWhere(companyId),
      _sum: { balanceCents: true },
    }),
    prisma.invoice.aggregate({
      where: overdueInvoiceWhere(companyId, now),
      _sum: { balanceCents: true },
    }),
    prisma.estimate.aggregate({
      where: openEstimateWhere(companyId),
      _sum: { totalCents: true },
    }),
    prisma.job.count({ where: readyToInvoiceWhere(companyId) }),
  ]);

  const revenueCents = paidInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const collectedCents = payments.reduce((sum, payment) => sum + collectedAmountCents(payment), 0);
  const arCents = outstanding._sum.balanceCents ?? 0;
  const overdueArCents = overdue._sum.balanceCents ?? 0;
  const openEstimateCents = openEstimates._sum.totalCents ?? 0;
  const averageTicketCents =
    paidInvoices.length > 0 ? Math.round(revenueCents / paidInvoices.length) : null;

  const jobIds = [...new Set(paidInvoices.map((invoice) => invoice.jobId).filter(Boolean))] as string[];
  const gross = await loadGrossProfitForJobs(companyId, jobIds, paidInvoices);

  const trend = buildTrend(period, paidInvoices, payments);
  const mix = buildMix(period, paidInvoices);

  const hasData =
    revenueCents > 0 || collectedCents > 0 || arCents > 0 || openEstimateCents > 0 || overdueArCents > 0;

  return {
    period,
    hasData,
    revenueCents,
    collectedCents,
    arCents,
    openEstimateCents,
    overdueArCents,
    averageTicketCents,
    readyToInvoiceCount: readyJobs,
    grossProfitCents: gross.cents,
    grossProfitAvailable: gross.available,
    costCoverageJobs: gross.costedJobs,
    revenueJobs: gross.revenueJobs,
    trend,
    mix,
    hrefs: {
      revenue: financeHref("/invoices", { period, status: "PAID", view: "revenue" }),
      collected: financeHref("/payments", { period, view: "collected" }),
      grossProfit: financeHref("/reports", { period, view: "profit" }),
      ar: financeHref("/invoices", { status: "OPEN", view: "ar" }),
      openEstimates: "/estimates?status=open&source=home",
      overdueAr: financeHref("/invoices", { status: "overdue", view: "overdue" }),
      averageTicket: financeHref("/invoices", { period, status: "PAID", view: "ticket" }),
      readyToInvoice: "/jobs?status=COMPLETED&needsInvoice=1&source=home",
      money: financeHref("/money", { period }),
      reports: financeHref("/reports", { period }),
    },
    definitions: {
      revenue: REVENUE_DEFINITION,
      collected: COLLECTED_DEFINITION,
      grossProfit: GROSS_PROFIT_DEFINITION,
      ar: AR_DEFINITION,
    },
  };
}

async function loadGrossProfitForJobs(
  companyId: string,
  jobIds: string[],
  invoices: Array<{ jobId: string | null; totalCents: number }>
) {
  if (jobIds.length === 0) {
    return { cents: null, available: false, costedJobs: 0, revenueJobs: 0 };
  }
  const [jobCosts, expenses] = await Promise.all([
    prisma.jobCost.findMany({
      where: { companyId, jobId: { in: jobIds }, confirmed: true },
      select: { jobId: true, amountCents: true, confirmed: true, expenseId: true },
    }),
    prisma.expense.findMany({
      where: { companyId, jobId: { in: jobIds } },
      select: { id: true, jobId: true, amountCents: true },
    }),
  ]);

  const byJob = new Map<string, { revenue: number[]; costs: typeof jobCosts; expenses: typeof expenses }>();
  for (const invoice of invoices) {
    if (!invoice.jobId) continue;
    const current = byJob.get(invoice.jobId) ?? { revenue: [], costs: [], expenses: [] };
    current.revenue.push(invoice.totalCents);
    byJob.set(invoice.jobId, current);
  }
  for (const cost of jobCosts) {
    const current = byJob.get(cost.jobId) ?? { revenue: [], costs: [], expenses: [] };
    current.costs.push(cost);
    byJob.set(cost.jobId, current);
  }
  for (const expense of expenses) {
    if (!expense.jobId) continue;
    const current = byJob.get(expense.jobId) ?? { revenue: [], costs: [], expenses: [] };
    current.expenses.push(expense);
    byJob.set(expense.jobId, current);
  }

  let profit = 0;
  let costedJobs = 0;
  let revenueJobs = 0;
  for (const row of byJob.values()) {
    if (row.revenue.length === 0) continue;
    revenueJobs += 1;
    const costs = authoritativeCosts({ jobCosts: row.costs, expenses: row.expenses });
    const calculated = calculateJobProfit({
      invoiceTotalsCents: row.revenue,
      confirmedCostCents: [costs.confirmedCents],
    });
    if (calculated.directCostCents > 0) {
      costedJobs += 1;
      profit += calculated.grossProfitCents;
    }
  }

  const available = revenueJobs > 0 && costedJobs > 0;
  return {
    cents: available ? profit : null,
    available,
    costedJobs,
    revenueJobs,
  };
}

function buildTrend(
  period: FinancePeriod,
  invoices: Array<{ totalCents: number; updatedAt: Date }>,
  payments: Array<{ amountCents: number; refundedCents: number | null; status: string; paidAt: Date }>
): FinanceTrendPoint[] {
  const keyOf = period.grain === "month" ? financeMonthKey : financeDayKey;
  const revenue = new Map<string, number>();
  const collected = new Map<string, number>();
  for (const invoice of invoices) {
    const key = keyOf(invoice.updatedAt);
    revenue.set(key, (revenue.get(key) ?? 0) + invoice.totalCents);
  }
  for (const payment of payments) {
    const key = keyOf(payment.paidAt);
    collected.set(key, (collected.get(key) ?? 0) + collectedAmountCents(payment));
  }
  return enumerateKeys(period)
    .map((key) => {
      const revenueCents = revenue.get(key) ?? 0;
      const collectedCents = collected.get(key) ?? 0;
      if (revenueCents <= 0 && collectedCents <= 0) return null;
      const bounds =
        period.grain === "month"
          ? { from: `${key}-01`, to: key }
          : { from: key, to: key };
      const href =
        period.grain === "month"
          ? financeHref("/money", {
              from: `${key}-01`,
              to: endOfMonthKey(key),
              view: "day",
            })
          : financeHref("/money", { from: bounds.from, to: bounds.to, view: "day" });
      return {
        key,
        label: period.grain === "month" ? monthLabel(key) : dayLabel(key),
        revenueCents,
        collectedCents,
        href,
      };
    })
    .filter((row): row is FinanceTrendPoint => Boolean(row));
}

function buildMix(
  period: FinancePeriod,
  invoices: Array<{
    totalCents: number;
    serviceType: { name: string } | null;
    job: { jobType: string | null; serviceType: { name: string } | null } | null;
  }>
): FinanceMixSlice[] {
  const grouped = new Map<string, number>();
  for (const invoice of invoices) {
    const label = revenueCategoryLabel(invoice);
    grouped.set(label, (grouped.get(label) ?? 0) + invoice.totalCents);
  }
  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  return [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, cents]) => ({
      key: label,
      label,
      cents,
      percent: total > 0 ? Math.round((cents / total) * 1000) / 10 : 0,
      href: financeHref("/invoices", { period, status: "PAID", view: "revenue", serviceType: label }),
    }));
}

function dayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function endOfMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const last = new Date(year, month, 0);
  return financeDayKey(last);
}

export {
  AVERAGE_TICKET_DEFINITION,
  AR_DEFINITION,
  COLLECTED_DEFINITION,
  GROSS_PROFIT_DEFINITION,
  OPEN_ESTIMATE_DEFINITION,
  OVERDUE_AR_DEFINITION,
  READY_TO_INVOICE_DEFINITION,
  REVENUE_DEFINITION,
};
