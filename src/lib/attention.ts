import { prisma } from "@/lib/db";
import { parseDefinition, remainingRequiredItems } from "@/lib/playbooks/engine";

/**
 * Reusable Needs Attention architecture.
 * Add new detectors without hard-coding into dashboard components.
 */

export type AttentionSeverity = "critical" | "warning" | "info";

export type AttentionItem = {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: AttentionSeverity;
  href: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
};

export type AttentionDetector = (companyId: string) => Promise<AttentionItem[]>;

const detectors: AttentionDetector[] = [];

export function registerAttentionDetector(detector: AttentionDetector): void {
  detectors.push(detector);
}

export async function getNeedsAttention(companyId: string): Promise<AttentionItem[]> {
  const results = await Promise.all(
    detectors.map(async (detector) => {
      try {
        return await detector(companyId);
      } catch {
        return [];
      }
    })
  );
  return results
    .flat()
    .sort((a, b) => {
      const order: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
}

// ---- Built-in detectors ----

registerAttentionDetector(async (companyId) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const estimates = await prisma.estimate.findMany({
    where: {
      companyId,
      status: { in: ["SENT", "VIEWED"] },
      OR: [{ followUpAt: { lte: new Date() } }, { followUpAt: null, issueDate: { lte: cutoff } }],
    },
    take: 25,
    orderBy: { issueDate: "asc" },
  });
  return estimates.map((e) => ({
    id: `est-followup-${e.id}`,
    type: "estimate_not_followed_up",
    title: "Estimate needs follow-up",
    description: `${e.estimateNumber} · ${formatCents(e.totalCents)}`,
    severity: "warning" as const,
    href: `/estimates/${e.id}`,
    entityType: "Estimate",
    entityId: e.id,
    createdAt: e.issueDate,
  }));
});

registerAttentionDetector(async (companyId) => {
  const estimates = await prisma.estimate.findMany({
    where: {
      companyId,
      status: "APPROVED",
      linkedJob: null,
      jobId: null,
    },
    take: 25,
  });
  // Also find approved estimates whose related job is unscheduled
  const approvedWithUnscheduledJob = await prisma.estimate.findMany({
    where: {
      companyId,
      status: "APPROVED",
      OR: [
        { linkedJob: { status: { in: ["NEW", "UNSCHEDULED"] } } },
        { job: { status: { in: ["NEW", "UNSCHEDULED"] } } },
      ],
    },
    take: 25,
  });

  const items: AttentionItem[] = [
    ...estimates.map((e) => ({
      id: `est-unscheduled-${e.id}`,
      type: "approved_estimate_not_scheduled",
      title: "Approved estimate not scheduled",
      description: `${e.estimateNumber} · ${formatCents(e.totalCents)}`,
      severity: "warning" as const,
      href: `/estimates/${e.id}`,
      entityType: "Estimate",
      entityId: e.id,
      createdAt: e.approvedAt ?? e.updatedAt,
    })),
    ...approvedWithUnscheduledJob.map((e) => ({
      id: `est-job-unscheduled-${e.id}`,
      type: "approved_estimate_not_scheduled",
      title: "Approved work not scheduled",
      description: `${e.estimateNumber}`,
      severity: "warning" as const,
      href: e.jobId ? `/jobs/${e.jobId}` : `/estimates/${e.id}`,
      entityType: "Estimate",
      entityId: e.id,
      createdAt: e.approvedAt ?? e.updatedAt,
    })),
  ];
  return items;
});

registerAttentionDetector(async (companyId) => {
  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      status: "COMPLETED",
      invoices: { none: {} },
    },
    take: 25,
  });
  return jobs.map((j) => ({
    id: `job-no-invoice-${j.id}`,
    type: "job_missing_invoice",
    title: "Completed job missing invoice",
    description: j.jobNumber,
    severity: "warning" as const,
    href: `/jobs/${j.id}`,
    entityType: "Job",
    entityId: j.id,
    createdAt: j.completedAt ?? j.updatedAt,
  }));
});

registerAttentionDetector(async (companyId) => {
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      balanceCents: { gt: 0 },
      dueDate: { lt: now },
    },
    take: 25,
  });
  return invoices.map((inv) => ({
    id: `inv-overdue-${inv.id}`,
    type: "invoice_overdue",
    title: "Overdue invoice",
    description: `${inv.invoiceNumber} · ${formatCents(inv.balanceCents)}`,
    severity: "critical" as const,
    href: `/invoices/${inv.id}`,
    entityType: "Invoice",
    entityId: inv.id,
    createdAt: inv.dueDate ?? inv.issueDate,
  }));
});

registerAttentionDetector(async (companyId) => {
  const stale = new Date();
  stale.setDate(stale.getDate() - 2);
  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      status: { in: ["DISPATCHED", "IN_PROGRESS"] },
      scheduledEnd: { lt: stale },
    },
    take: 25,
  });
  return jobs.map((j) => ({
    id: `job-incomplete-${j.id}`,
    type: "job_missing_completion",
    title: "Job may need completion",
    description: j.jobNumber,
    severity: "info" as const,
    href: `/jobs/${j.id}`,
    entityType: "Job",
    entityId: j.id,
    createdAt: j.scheduledEnd ?? j.updatedAt,
  }));
});

