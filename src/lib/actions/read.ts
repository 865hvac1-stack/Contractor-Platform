import { addDays, endOfDay, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getCompanyMetrics, type PeriodKey } from "@/lib/intelligence/metrics";
import { getCompanyProfitability } from "@/lib/costing/reporting";
import { technicianScorecard, type ScorePeriod } from "@/lib/performance/scorecard";
import { formatMoney } from "@/lib/money";
import {
  customerDisplayName,
  daysSince,
  daysUntil,
  estimateStillOpen,
  invoiceStillCollectible,
  isSmsOptedOut,
  smsRecipient,
} from "@/lib/actions/eligibility";
import type { ActionContext, ReadActionResult } from "@/lib/actions/types";

function periodOf(value: unknown): PeriodKey {
  if (value === "today" || value === "week" || value === "month" || value === "last_7" || value === "last_30") {
    return value;
  }
  return "month";
}

export async function handleReadAction(
  ctx: ActionContext,
  actionKey: string,
  input: Record<string, unknown>
): Promise<ReadActionResult> {
  switch (actionKey) {
    case "customer.search":
      return searchCustomers(ctx, input);
    case "job.search":
      return searchJobs(ctx, input);
    case "estimate.identify_followups":
      return identifyEstimateFollowups(ctx, input);
    case "invoice.identify_overdue":
      return identifyOverdueInvoices(ctx, input);
    case "membership.identify_renewals":
      return identifyMembershipRenewals(ctx, input);
    case "review.identify_candidates":
      return identifyReviewCandidates(ctx, input);
    case "report.sales_summary":
      return salesSummary(ctx, input);
    case "report.money_summary":
      return moneySummary(ctx, input);
    case "report.job_profitability":
      return jobProfitability(ctx);
    case "report.team_performance":
      return teamPerformance(ctx, input);
    default:
      throw new Error("Unregistered read action.");
  }
}

