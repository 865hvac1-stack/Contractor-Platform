import { prisma } from "@/lib/db";
import { authoritativeCosts, calculateJobProfit, type JobProfit } from "@/lib/costing/profit";
import { JOB_COST_LABELS } from "@/lib/costing/categories";
import type { JobCostCategory } from "@prisma/client";

const VERIFIED_INVOICE = { notIn: ["DRAFT", "VOID"] as Array<"DRAFT" | "VOID"> };

export type JobCostLine = {
  category: JobCostCategory;
  label: string;
  amountCents: number;
  sources: { id: string; description: string; amountCents: number; sourceType: string }[];
};

export type JobFinancials = JobProfit & {
  jobId: string;
  jobNumber: string;
  jobType: string | null;
  breakdown: JobCostLine[];
  unconfirmedReceipts: { id: string; vendor: string | null; totalCents: number | null }[];
  missingCosts: boolean;
  lastUpdated: Date | null;
  isFinal: boolean;
};

export async function loadJobFinancials(companyId: string, jobId: string): Promise<JobFinancials | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    include: {
      invoices: { where: { status: VERIFIED_INVOICE } },
      expenses: true,
      jobCosts: { orderBy: { createdAt: "desc" } },
      receipts: {
        where: { processingStatus: { not: "CONFIRMED" } },
        select: { id: true, vendor: true, totalCents: true, updatedAt: true },
      },
    },
  });
  if (!job) return null;

  const costs = authoritativeCosts({
    jobCosts: job.jobCosts,
    expenses: job.expenses,
  });
  const profit = calculateJobProfit({
    invoiceTotalsCents: job.invoices.map((invoice) => invoice.totalCents),
    confirmedCostCents: [costs.confirmedCents],
  });

  const byCategory = new Map<JobCostCategory, JobCostLine>();
  for (const cost of job.jobCosts.filter((row) => row.confirmed)) {
    const current = byCategory.get(cost.category) ?? {
      category: cost.category,
      label: JOB_COST_LABELS[cost.category],
      amountCents: 0,
      sources: [],
    };
    current.amountCents += cost.amountCents;
    current.sources.push({
      id: cost.id,
      description: cost.description || JOB_COST_LABELS[cost.category],
      amountCents: cost.amountCents,
      sourceType: cost.sourceType,
    });
    byCategory.set(cost.category, current);
  }
  for (const expense of job.expenses.filter((row) => costs.leftoverExpenseIds.includes(row.id))) {
    const category = expense.category === "MATERIALS" ? "MATERIALS" : expense.category === "EQUIPMENT" || expense.category === "TOOLS" ? "EQUIPMENT" : expense.category === "FUEL" || expense.category === "VEHICLE" ? "FUEL" : expense.category === "SUBCONTRACTOR" ? "SUBCONTRACTOR" : expense.category === "PERMITS" ? "PERMIT" : "OTHER";
    const current = byCategory.get(category) ?? {
      category,
      label: JOB_COST_LABELS[category],
      amountCents: 0,
      sources: [],
    };
    current.amountCents += expense.amountCents;
    current.sources.push({
      id: expense.id,
      description: expense.vendor || expense.description || "Expense",
      amountCents: expense.amountCents,
      sourceType: "EXPENSE",
    });
    byCategory.set(category, current);
  }

  const lastCost = job.jobCosts[0]?.updatedAt ?? null;
  const lastInvoice = job.invoices.reduce<Date | null>((latest, invoice) => {
    if (!latest || invoice.updatedAt > latest) return invoice.updatedAt;
    return latest;
  }, null);

  return {
    jobId: job.id,
    jobNumber: job.jobNumber,
    jobType: job.jobType,
    ...profit,
    breakdown: [...byCategory.values()].sort((a, b) => b.amountCents - a.amountCents),
    unconfirmedReceipts: job.receipts,
    missingCosts: profit.revenueCents > 0 && profit.directCostCents === 0,
    lastUpdated: lastCost && lastInvoice ? (lastCost > lastInvoice ? lastCost : lastInvoice) : lastCost ?? lastInvoice,
    isFinal: job.receipts.length === 0,
  };
}
