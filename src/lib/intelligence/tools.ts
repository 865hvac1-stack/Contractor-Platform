import { addDays, endOfDay, startOfDay } from "date-fns";
import type { CompanyRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { jobAccessFilter } from "@/lib/tenant";
import { getNeedsAttention } from "@/lib/attention";
import { getCompanyMetrics, previousPeriod, type PeriodKey } from "@/lib/intelligence/metrics";
import { getOpportunities } from "@/lib/intelligence/opportunities";
import { listActiveInsights } from "@/lib/intelligence/insights";
import { compareMetric } from "@/lib/intelligence/trends";
import { getMarketingHubMetrics, getPerformanceBySource } from "@/lib/marketing/metrics";
import { loadJobWorkflowView } from "@/lib/playbooks/job-view";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";
import { loadJobFinancials } from "@/lib/costing/job";
import { getCompanyProfitability, getVehicleExpenseTotals } from "@/lib/costing/reporting";
import { technicianScorecard, type ScorePeriod } from "@/lib/performance/scorecard";
import { summarizeCompensation } from "@/lib/compensation/calculate";
import { compensationUserFilter } from "@/lib/compensation/access";
import { companyPaymentMetrics } from "@/lib/payments/metrics";
import { collectedAmountCents } from "@/lib/payments/record";

export type ToolContext = {
  companyId: string;
  userId: string;
  role: CompanyRole;
};

export type ToolResult = {
  ok: boolean;
  error?: string;
  data?: unknown;
  grounding?: { sources: string[]; period?: string };
};

const TOOL_PERMISSIONS: Record<string, Permission | Permission[]> = {
  getBusinessSummary: "intelligence:view",
  getTodaySchedule: "schedule:view",
  getOpenEstimates: "estimates:view",
  getEstimateFollowUpOpportunities: "estimates:view",
  getOutstandingInvoices: "invoices:view",
  getLeadMetrics: "leads:view",
  getMarketingPerformance: "marketing:view",
  getCustomerSummary: "customers:view",
  getJobSummary: "jobs:view",
  getPlaybookStatus: "jobs:view",
  getReviewMetrics: "marketing:view",
  getExpenseSummary: "expenses:view",
  getRevenueMetrics: "reports:view",
  getTrend: "intelligence:view",
  getTopInsights: "intelligence:view",
  getOpportunities: "intelligence:view",
  getJobProfitability: "job_costs:view",
  getJobCostBreakdown: "job_costs:view",
  getUnassignedReceipts: "receipts:view",
  getReceiptSummary: "receipts:view",
  getVehicleExpenses: "job_costs:view",
  getMarginByJobType: "job_costs:view",
  getLowMarginJobs: "job_costs:view",
  getJobsMissingCosts: "job_costs:view",
  getTechnicianScorecard: "performance:view_own",
  getTeamPerformance: "performance:view_team",
  getCompensationSummary: "compensation:view_own",
  getMembershipSales: "memberships:view",
  getMembershipConversion: "performance:view_own",
  getPricebookPerformance: "pricebook:view",
  getAverageTicket: "performance:view_own",
  getCloseRate: "performance:view_own",
  getRevenueByTechnician: "performance:view_team",
  getMarginByTechnician: "job_costs:view",
  getPendingCompensation: "compensation:view_own",
  getPricebookItemPerformance: "pricebook:view",
  getDispatchWorkload: "schedule:manage",
  getRouteOptimizationSavings: "routing:optimize",
  getPaymentCollection: "invoices:view",
  getFailedPayments: "invoices:view",
  getProcessingPayments: "invoices:view",
};

export const TOOL_DEFINITIONS = [
  {
    name: "getBusinessSummary",
    description: "Deterministic snapshot of jobs, sales, and money for a period.",
    parameters: { period: { type: "string", enum: ["today", "week", "month", "last_7", "last_30"] } },
  },
  {
    name: "getTodaySchedule",
    description: "Jobs scheduled today or tomorrow.",
    parameters: { when: { type: "string", enum: ["today", "tomorrow"] } },
  },
  {
    name: "getOpenEstimates",
    description: "Open estimates with totals. Optional minimum cents.",
    parameters: { minCents: { type: "number" } },
  },
  {
    name: "getEstimateFollowUpOpportunities",
    description: "Open estimates that need follow-up.",
    parameters: {},
  },
  {
    name: "getOutstandingInvoices",
    description: "Unpaid and overdue invoices.",
    parameters: {},
  },
  {
    name: "getLeadMetrics",
    description: "Lead counts and booking rate for a period.",
    parameters: { period: { type: "string", enum: ["today", "week", "month", "last_7", "last_30"] } },
  },
  {
    name: "getMarketingPerformance",
    description: "Source performance from recorded leads and spend only.",
    parameters: {},
  },
  {
    name: "getCustomerSummary",
    description: "Summary for one customer. Requires customerId from a prior tool.",
    parameters: { customerId: { type: "string" } },
  },
  {
    name: "getJobSummary",
    description: "Job status, customer, and playbook remaining items.",
    parameters: { jobId: { type: "string" } },
  },
  {
    name: "getPlaybookStatus",
    description: "Required playbook items still open on a job.",
    parameters: { jobId: { type: "string" } },
  },
  {
    name: "getReviewMetrics",
    description: "Imported review counts and rating.",
    parameters: {},
  },
  {
    name: "getExpenseSummary",
    description: "Recorded expenses this month.",
    parameters: {},
  },
  {
    name: "getRevenueMetrics",
    description: "Operational invoiced, collected, outstanding. Not a P&L.",
    parameters: { period: { type: "string", enum: ["today", "week", "month", "last_7", "last_30"] } },
  },
  {
    name: "getTrend",
    description: "Compare a known metric this period vs prior period.",
    parameters: {
      metricKey: { type: "string" },
      period: { type: "string", enum: ["week", "month", "last_7", "last_30"] },
    },
  },
  {
    name: "getTopInsights",
    description: "Needs-attention items and stored insights.",
    parameters: {},
  },
  {
    name: "getOpportunities",
    description: "Rule-based follow-up and repeat opportunities.",
    parameters: {},
  },
  {
    name: "getJobProfitability",
    description: "Verified job revenue, confirmed costs, profit, and margin. Deterministic math only.",
    parameters: { jobId: { type: "string" } },
  },
  {
    name: "getJobCostBreakdown",
    description: "Confirmed cost lines for one job, with source records.",
    parameters: { jobId: { type: "string" } },
  },
  {
    name: "getUnassignedReceipts",
    description: "Receipts that still need review or assignment.",
    parameters: {},
  },
  {
    name: "getReceiptSummary",
    description: "Receipt inbox counts for this company.",
    parameters: {},
  },
  {
    name: "getVehicleExpenses",
    description: "Confirmed truck/vehicle receipt totals this month. Operational, not accounting-grade.",
    parameters: {},
  },
  {
    name: "getMarginByJobType",
    description: "Verified gross margin grouped by job type.",
    parameters: {},
  },
  {
    name: "getLowMarginJobs",
    description: "Jobs with the lowest verified gross margin.",
    parameters: {},
  },
  {
    name: "getJobsMissingCosts",
    description: "Jobs with revenue but no confirmed costs, or unreviewed receipts.",
    parameters: {},
  },
  {
    name: "getTechnicianScorecard",
    description: "Verified technician scorecard for this week, last week, or this month. Uses stored activity only.",
    parameters: {
      period: { type: "string", enum: ["this_week", "last_week", "this_month"] },
      userId: { type: "string" },
    },
  },
  {
    name: "getTeamPerformance",
    description: "Team comparison of verified jobs, revenue, close rate, memberships, and incentives.",
    parameters: { period: { type: "string", enum: ["this_week", "last_week", "this_month"] } },
  },
  {
    name: "getCompensationSummary",
    description: "Stored incentive totals by status. Never invents compensation math.",
    parameters: {},
  },
  {
    name: "getMembershipSales",
    description: "Recorded membership sales and attribution.",
    parameters: {},
  },
  {
    name: "getMembershipConversion",
    description: "Memberships sold versus estimates presented for a technician.",
    parameters: { userId: { type: "string" } },
  },
  {
    name: "getPricebookPerformance",
    description: "Pricebook items used on approved estimates, with revenue totals.",
    parameters: {},
  },
  {
    name: "getAverageTicket",
    description: "Deterministic average invoice total for a technician.",
    parameters: { userId: { type: "string" } },
  },
  {
    name: "getCloseRate",
    description: "Deterministic estimate close rate for a technician.",
    parameters: { userId: { type: "string" } },
  },
  {
    name: "getRevenueByTechnician",
    description: "Verified invoiced revenue grouped by assigned technician.",
    parameters: {},
  },
  {
    name: "getMarginByTechnician",
    description: "Verified gross profit by technician. Requires job cost permission.",
    parameters: {},
  },
  {
    name: "getPendingCompensation",
    description: "Stored pending and qualified incentive events only.",
    parameters: {},
  },
  {
    name: "getPricebookItemPerformance",
    description: "One Pricebook item's approved estimate usage.",
    parameters: { itemId: { type: "string" } },
  },
  {
    name: "getDispatchWorkload",
    description: "Today's assigned job counts and unassigned queue. Does not invent drive times.",
    parameters: {},
  },
  {
    name: "getRouteOptimizationSavings",
    description: "Verified route optimization savings from applied RouteOptimizationRun records only.",
    parameters: {},
  },
  {
    name: "getPaymentCollection",
    description: "Verified collected, outstanding, processing, failed, and refunded payment totals. Never invents transactions.",
    parameters: { period: { type: "string", enum: ["today", "week", "month"] } },
  },
  {
    name: "getFailedPayments",
    description: "Failed electronic payments this month from stored Payment records only.",
    parameters: {},
  },
  {
    name: "getProcessingPayments",
    description: "Bank/card payments still processing. These are not collected yet.",
    parameters: {},
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

function deny(error: string): ToolResult {
  return { ok: false, error };
}

function periodOf(value: unknown): PeriodKey {
  if (value === "today" || value === "week" || value === "last_7" || value === "last_30") return value;
  return "month";
}

function allowed(ctx: ToolContext, name: string) {
  const required = TOOL_PERMISSIONS[name];
  if (!required) return false;
  const list = Array.isArray(required) ? required : [required];
  return list.every((permission) => can(ctx.role, permission));
}

export async function runIntelligenceTool(
  ctx: ToolContext,
  name: string,
  rawArgs: Record<string, unknown>
): Promise<ToolResult> {
  const args = { ...rawArgs };
  delete args.companyId;
  delete args.company_id;

  if (!allowed(ctx, name)) {
    return deny("You do not have access to that information.");
  }

  const fieldSafeTools = new Set([
    "getTodaySchedule",
    "getJobSummary",
    "getPlaybookStatus",
    "getTechnicianScorecard",
    "getCompensationSummary",
    "getPendingCompensation",
    "getAverageTicket",
    "getCloseRate",
    "getMembershipConversion",
  ]);
  if (can(ctx.role, "jobs:assigned_only") && !can(ctx.role, "reports:view") && !fieldSafeTools.has(name)) {
    return deny("That company information is not available in the field.");
  }

  const assigned = jobAccessFilter(ctx.role, ctx.userId);
  const companyWhere = scopedCompanyWhere(ctx.companyId);

  switch (name) {
    case "getBusinessSummary": {
      const pack = await getCompanyMetrics(ctx.companyId, periodOf(args.period));
      return {
        ok: true,
        data: pack.metrics.map((m) => ({
          key: m.key,
          label: m.label,
          available: m.available,
          value: m.value,
          unit: m.unit,
          reason: m.reason,
          definition: m.definition,
          period: m.periodLabel,
        })),
        grounding: { sources: ["jobs", "estimates", "invoices", "leads", "expenses"], period: pack.period.label },
      };
    }
    case "getTodaySchedule": {
      const base = args.when === "tomorrow" ? addDays(new Date(), 1) : new Date();
      const jobs = await prisma.job.findMany({
        where: {
          ...companyWhere,
          ...assigned,
          status: { not: "CANCELED" },
          scheduledStart: { gte: startOfDay(base), lte: endOfDay(base) },
        },
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          serviceType: { select: { name: true } },
          status: true,
          scheduledStart: true,
          customer: { select: { firstName: true, lastName: true } },
        },
        orderBy: { scheduledStart: "asc" },
        take: 20,
      });
      return {
        ok: true,
        data: jobs,
        grounding: { sources: ["jobs"], period: args.when === "tomorrow" ? "Tomorrow" : "Today" },
      };
    }
    case "getOpenEstimates": {
      const min = typeof args.minCents === "number" ? args.minCents : 0;
      const rows = await prisma.estimate.findMany({
        where: { ...companyWhere, status: { in: ["SENT", "VIEWED"] }, totalCents: { gte: min } },
        select: {
          id: true,
          estimateNumber: true,
          totalCents: true,
          status: true,
          issueDate: true,
          customer: { select: { firstName: true, lastName: true } },
        },
        orderBy: { totalCents: "desc" },
        take: 20,
      });
      return { ok: true, data: rows, grounding: { sources: ["estimates"] } };
    }
    case "getEstimateFollowUpOpportunities": {
      const attention = await getNeedsAttention(ctx.companyId);
      return {
        ok: true,
        data: attention.filter((a) => a.type.includes("estimate")),
        grounding: { sources: ["estimates", "needs_attention"] },
      };
    }
    case "getOutstandingInvoices": {
      if (can(ctx.role, "jobs:assigned_only") && !can(ctx.role, "reports:financial")) {
        return deny("Invoice totals are limited for this role.");
      }
      const rows = await prisma.invoice.findMany({
        where: {
          ...companyWhere,
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
          balanceCents: { gt: 0 },
        },
        select: {
          id: true,
          invoiceNumber: true,
          balanceCents: true,
          dueDate: true,
          status: true,
          customer: { select: { firstName: true, lastName: true } },
        },
        take: 20,
      });
      return { ok: true, data: rows, grounding: { sources: ["invoices"] } };
    }
    case "getLeadMetrics": {
      const pack = await getCompanyMetrics(ctx.companyId, periodOf(args.period));
      const keys = ["sales.leads_new", "sales.leads_booked", "sales.booking_rate", "sales.sold_leads"];
      return {
        ok: true,
        data: pack.metrics.filter((m) => keys.includes(m.key)),
        grounding: { sources: ["leads"], period: pack.period.label },
      };
    }
    case "getMarketingPerformance": {
      const metrics = await getMarketingHubMetrics(ctx.companyId, "30d");
      const bySource = await getPerformanceBySource(ctx.companyId, "30d");
      return {
        ok: true,
        data: { metrics, bySource },
        grounding: { sources: ["leads", "marketing_spend", "attribution"], period: "Last 30 days" },
      };
    }
    case "getCustomerSummary": {
      const customerId = String(args.customerId || "");
      if (!customerId) return deny("A customer is required.");
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, companyId: ctx.companyId },
        select: { id: true, firstName: true, lastName: true, businessName: true, createdAt: true },
      });
      if (!customer) return deny("Customer not found.");
      const [jobs, invoices, estimates] = await Promise.all([
        prisma.job.count({ where: { companyId: ctx.companyId, customerId } }),
        prisma.invoice.aggregate({
          where: { companyId: ctx.companyId, customerId, status: "PAID" },
          _sum: { totalCents: true },
        }),
        prisma.estimate.findMany({
          where: { companyId: ctx.companyId, customerId, status: { in: ["SENT", "VIEWED"] } },
          select: { totalCents: true, estimateNumber: true },
        }),
      ]);
      const lastJob = await prisma.job.findFirst({
        where: { companyId: ctx.companyId, customerId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      });
      return {
        ok: true,
        data: {
          name: customer.businessName || `${customer.firstName} ${customer.lastName}`,
          customerSince: customer.createdAt,
          jobs,
          collectedCents: invoices._sum.totalCents ?? 0,
          lastServiceAt: lastJob?.completedAt ?? null,
          openEstimates: estimates,
        },
        grounding: { sources: ["customers", "jobs", "invoices", "estimates"] },
      };
    }
    case "getJobSummary":
    case "getPlaybookStatus": {
      const jobId = String(args.jobId || "");
      if (!jobId) return deny("A job is required.");
      const job = await prisma.job.findFirst({
        where: { id: jobId, companyId: ctx.companyId, ...assigned },
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          serviceType: { select: { name: true } },
          status: true,
          internalNotes: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      if (!job) return deny("Job not found or you are not assigned to it.");
      const workflow = await loadJobWorkflowView(ctx.companyId, job.id);
      return {
        ok: true,
        data: {
          job: {
            id: job.id,
            jobNumber: job.jobNumber,
            jobType: job.serviceType?.name || job.jobType,
            serviceType: job.serviceType?.name ?? null,
            status: job.status,
            customer: job.customer,
            notesPresent: Boolean(job.internalNotes),
          },
          playbookName: workflow?.playbookName ?? null,
          remaining: workflow?.remaining ?? [],
          currentStage: workflow?.currentStageKey ?? null,
        },
        grounding: { sources: ["jobs", "playbooks"] },
      };
    }
    case "getReviewMetrics": {
      const reviews = await prisma.review.findMany({
        where: companyWhere,
        select: { rating: true, needsResponse: true },
        take: 200,
      });
      const rated = reviews.filter((r) => r.rating != null);
      const avg =
        rated.length > 0 ? Number((rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(2)) : null;
      return {
        ok: true,
        data: {
          count: reviews.length,
          average: avg,
          needsResponse: reviews.filter((r) => r.needsResponse).length,
        },
        grounding: { sources: ["reviews"] },
      };
    }
    case "getExpenseSummary": {
      const pack = await getCompanyMetrics(ctx.companyId, "month");
      return {
        ok: true,
        data: pack.metrics.filter((m) => m.key === "money.expenses"),
        grounding: { sources: ["expenses"], period: pack.period.label },
      };
    }
    case "getRevenueMetrics": {
      if (can(ctx.role, "jobs:assigned_only") && !can(ctx.role, "reports:view")) {
        return deny("Company-wide money totals are not available for this role.");
      }
      const pack = await getCompanyMetrics(ctx.companyId, periodOf(args.period));
      return {
        ok: true,
        data: pack.metrics.filter((m) => m.key.startsWith("money.")),
        grounding: { sources: ["invoices", "expenses"], period: pack.period.label },
      };
    }
    case "getTrend": {
      const key = String(args.metricKey || "sales.booking_rate");
      const period = periodOf(args.period);
      const current = await getCompanyMetrics(ctx.companyId, period);
      const currentMetric = current.metrics.find((m) => m.key === key);
      if (!currentMetric?.available || currentMetric.value == null) {
        return {
          ok: true,
          data: { label: "INSUFFICIENT", reason: currentMetric?.reason ?? "Not enough data yet." },
          grounding: { sources: ["metrics"] },
        };
      }
      const priorPack = await getCompanyMetrics(ctx.companyId, period, previousPeriod(period));
      const prior = priorPack.metrics.find((m) => m.key === key);
      const compared = compareMetric({
        metricKey: key,
        current: currentMetric.value,
        previous: prior?.value ?? 0,
        sampleSize: currentMetric.sampleSize + (prior?.sampleSize ?? 0),
      });
      return { ok: true, data: compared, grounding: { sources: ["metrics"], period: current.period.label } };
    }
    case "getTopInsights": {
      const [attention, insights] = await Promise.all([
        getNeedsAttention(ctx.companyId),
        listActiveInsights(ctx.companyId),
      ]);
      return {
        ok: true,
        data: { attention: attention.slice(0, 8), insights: insights.slice(0, 7) },
        grounding: { sources: ["needs_attention", "insights"] },
      };
    }
    case "getOpportunities": {
      const rows = await getOpportunities(ctx.companyId);
      return { ok: true, data: rows, grounding: { sources: ["estimates", "leads", "jobs"] } };
    }
    case "getJobProfitability":
    case "getJobCostBreakdown": {
      const jobId = String(args.jobId || "");
      if (!jobId) return deny("A job is required.");
      const job = await prisma.job.findFirst({
        where: { id: jobId, companyId: ctx.companyId },
        select: { id: true },
      });
      if (!job) return deny("Job not found.");
      const financials = await loadJobFinancials(ctx.companyId, job.id);
      if (!financials) return deny("Job not found.");
      return {
        ok: true,
        data:
          name === "getJobProfitability"
            ? {
                jobNumber: financials.jobNumber,
                revenueCents: financials.revenueCents,
                directCostCents: financials.directCostCents,
                grossProfitCents: financials.grossProfitCents,
                grossMarginPercent: financials.grossMarginPercent,
                isFinal: financials.isFinal,
                unconfirmedReceipts: financials.unconfirmedReceipts.length,
              }
            : {
                jobNumber: financials.jobNumber,
                breakdown: financials.breakdown,
                unconfirmedReceipts: financials.unconfirmedReceipts,
              },
        grounding: { sources: ["invoices", "job_costs", "receipts", "expenses"] },
      };
    }
    case "getUnassignedReceipts": {
      const receipts = await prisma.receipt.findMany({
        where: {
          ...companyWhere,
          OR: [
            { processingStatus: { in: ["UPLOADED", "REVIEW_REQUIRED"] } },
            { assignment: "UNASSIGNED", processingStatus: { not: "CONFIRMED" } },
          ],
        },
        select: { id: true, vendor: true, totalCents: true, processingStatus: true, assignment: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 25,
      });
      return { ok: true, data: receipts, grounding: { sources: ["receipts"] } };
    }
    case "getReceiptSummary": {
      const [needsReview, unassigned, duplicates, confirmed] = await Promise.all([
        prisma.receipt.count({
          where: { ...companyWhere, processingStatus: { in: ["UPLOADED", "REVIEW_REQUIRED"] } },
        }),
        prisma.receipt.count({
          where: { ...companyWhere, assignment: "UNASSIGNED", processingStatus: { not: "CONFIRMED" } },
        }),
        prisma.receipt.count({ where: { ...companyWhere, duplicateStatus: "POSSIBLE" } }),
        prisma.receipt.count({ where: { ...companyWhere, processingStatus: "CONFIRMED" } }),
      ]);
      return {
        ok: true,
        data: { needsReview, unassigned, possibleDuplicates: duplicates, confirmed },
        grounding: { sources: ["receipts"] },
      };
    }
    case "getVehicleExpenses": {
      const rows = await getVehicleExpenseTotals(ctx.companyId);
      return { ok: true, data: rows, grounding: { sources: ["receipts", "vehicles"], period: "This month" } };
    }
    case "getMarginByJobType": {
      const pack = await getCompanyProfitability(ctx.companyId);
      return { ok: true, data: pack.byJobType, grounding: { sources: ["invoices", "job_costs"] } };
    }
    case "getLowMarginJobs": {
      const pack = await getCompanyProfitability(ctx.companyId);
      return { ok: true, data: pack.lowestMarginJobs, grounding: { sources: ["invoices", "job_costs"] } };
    }
    case "getJobsMissingCosts": {
      const pack = await getCompanyProfitability(ctx.companyId);
      return {
        ok: true,
        data: { missingCosts: pack.missingCosts, unreviewedReceipts: pack.unreviewedReceipts },
        grounding: { sources: ["invoices", "job_costs", "receipts"] },
      };
    }
    case "getTechnicianScorecard":
    case "getAverageTicket":
    case "getCloseRate":
    case "getMembershipConversion": {
      const requested = typeof args.userId === "string" ? args.userId : ctx.userId;
      if (requested !== ctx.userId && !can(ctx.role, "performance:view_team")) {
        return deny("You can only view your own scorecard.");
      }
      const period = (["this_week", "last_week", "this_month"].includes(String(args.period))
        ? args.period
        : "this_week") as ScorePeriod;
      const card = await technicianScorecard({
        companyId: ctx.companyId,
        userId: requested,
        period,
        includeMargin: can(ctx.role, "job_costs:view"),
      });
      if (name === "getAverageTicket") {
        return { ok: true, data: { averageTicketCents: card.averageTicketCents }, grounding: { sources: ["invoices"] } };
      }
      if (name === "getCloseRate") {
        return {
          ok: true,
          data: { presented: card.estimatesPresented, approved: card.estimatesApproved, closeRate: card.closeRate },
          grounding: { sources: ["estimates"] },
        };
      }
      if (name === "getMembershipConversion") {
        return {
          ok: true,
          data: {
            presented: card.estimatesPresented,
            membershipsSold: card.membershipsSold,
            membershipConversion: card.membershipConversion,
          },
          grounding: { sources: ["estimates", "customer_memberships"] },
        };
      }
      return {
        ok: true,
        data: {
          ...card,
          events: card.events.map((event) => ({
            id: event.id,
            amountCents: event.amountCents,
            status: event.status,
            calculationBasis: event.calculationBasis,
            earnedAt: event.earnedAt,
          })),
          note: "Best technician is not assumed from revenue alone. Compare close rate, memberships, callbacks, and reviews when those exist.",
        },
        grounding: { sources: ["jobs", "invoices", "estimates", "customer_memberships", "compensation_events"] },
      };
    }
    case "getTeamPerformance":
    case "getRevenueByTechnician": {
      const members = await prisma.membership.findMany({
        where: { companyId: ctx.companyId, status: "ACTIVE" },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
      const period = (["this_week", "last_week", "this_month"].includes(String(args.period))
        ? args.period
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
          revenueCents: card.revenueCents,
          averageTicketCents: card.averageTicketCents,
          closeRate: card.closeRate,
          membershipsSold: card.membershipsSold,
          membershipConversion: card.membershipConversion,
          callbacks: card.callbacks,
          reviews: card.reviews,
          incentives: card.incentives,
        });
      }
      return {
        ok: true,
        data: {
          rows,
          note: "Do not rank a single best technician from revenue alone.",
        },
        grounding: { sources: ["jobs", "invoices", "estimates", "customer_memberships"] },
      };
    }
    case "getCompensationSummary":
    case "getPendingCompensation": {
      const filter = compensationUserFilter(ctx.role, ctx.userId);
      if (!filter) return deny("You do not have access to compensation.");
      const events = await prisma.compensationEvent.findMany({
        where: { companyId: ctx.companyId, ...filter },
        select: { amountCents: true, status: true, calculationBasis: true, userId: true },
      });
      if (name === "getPendingCompensation") {
        return {
          ok: true,
          data: {
            events: events.filter((event) => event.status === "PENDING" || event.status === "QUALIFIED"),
            note: "Pending and qualified are not paid.",
          },
          grounding: { sources: ["compensation_events"] },
        };
      }
      return {
        ok: true,
        data: { ...summarizeCompensation(events), note: "Stored events only. AI did not calculate these amounts." },
        grounding: { sources: ["compensation_events"] },
      };
    }
    case "getMembershipSales": {
      const rows = await prisma.customerMembership.findMany({
        where: companyWhere,
        select: {
          id: true,
          status: true,
          priceCents: true,
          saleDate: true,
          plan: { select: { name: true } },
          soldBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { saleDate: "desc" },
        take: 50,
      });
      return { ok: true, data: rows, grounding: { sources: ["customer_memberships"] } };
    }
    case "getPricebookPerformance":
    case "getPricebookItemPerformance": {
      const itemId = typeof args.itemId === "string" ? args.itemId : null;
      const items = await prisma.estimateLineItem.findMany({
        where: {
          pricebookItemId: itemId ?? { not: null },
          estimate: { companyId: ctx.companyId, status: "APPROVED" },
        },
        select: {
          name: true,
          quantity: true,
          unitPriceCents: true,
          pricebookItemId: true,
          pricebookItem: { select: { name: true, standardPriceCents: true, internalCostCents: true } },
        },
        take: 200,
      });
      const grouped = new Map<string, { name: string; count: number; revenueCents: number }>();
      for (const item of items) {
        const key = item.pricebookItemId ?? item.name;
        const current = grouped.get(key) ?? { name: item.pricebookItem?.name ?? item.name, count: 0, revenueCents: 0 };
        current.count += 1;
        current.revenueCents += Math.round(Number(item.quantity) * item.unitPriceCents);
        grouped.set(key, current);
      }
      return {
        ok: true,
        data: [...grouped.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 20),
        grounding: { sources: ["pricebook_items", "estimates"] },
      };
    }
    case "getDispatchWorkload": {
      const start = startOfDay(new Date());
      const end = endOfDay(new Date());
      const [technicians, assigned, unassigned] = await Promise.all([
        prisma.membership.findMany({
          where: { companyId: ctx.companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
          include: { user: { select: { firstName: true, lastName: true } } },
        }),
        prisma.job.findMany({
          where: {
            companyId: ctx.companyId,
            status: { not: "CANCELED" },
            scheduledStart: { gte: start, lte: end },
            assignments: { some: {} },
          },
          select: {
            id: true,
            jobNumber: true,
            assignments: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
          },
        }),
        prisma.job.count({
          where: {
            companyId: ctx.companyId,
            status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED"] },
            assignments: { none: {} },
          },
        }),
      ]);
      return {
        ok: true,
        data: {
          unassignedJobs: unassigned,
          technicians: technicians.map((member) => ({
            name: `${member.user.firstName} ${member.user.lastName}`.trim(),
            jobsToday: assigned.filter((job) => job.assignments.some((row) => row.userId === member.userId)).length,
          })),
        },
        grounding: { sources: ["jobs", "job_assignments"], period: "Today" },
      };
    }
    case "getRouteOptimizationSavings": {
      const weekStart = startOfDay(addDays(new Date(), -7));
      const runs = await prisma.routeOptimizationRun.findMany({
        where: {
          companyId: ctx.companyId,
          status: "APPLIED",
          appliedAt: { gte: weekStart },
          currentSeconds: { not: null },
          suggestedSeconds: { not: null },
        },
        select: { currentSeconds: true, suggestedSeconds: true, currentMeters: true, suggestedMeters: true },
      });
      const savedSeconds = runs.reduce(
        (sum, run) => sum + Math.max(0, (run.currentSeconds ?? 0) - (run.suggestedSeconds ?? 0)),
        0
      );
      const savedMeters = runs.reduce(
        (sum, run) => sum + Math.max(0, (run.currentMeters ?? 0) - (run.suggestedMeters ?? 0)),
        0
      );
      return {
        ok: true,
        data: {
          appliedRuns: runs.length,
          savedMinutes: Math.round(savedSeconds / 60),
          savedMiles: Math.round((savedMeters / 1609.34) * 10) / 10,
          note: runs.length
            ? "From applied RouteOptimizationRun records only."
            : "No applied route optimizations this week. AI does not invent drive time.",
        },
        grounding: { sources: ["route_optimization_runs"], period: "Last 7 days" },
      };
    }
    case "getMarginByTechnician": {
      if (!can(ctx.role, "job_costs:view")) return deny("Gross profit is restricted.");
      const members = await prisma.membership.findMany({
        where: { companyId: ctx.companyId, status: "ACTIVE" },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      const rows = [];
      for (const member of members) {
        const jobs = await prisma.job.findMany({
          where: { companyId: ctx.companyId, assignments: { some: { userId: member.userId } }, status: "COMPLETED" },
          select: { id: true },
          take: 25,
        });
        let profit = 0;
        let revenue = 0;
        for (const job of jobs) {
          const financials = await loadJobFinancials(ctx.companyId, job.id);
          if (!financials) continue;
          profit += financials.grossProfitCents;
          revenue += financials.revenueCents;
        }
        rows.push({
          technician: `${member.user.firstName} ${member.user.lastName}`,
          verifiedJobs: jobs.length,
          revenueCents: revenue,
          grossProfitCents: profit,
        });
      }
      return { ok: true, data: rows, grounding: { sources: ["invoices", "job_costs", "jobs"] } };
    }
    case "getPaymentCollection": {
      const metrics = await companyPaymentMetrics(prisma, ctx.companyId);
      return {
        ok: true,
        data: {
          collectedTodayCents: metrics.collectedTodayCents,
          collectedWeekCents: metrics.collectedWeekCents,
          collectedMonthCents: metrics.collectedMonthCents,
          outstandingCents: metrics.outstandingCents,
          processingCents: metrics.processingCents,
          failedCents: metrics.failedCents,
          refundedMonthCents: metrics.refundedMonthCents,
          note: "From stored Payment and Invoice rows only. Pending and failed payments are not collected.",
        },
        grounding: { sources: ["payments", "invoices"] },
      };
    }
    case "getFailedPayments": {
      const start = startOfDay(new Date());
      start.setDate(1);
      const failed = await prisma.payment.findMany({
        where: { companyId: ctx.companyId, status: "FAILED", paidAt: { gte: start } },
        select: { amountCents: true, method: true, paidAt: true, invoiceId: true },
        take: 25,
      });
      return {
        ok: true,
        data: {
          count: failed.length,
          totalCents: failed.reduce((sum, row) => sum + row.amountCents, 0),
          payments: failed,
        },
        grounding: { sources: ["payments"], period: "This month" },
      };
    }
    case "getProcessingPayments": {
      const processing = await prisma.payment.findMany({
        where: { companyId: ctx.companyId, status: "PROCESSING" },
        select: { amountCents: true, method: true, paidAt: true, invoiceId: true },
        take: 25,
      });
      return {
        ok: true,
        data: {
          count: processing.length,
          totalCents: processing.reduce((sum, row) => sum + collectedAmountCents({ ...row, status: "PROCESSING" }), 0),
          processingCents: processing.reduce((sum, row) => sum + row.amountCents, 0),
          note: "Processing payments are not collected and do not mark invoices paid.",
          payments: processing,
        },
        grounding: { sources: ["payments"] },
      };
    }
    default:
      return deny("Unknown tool.");
  }
}

export function openaiToolSpecs() {
  return TOOL_DEFINITIONS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters,
        additionalProperties: false,
      },
    },
  }));
}