async function searchCustomers(ctx: ActionContext, input: Record<string, unknown>): Promise<ReadActionResult> {
  const query = String(input.query || "").trim();
  const rows = await prisma.customer.findMany({
    where: {
      companyId: ctx.companyId,
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { businessName: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, email: true, status: true },
    take: 20,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return {
    kind: "READ",
    title: "Customers",
    summary: query ? `${rows.length} customer${rows.length === 1 ? "" : "s"} matching “${query}”.` : `${rows.length} customers.`,
    data: rows.map((row) => ({
      id: row.id,
      name: customerDisplayName(row),
      phone: row.phone,
      email: row.email,
      status: row.status,
    })),
    recordKind: "CUSTOMER",
    recordIds: rows.map((row) => row.id),
    grounding: { sources: ["customers"] },
  };
}

async function searchJobs(ctx: ActionContext, input: Record<string, unknown>): Promise<ReadActionResult> {
  const query = String(input.query || "").trim();
  const when = input.when === "today" || input.when === "tomorrow" ? input.when : null;
  const now = new Date();
  const dayStart = startOfDay(when === "tomorrow" ? addDays(now, 1) : now);
  const dayEnd = endOfDay(when === "tomorrow" ? addDays(now, 1) : now);
  const rows = await prisma.job.findMany({
    where: {
      companyId: ctx.companyId,
      ...(can(ctx.role, "jobs:assigned_only") && !can(ctx.role, "jobs:manage")
        ? { assignments: { some: { userId: ctx.userId } } }
        : {}),
      ...(input.unassigned ? { assignments: { none: {} } } : {}),
      ...(when ? { scheduledStart: { gte: dayStart, lte: dayEnd } } : {}),
      ...(query
        ? {
            OR: [
              { jobNumber: { contains: query, mode: "insensitive" } },
              { jobType: { contains: query, mode: "insensitive" } },
              { customer: { firstName: { contains: query, mode: "insensitive" } } },
              { customer: { lastName: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      status: true,
      scheduledStart: true,
      customer: { select: { firstName: true, lastName: true } },
      assignments: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    take: 25,
    orderBy: { scheduledStart: "asc" },
  });
  return {
    kind: "READ",
    title: "Jobs",
    summary: `${rows.length} job${rows.length === 1 ? "" : "s"} found.`,
    data: rows.map((row) => ({
      id: row.id,
      jobNumber: row.jobNumber,
      jobType: row.jobType,
      status: row.status,
      scheduledStart: row.scheduledStart,
      customer: customerDisplayName(row.customer),
      technician: row.assignments[0]
        ? `${row.assignments[0].user.firstName} ${row.assignments[0].user.lastName}`
        : "Unassigned",
    })),
    recordKind: "JOB",
    recordIds: rows.map((row) => row.id),
    grounding: { sources: ["jobs"] },
  };
}

export async function identifyEstimateFollowups(
  ctx: ActionContext,
  input: Record<string, unknown>
): Promise<ReadActionResult> {
  const minCents = typeof input.minCents === "number" ? input.minCents : 0;
  const minDays = typeof input.minDays === "number" ? input.minDays : 3;
  const cutoff = addDays(new Date(), -minDays);
  const requested = Array.isArray(input.recordIds) ? (input.recordIds as string[]) : [];
  const rows = await prisma.estimate.findMany({
    where: {
      companyId: ctx.companyId,
      ...(requested.length ? { id: { in: requested } } : {}),
      status: { in: ["SENT", "VIEWED"] },
      totalCents: { gte: minCents },
      OR: [{ followUpAt: { lte: new Date() } }, { followUpAt: null, issueDate: { lte: cutoff } }],
    },
    select: {
      id: true,
      estimateNumber: true,
      totalCents: true,
      status: true,
      issueDate: true,
      followUpAt: true,
      customer: {
        select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, tags: true, preferredContactMethod: true },
      },
    },
    orderBy: { totalCents: "desc" },
    take: 25,
  });
  const eligible = rows.filter((row) => estimateStillOpen(row.status));
  const total = eligible.reduce((sum, row) => sum + row.totalCents, 0);
  const criteria = {
    statuses: ["SENT", "VIEWED"],
    minDays,
    minCents,
    note: "Open estimates only. Approved, declined, expired, and canceled estimates are excluded.",
  };
  return {
    kind: "READ",
    title: "Estimates needing follow-up",
    summary:
      eligible.length === 0
        ? "No open estimates currently meet the follow-up criteria."
        : `${eligible.length} open estimate${eligible.length === 1 ? "" : "s"} · ${formatMoney(total)} opportunity.`,
    data: eligible.map((row) => ({
      id: row.id,
      estimateNumber: row.estimateNumber,
      customer: customerDisplayName(row.customer),
      customerId: row.customer.id,
      totalCents: row.totalCents,
      daysOld: daysSince(row.issueDate),
      status: row.status,
      phone: smsRecipient(row.customer),
      optedOut: isSmsOptedOut(row.customer),
    })),
    recordKind: "ESTIMATE",
    recordIds: eligible.map((row) => row.id),
    estimatedImpactCents: total,
    criteria,
    grounding: { sources: ["estimates"] },
  };
}

export async function identifyOverdueInvoices(
  ctx: ActionContext,
  input: Record<string, unknown>
): Promise<ReadActionResult> {
  if (can(ctx.role, "jobs:assigned_only") && !can(ctx.role, "reports:financial") && !can(ctx.role, "invoices:financial")) {
    throw new Error("Invoice totals are limited for this role.");
  }
  const minDays = typeof input.minDays === "number" ? input.minDays : 1;
  const requested = Array.isArray(input.recordIds) ? (input.recordIds as string[]) : [];
  const rows = await prisma.invoice.findMany({
    where: {
      companyId: ctx.companyId,
      ...(requested.length ? { id: { in: requested } } : {}),
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      balanceCents: { gt: 0 },
    },
    select: {
      id: true,
      invoiceNumber: true,
      balanceCents: true,
      totalCents: true,
      status: true,
      dueDate: true,
      customer: {
        select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, tags: true },
      },
    },
    take: 25,
    orderBy: { dueDate: "asc" },
  });
  const eligible = rows.filter((row) => {
    if (!invoiceStillCollectible(row.status, row.balanceCents)) return false;
    return daysSince(row.dueDate) >= minDays;
  });
  const total = eligible.reduce((sum, row) => sum + row.balanceCents, 0);
  return {
    kind: "READ",
    title: "Overdue invoices",
    summary:
      eligible.length === 0
        ? "No invoices currently meet the overdue criteria."
        : `${eligible.length} overdue invoice${eligible.length === 1 ? "" : "s"} · ${formatMoney(total)} outstanding.`,
    data: eligible.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      customer: customerDisplayName(row.customer),
      customerId: row.customer.id,
      balanceCents: row.balanceCents,
      daysOverdue: daysSince(row.dueDate),
      status: row.status,
      phone: smsRecipient(row.customer),
      optedOut: isSmsOptedOut(row.customer),
    })),
    recordKind: "INVOICE",
    recordIds: eligible.map((row) => row.id),
    estimatedImpactCents: total,
    criteria: { minDays, statuses: ["SENT", "PARTIALLY_PAID", "OVERDUE"], balanceGreaterThan: 0 },
    grounding: { sources: ["invoices"] },
  };
}

export async function identifyMembershipRenewals(
  ctx: ActionContext,
  input: Record<string, unknown>
): Promise<ReadActionResult> {
  const withinDays = typeof input.withinDays === "number" ? input.withinDays : 30;
  const requested = Array.isArray(input.recordIds) ? (input.recordIds as string[]) : [];
  const horizon = addDays(new Date(), withinDays);
  const rows = await prisma.customerMembership.findMany({
    where: {
      companyId: ctx.companyId,
      ...(requested.length ? { id: { in: requested } } : {}),
      status: { in: ["ACTIVE", "PAST_DUE"] },
      renewalDate: { lte: horizon, gte: addDays(new Date(), -7) },
    },
    select: {
      id: true,
      priceCents: true,
      renewalDate: true,
      status: true,
      plan: { select: { name: true } },
      customer: {
        select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, tags: true },
      },
    },
    take: 25,
    orderBy: { renewalDate: "asc" },
  });
  const total = rows.reduce((sum, row) => sum + row.priceCents, 0);
  return {
    kind: "READ",
    title: "Memberships nearing renewal",
    summary:
      rows.length === 0
        ? `No memberships are expiring in the next ${withinDays} days.`
        : `${rows.length} membership${rows.length === 1 ? "" : "s"} renewing in the next ${withinDays} days · ${formatMoney(total)}.`,
    data: rows.map((row) => ({
      id: row.id,
      customer: customerDisplayName(row.customer),
      customerId: row.customer.id,
      plan: row.plan.name,
      priceCents: row.priceCents,
      renewalDate: row.renewalDate,
      daysUntilRenewal: daysUntil(row.renewalDate),
      status: row.status,
      phone: smsRecipient(row.customer),
      optedOut: isSmsOptedOut(row.customer),
    })),
    recordKind: "MEMBERSHIP",
    recordIds: rows.map((row) => row.id),
    estimatedImpactCents: total,
    criteria: { withinDays, statuses: ["ACTIVE", "PAST_DUE"] },
    grounding: { sources: ["customer_memberships"] },
  };
}

async function identifyReviewCandidates(ctx: ActionContext, input: Record<string, unknown>): Promise<ReadActionResult> {
  const withinDays = typeof input.withinDays === "number" ? input.withinDays : 7;
  const since = addDays(new Date(), -withinDays);
  const jobs = await prisma.job.findMany({
    where: {
      companyId: ctx.companyId,
      status: "COMPLETED",
      completedAt: { gte: since },
    },
    select: {
      id: true,
      jobNumber: true,
      completedAt: true,
      customer: {
        select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, tags: true },
      },
      invoices: { select: { status: true, balanceCents: true }, take: 3 },
      reviewRequests: { select: { id: true, createdAt: true }, take: 1, orderBy: { createdAt: "desc" } },
    },
    take: 25,
  });
  const eligible = jobs.filter((job) => {
    if (isSmsOptedOut(job.customer)) return false;
    if (job.reviewRequests[0] && daysSince(job.reviewRequests[0].createdAt) < 30) return false;
    const paid = job.invoices.some((invoice) => invoice.status === "PAID" || invoice.balanceCents === 0);
    const hasInvoice = job.invoices.length > 0;
    return !hasInvoice || paid;
  });
  return {
    kind: "READ",
    title: "Review request candidates",
    summary:
      eligible.length === 0
        ? "No completed jobs this week meet the review-request rules."
        : `${eligible.length} completed job${eligible.length === 1 ? "" : "s"} meet the review-request rules.`,
    data: eligible.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      customer: customerDisplayName(job.customer),
      customerId: job.customer.id,
      completedAt: job.completedAt,
      phone: smsRecipient(job.customer),
    })),
    recordKind: "JOB",
    recordIds: eligible.map((job) => job.id),
    criteria: {
      completed: true,
      withinDays,
      paidIfInvoiced: true,
      noRecentReviewRequestDays: 30,
      note: "Happiness is not inferred. Eligibility is completed work, paid if invoiced, and no recent review request.",
    },
    grounding: { sources: ["jobs", "invoices", "review_requests"] },
  };
}

