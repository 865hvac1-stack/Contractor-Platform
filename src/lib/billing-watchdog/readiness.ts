import { isHistoricalImport } from "@/lib/imports/safety";
import type { JobBillingReadiness, JobBillingReadinessState } from "@/lib/billing-watchdog/types";

export type ReadinessJob = {
  id: string;
  jobNumber: string;
  status: string;
  jobType?: string | null;
  serviceTypeName?: string | null;
  importMode?: string | null;
  customerId?: string | null;
  checkedInAt?: Date | null;
  checkedOutAt?: Date | null;
  completedAt?: Date | null;
  invoices: Array<{ id: string; invoiceNumber: string; status: string; totalCents: number }>;
  estimateTotalCents?: number | null;
  importedTotalCents?: number | null;
  excluded?: boolean;
  exclusionCode?: string | null;
};

const NO_CHARGE = /warranty|no[\s-]?charge|callback|n\/c|internal|membership/i;

export function looksLikeNoChargeJob(jobType?: string | null, serviceTypeName?: string | null) {
  return NO_CHARGE.test(`${jobType || ""} ${serviceTypeName || ""}`);
}

export function usableEmail(email?: string | null) {
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
}

export function verifiedJobAmountCents(job: {
  invoices: Array<{ status: string; totalCents: number }>;
  estimateTotalCents?: number | null;
  importedTotalCents?: number | null;
}) {
  const liveInvoice = job.invoices.find((invoice) => invoice.status !== "VOID");
  if (liveInvoice) return liveInvoice.totalCents;
  if (typeof job.estimateTotalCents === "number" && job.estimateTotalCents > 0) return job.estimateTotalCents;
  if (typeof job.importedTotalCents === "number" && job.importedTotalCents > 0) return job.importedTotalCents;
  return null;
}

export function getJobBillingReadiness(job: ReadinessJob): JobBillingReadiness {
  const liveInvoice = job.invoices.find((invoice) => invoice.status !== "VOID") ?? null;
  const amountCents = verifiedJobAmountCents(job);
  const amountUnknown = amountCents == null;
  const invoiceHref = liveInvoice ? `/invoices/${liveInvoice.id}` : `/invoices/new?jobId=${job.id}`;

  if (job.excluded || looksLikeNoChargeJob(job.jobType, job.serviceTypeName)) {
    return {
      state: "NOT_REQUIRED",
      label: job.exclusionCode ? `No invoice required — ${job.exclusionCode.replaceAll("_", " ")}` : "No invoice required",
      reason: job.excluded
        ? "This job was excluded from Billing Watchdog."
        : "Job type indicates warranty, callback, or no-charge work.",
      invoiceId: liveInvoice?.id ?? null,
      invoiceNumber: liveInvoice?.invoiceNumber ?? null,
      amountCents,
      amountUnknown,
      actions: [{ label: "Open job", href: `/jobs/${job.id}` }],
    };
  }
  if (liveInvoice) {
    return {
      state: "ALREADY_BILLED",
      label: `Invoiced — ${liveInvoice.invoiceNumber}`,
      reason: "A live invoice already exists for this job.",
      invoiceId: liveInvoice.id,
      invoiceNumber: liveInvoice.invoiceNumber,
      amountCents: liveInvoice.totalCents,
      amountUnknown: false,
      actions: [{ label: "Open invoice", href: `/invoices/${liveInvoice.id}` }],
    };
  }
  if (isHistoricalImport(job.importMode)) {
    return {
      state: "NOT_REQUIRED",
      label: "Historical import",
      reason: "Imported history is not billed from Billing Watchdog.",
      invoiceId: null,
      invoiceNumber: null,
      amountCents,
      amountUnknown,
      actions: [{ label: "Open job", href: `/jobs/${job.id}` }],
    };
  }
  if (!job.customerId) {
    return blocked("BLOCKED — Missing customer", "A customer is required before this job can be invoiced.", job.id, amountCents);
  }
  if (job.status !== "COMPLETED") {
    if (job.status === "IN_PROGRESS" || job.checkedInAt) {
      return blocked(
        "BLOCKED — Technician checkout incomplete",
        "The technician started this job but has not completed checkout.",
        job.id,
        amountCents
      );
    }
    return {
      state: "NEEDS_REVIEW",
      label: "Needs review",
      reason: "Work is not complete enough to invoice yet.",
      invoiceId: null,
      invoiceNumber: null,
      amountCents,
      amountUnknown,
      actions: [{ label: "Review job", href: `/jobs/${job.id}` }],
    };
  }
  return {
    state: "READY",
    label: "Ready to invoice",
    reason: "Job is completed and no live invoice exists.",
    invoiceId: null,
    invoiceNumber: null,
    amountCents,
    amountUnknown,
    actions: [
      { label: "Create invoice", href: invoiceHref },
      { label: "Open job", href: `/jobs/${job.id}` },
    ],
  };
}

function blocked(label: string, reason: string, jobId: string, amountCents: number | null): JobBillingReadiness {
  return {
    state: "BLOCKED" as JobBillingReadinessState,
    label,
    reason,
    invoiceId: null,
    invoiceNumber: null,
    amountCents,
    amountUnknown: amountCents == null,
    actions: [{ label: "Review job", href: `/jobs/${jobId}` }],
  };
}