registerAttentionDetector(async (companyId) => {
  const expenses = await prisma.expense.findMany({
    where: {
      companyId,
      category: "OTHER",
      description: { contains: "receipt", mode: "insensitive" },
    },
    take: 10,
  });
  // Receipts needing review
  const receipts = await prisma.receipt.findMany({
    where: {
      companyId,
      processingStatus: { in: ["REVIEW_REQUIRED", "UPLOADED"] },
      expense: null,
    },
    take: 25,
  });
  return [
    ...expenses.map((e) => ({
      id: `exp-uncat-${e.id}`,
      type: "receipt_missing_category",
      title: "Expense needs category review",
      description: e.vendor ?? "Expense",
      severity: "info" as const,
      href: `/expenses/${e.id}`,
      entityType: "Expense",
      entityId: e.id,
      createdAt: e.createdAt,
    })),
    ...receipts.map((r) => ({
      id: `receipt-review-${r.id}`,
      type: "receipt_missing_category",
      title: "Receipt needs review",
      description: r.fileName,
      severity: "info" as const,
      href: `/receipts/${r.id}`,
      entityType: "Receipt",
      entityId: r.id,
      createdAt: r.createdAt,
    })),
  ];
});

registerAttentionDetector(async (companyId) => {
  const expenses = await prisma.expense.findMany({
    where: {
      companyId,
      jobId: null,
      status: { in: ["SUBMITTED", "APPROVED", "POSTED"] },
      category: { in: ["MATERIALS", "EQUIPMENT", "SUBCONTRACTOR", "PERMITS"] },
    },
    take: 25,
  });
  return expenses.map((e) => ({
    id: `exp-no-job-${e.id}`,
    type: "expense_not_assigned_to_job",
    title: "Expense not assigned to a job",
    description: `${e.vendor ?? "Expense"} · ${formatCents(e.amountCents)}`,
    severity: "info" as const,
    href: `/expenses/${e.id}`,
    entityType: "Expense",
    entityId: e.id,
    createdAt: e.createdAt,
  }));
});

registerAttentionDetector(async (companyId) => {
  const leads = await prisma.lead.findMany({
    where: {
      companyId,
      firstRespondedAt: null,
      status: { in: ["NEW", "CONTACTED"] },
    },
    orderBy: { receivedAt: "asc" },
    take: 25,
  });
  return leads.map((lead) => ({
    id: `lead-unanswered-${lead.id}`,
    type: "lead_unanswered",
    title: "Unanswered lead",
    description: `${lead.firstName} ${lead.lastName}`,
    severity: "warning" as const,
    href: `/marketing/leads/${lead.id}`,
    entityType: "Lead",
    entityId: lead.id,
    createdAt: lead.receivedAt,
  }));
});

registerAttentionDetector(async (companyId) => {
  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      status: { in: ["DISPATCHED", "IN_PROGRESS"] },
      playbookId: { not: null },
    },
    include: { playbookSnapshot: true },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });

  const items: AttentionItem[] = [];
  for (const job of jobs) {
    if (!job.playbookSnapshot) continue;
    let remaining;
    try {
      remaining = await remainingRequiredItems({
        companyId,
        jobId: job.id,
        definition: parseDefinition(job.playbookSnapshot.definition),
      });
    } catch {
      continue;
    }
    if (remaining.length === 0) continue;
    items.push({
      id: `playbook-remaining-${job.id}`,
      type: "playbook_required_remaining",
      title: `${remaining.length} item${remaining.length === 1 ? "" : "s"} remaining`,
      description: `${job.jobNumber} · ${remaining.map((item) => item.title).join(", ")}`,
      severity: remaining.length >= 3 ? "warning" : "info",
      href: `/jobs/${job.id}`,
      entityType: "Job",
      entityId: job.id,
      createdAt: job.updatedAt,
    });
  }
  return items;
});

registerAttentionDetector(async (companyId) => {
  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      status: "SCHEDULED",
      assignments: { none: {} },
    },
    take: 20,
  });
  return jobs.map((job) => ({
    id: `job-unassigned-${job.id}`,
    type: "job_missing_technician",
    title: "Scheduled job has no technician",
    description: job.jobNumber,
    severity: "warning" as const,
    href: `/jobs/${job.id}`,
    entityType: "Job",
    entityId: job.id,
    createdAt: job.scheduledStart ?? job.updatedAt,
  }));
});

registerAttentionDetector(async (companyId) => {
  const calls = await prisma.callRecord.findMany({
    where: { companyId, missed: true, booked: { not: true } },
    orderBy: { startedAt: "desc" },
    take: 15,
  });
  return calls.map((call) => ({
    id: `call-missed-${call.id}`,
    type: "missed_call_no_follow_up",
    title: "Missed call not followed up",
    description: call.caller || call.trackingNumber || "Missed call",
    severity: "warning" as const,
    href: "/marketing/communications",
    entityType: "CallRecord",
    entityId: call.id,
    createdAt: call.startedAt,
  }));
});

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