async function salesSummary(ctx: ActionContext, input: Record<string, unknown>): Promise<ReadActionResult> {
  const pack = await getCompanyMetrics(ctx.companyId, periodOf(input.period));
  const keys = [
    "sales.leads_new",
    "sales.leads_booked",
    "sales.booking_rate",
    "sales.estimates_created",
    "sales.estimates_open_value",
    "sales.stale_estimates",
    "sales.close_rate",
  ];
  const metrics = pack.metrics.filter((metric) => keys.includes(metric.key));
  return {
    kind: "READ",
    title: "Sales summary",
    summary: `Sales metrics for ${pack.period.label}.`,
    data: metrics,
    grounding: { sources: ["estimates", "leads"] },
  };
}

async function moneySummary(ctx: ActionContext, input: Record<string, unknown>): Promise<ReadActionResult> {
  if (can(ctx.role, "jobs:assigned_only") && !can(ctx.role, "reports:financial")) {
    throw new Error("Company-wide money totals are limited for this role.");
  }
  const pack = await getCompanyMetrics(ctx.companyId, periodOf(input.period));
  const keys = ["money.invoiced", "money.collected", "money.outstanding", "money.overdue", "money.expenses"];
  return {
    kind: "READ",
    title: "Money summary",
    summary: `Money metrics for ${pack.period.label}.`,
    data: pack.metrics.filter((metric) => keys.includes(metric.key)),
    grounding: { sources: ["invoices", "payments", "expenses"] },
  };
}

async function jobProfitability(ctx: ActionContext): Promise<ReadActionResult> {
  const report = await getCompanyProfitability(ctx.companyId);
  const losing = report.lowestMarginJobs.filter((job) => (job.grossProfitCents ?? 0) < 0);
  return {
    kind: "READ",
    title: "Job profitability",
    summary:
      losing.length === 0
        ? "No jobs with verified costs are currently showing a loss."
        : `${losing.length} job${losing.length === 1 ? "" : "s"} lost money on verified costs.`,
    data: {
      losing,
      lowestMarginJobs: report.lowestMarginJobs,
      averageGrossMarginPercent: report.averageGrossMarginPercent,
    },
    grounding: { sources: ["jobs", "invoices", "job_costs"] },
  };
}

async function teamPerformance(ctx: ActionContext, input: Record<string, unknown>): Promise<ReadActionResult> {
  const members = await prisma.membership.findMany({
    where: { companyId: ctx.companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const period = (["this_week", "last_week", "this_month"].includes(String(input.period))
    ? input.period
    : "this_month") as ScorePeriod;
  const rows = [];
  for (const member of members) {
    const card = await technicianScorecard({
      companyId: ctx.companyId,
      userId: member.userId,
      period,
      includeMargin: can(ctx.role, "job_costs:view"),
    });
    rows.push({
      technician: `${member.user.firstName} ${member.user.lastName}`,
      jobsCompleted: card.jobsCompleted,
      callbacks: card.callbacks,
      revenueCents: card.revenueCents,
      closeRate: card.closeRate,
    });
  }
  rows.sort((a, b) => b.callbacks - a.callbacks);
  return {
    kind: "READ",
    title: "Team performance",
    summary: `${rows.length} technicians for ${period.replaceAll("_", " ")}.`,
    data: { rows, note: "Callbacks and revenue are stored activity, not a ranking of the best technician." },
    grounding: { sources: ["jobs", "invoices", "estimates"] },
  };
}
