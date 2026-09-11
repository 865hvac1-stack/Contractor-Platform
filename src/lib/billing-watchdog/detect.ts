import { isHistoricalImport } from "@/lib/imports/safety";
import {
  getJobBillingReadiness,
  looksLikeNoChargeJob,
  usableEmail,
  verifiedJobAmountCents,
} from "@/lib/billing-watchdog/readiness";
import type {
  BillingWatchdogSettingsView,
  BillingWatchdogSeverity,
  DetectedFinding,
} from "@/lib/billing-watchdog/types";
import { TYPE_LABELS } from "@/lib/billing-watchdog/labels";

const SUCCESS_PAYMENTS = new Set(["CONFIRMED", "SUCCEEDED", "RECORDED", "PARTIALLY_REFUNDED"]);
const FINANCIAL_CLOSE = new Set(["INVOICE", "PAYMENT", "SIGNATURE"]);

function collectedAmountCents(payment: { status: string; amountCents: number; refundedCents?: number | null }) {
  if (!SUCCESS_PAYMENTS.has(payment.status) && payment.status !== "REFUNDED") return 0;
  return Math.max(0, payment.amountCents - (payment.refundedCents ?? 0));
}

export type DetectJob = {
  id: string;
  companyId: string;
  jobNumber: string;
  status: string;
  jobType?: string | null;
  serviceTypeName?: string | null;
  importMode?: string | null;
  customerId: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  importedTotalCents?: number | null;
  estimateTotalCents?: number | null;
  technicianId?: string | null;
  photoCount?: number;
  remainingPlaybookKeys?: string[];
};

export type DetectInvoice = {
  id: string;
  companyId: string;
  invoiceNumber: string;
  status: string;
  jobId: string | null;
  customerId: string;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  issueDate: Date;
  dueDate: Date | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveryStatus: string;
  lastDeliveryError?: string | null;
  importMode?: string | null;
  updatedAt?: Date;
};

export type DetectPayment = {
  id: string;
  invoiceId: string;
  customerId?: string | null;
  amountCents: number;
  refundedCents?: number | null;
  status: string;
  paidAt: Date;
  importMode?: string | null;
};

export type DetectCustomer = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
};

export type DetectQboMap = {
  internalId: string;
  status: string;
  lastSyncedAt?: Date | null;
};

export type DetectInput = {
  companyId: string;
  asOf: Date;
  settings: BillingWatchdogSettingsView;
  jobs: DetectJob[];
  invoices: DetectInvoice[];
  payments: DetectPayment[];
  customers: DetectCustomer[];
  qboConnected: boolean;
  qboInvoiceMaps: DetectQboMap[];
  qboPaymentMaps: DetectQboMap[];
  excludedFingerprints: Set<string>;
  excludedJobIds: Set<string>;
};

function hoursAgo(asOf: Date, date: Date) {
  return (asOf.getTime() - date.getTime()) / 36e5;
}

function daysAgo(asOf: Date, date: Date) {
  return Math.floor((asOf.getTime() - date.getTime()) / 864e5);
}

function afterStart(date: Date, start: Date) {
  return date >= start;
}

function customerName(customers: Map<string, DetectCustomer>, id?: string | null) {
  return (id && customers.get(id)?.name) || "Customer";
}

function fingerprint(type: string, key: string) {
  return `${type}:${key}`;
}

export function analyzeBillingHealth(input: DetectInput): DetectedFinding[] {
  const customers = new Map(input.customers.map((row) => [row.id, row]));
  const invoicesByJob = new Map<string, DetectInvoice[]>();
  for (const invoice of input.invoices) {
    if (!invoice.jobId) continue;
    const list = invoicesByJob.get(invoice.jobId) ?? [];
    list.push(invoice);
    invoicesByJob.set(invoice.jobId, list);
  }
  const paymentsByInvoice = new Map<string, DetectPayment[]>();
  for (const payment of input.payments) {
    const list = paymentsByInvoice.get(payment.invoiceId) ?? [];
    list.push(payment);
    paymentsByInvoice.set(payment.invoiceId, list);
  }
  const qboInvoices = new Map(input.qboInvoiceMaps.map((row) => [row.internalId, row]));
  const qboPayments = new Map(input.qboPaymentMaps.map((row) => [row.internalId, row]));
  const findings: DetectedFinding[] = [];

  const push = (finding: DetectedFinding) => {
    if (input.excludedFingerprints.has(finding.fingerprint)) return;
    if (finding.jobId && input.excludedJobIds.has(finding.jobId) && finding.type === "COMPLETED_NO_INVOICE") return;
    findings.push(finding);
  };

  for (const job of input.jobs) {
    if (isHistoricalImport(job.importMode)) continue;
    const jobInvoices = invoicesByJob.get(job.id) ?? [];
    const readiness = getJobBillingReadiness({
      ...job,
      invoices: jobInvoices,
      excluded: input.excludedJobIds.has(job.id),
    });
    const name = customerName(customers, job.customerId);
    const expectedEnd = job.scheduledEnd ?? job.scheduledStart ?? job.checkedInAt ?? job.createdAt;
    const graceMs = input.settings.checkoutGraceMinutes * 60_000;
    const started = Boolean(job.checkedInAt) || job.status === "IN_PROGRESS";
    const checkedOut = job.status === "COMPLETED" || Boolean(job.checkedOutAt);
    const remaining = job.remainingPlaybookKeys ?? [];
    const onlyFinancialLeft = remaining.length > 0 && remaining.every((key) => FINANCIAL_CLOSE.has(key));
    const workEvidence = (job.photoCount ?? 0) > 0 || onlyFinancialLeft;

    if (
      started &&
      !checkedOut &&
      job.status !== "CANCELED" &&
      job.status !== "ON_HOLD" &&
      expectedEnd.getTime() + graceMs < input.asOf.getTime()
    ) {
      const type = workEvidence ? "READY_TO_INVOICE_CHECKOUT_INCOMPLETE" : "TECH_CHECKOUT_INCOMPLETE";
      push({
        fingerprint: fingerprint(type, `job:${job.id}`),
        type,
        severity: "ACTION_NEEDED",
        jobId: job.id,
        invoiceId: null,
        paymentId: null,
        customerId: job.customerId,
        technicianId: job.technicianId ?? null,
        amountAtRiskCents: readiness.amountCents,
        amountUnknown: readiness.amountUnknown,
        title: name,
        subtitle: job.jobNumber,
        reason:
          type === "READY_TO_INVOICE_CHECKOUT_INCOMPLETE"
            ? "Work looks finished, but technician checkout is still incomplete."
            : `Technician started this job and never completed checkout.`,
        recommendedAction: "Review the job and finish checkout. Do not invent completion.",
        actions: [
          { label: "Review job", href: `/jobs/${job.id}` },
          ...(job.technicianId ? [{ label: "Contact technician", href: `/team` }] : []),
        ],
        metadata: { jobNumber: job.jobNumber, status: job.status, expectedEnd: expectedEnd.toISOString() },
      });
    }

    if (job.status === "COMPLETED" && !input.excludedJobIds.has(job.id) && !looksLikeNoChargeJob(job.jobType, job.serviceTypeName)) {
      const completedTime = job.completedAt ?? job.checkedOutAt ?? job.createdAt;
      if (!afterStart(completedTime, input.settings.startDate)) continue;
      if (hoursAgo(input.asOf, completedTime) < input.settings.completedInvoiceGraceHours) continue;
      const live = jobInvoices.some((invoice) => invoice.status !== "VOID");
      if (live) continue;
      const amount = verifiedJobAmountCents({
        invoices: jobInvoices,
        estimateTotalCents: job.estimateTotalCents,
        importedTotalCents: job.importedTotalCents,
      });
      const ageDays = daysAgo(input.asOf, completedTime);
      const severity: BillingWatchdogSeverity =
        amount != null && amount >= 100_000 && ageDays >= 2 ? "CRITICAL" : "ACTION_NEEDED";
      push({
        fingerprint: fingerprint("COMPLETED_NO_INVOICE", `job:${job.id}`),
        type: "COMPLETED_NO_INVOICE",
        severity,
        jobId: job.id,
        invoiceId: null,
        paymentId: null,
        customerId: job.customerId,
        technicianId: job.technicianId ?? null,
        amountAtRiskCents: amount,
        amountUnknown: amount == null,
        title: name,
        subtitle: job.jobNumber,
        reason: "No invoice was created after job completion.",
        recommendedAction: "Create an invoice from verified job or estimate amounts only.",
        actions: [
          { label: "Create invoice", href: `/invoices/new?jobId=${job.id}` },
          { label: "Open job", href: `/jobs/${job.id}` },
        ],
        metadata: { jobNumber: job.jobNumber, completedAt: completedTime.toISOString() },
      });
    }
  }

  for (const invoice of input.invoices) {
    if (isHistoricalImport(invoice.importMode) || invoice.status === "VOID") continue;
    if (!afterStart(invoice.createdAt, input.settings.startDate) && !afterStart(invoice.issueDate, input.settings.startDate)) {
      continue;
    }
    const customer = customers.get(invoice.customerId);
    const name = customerName(customers, invoice.customerId);
    const ageHours = hoursAgo(input.asOf, invoice.createdAt);
    const sent = Boolean(invoice.sentAt) || ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "REFUNDED", "PARTIALLY_REFUNDED"].includes(invoice.status);
    const draftInGrace = invoice.status === "DRAFT" && ageHours < input.settings.invoiceSendGraceHours;
    const missingEmail = !usableEmail(customer?.email);
    const siblings = paymentsByInvoice.get(invoice.id) ?? [];
    const collected = siblings.reduce((sum, payment) => sum + collectedAmountCents(payment), 0);

    if (invoice.deliveryStatus === "FAILED") {
      push({
        fingerprint: fingerprint("INVOICE_DELIVERY_FAILED", `invoice:${invoice.id}`),
        type: "INVOICE_DELIVERY_FAILED",
        severity: invoice.totalCents >= 50_000 ? "CRITICAL" : "ACTION_NEEDED",
        jobId: invoice.jobId,
        invoiceId: invoice.id,
        paymentId: null,
        customerId: invoice.customerId,
        technicianId: null,
        amountAtRiskCents: invoice.balanceCents,
        amountUnknown: false,
        title: name,
        subtitle: invoice.invoiceNumber,
        reason: invoice.lastDeliveryError || "The invoice delivery provider reported a failure.",
        recommendedAction: "Fix the contact and resend only after a verified address exists.",
        actions: [
          { label: "Fix contact", href: `/customers/${invoice.customerId}` },
          { label: "Open invoice", href: `/invoices/${invoice.id}` },
        ],
        metadata: { deliveryStatus: invoice.deliveryStatus },
      });
    } else if (!sent && !draftInGrace) {
      if (missingEmail) {
        push({
          fingerprint: fingerprint("CUSTOMER_MISSING_EMAIL", `invoice:${invoice.id}`),
          type: "CUSTOMER_MISSING_EMAIL",
          severity: "ACTION_NEEDED",
          jobId: invoice.jobId,
          invoiceId: invoice.id,
          paymentId: null,
          customerId: invoice.customerId,
          technicianId: null,
          amountAtRiskCents: invoice.totalCents,
          amountUnknown: false,
          title: name,
          subtitle: invoice.invoiceNumber,
          reason: "Cannot email invoice — customer email is missing.",
          recommendedAction: "Add a usable email or send a text payment link.",
          actions: [
            { label: "Add email", href: `/customers/${invoice.customerId}` },
            ...(customer?.phone ? [{ label: "Text payment link", href: `/invoices/${invoice.id}` }] : []),
            { label: "Open invoice", href: `/invoices/${invoice.id}` },
          ],
          metadata: { invoiceNumber: invoice.invoiceNumber },
        });
      } else {
        push({
          fingerprint: fingerprint("INVOICE_NOT_SENT", `invoice:${invoice.id}`),
          type: "INVOICE_NOT_SENT",
          severity: "ACTION_NEEDED",
          jobId: invoice.jobId,
          invoiceId: invoice.id,
          paymentId: null,
          customerId: invoice.customerId,
          technicianId: null,
          amountAtRiskCents: invoice.totalCents,
          amountUnknown: false,
          title: name,
          subtitle: invoice.invoiceNumber,
          reason: "Invoice exists but has never been successfully sent.",
          recommendedAction: "Send the invoice to the customer.",
          actions: [{ label: "Send invoice", href: `/invoices/${invoice.id}` }],
          metadata: { invoiceNumber: invoice.invoiceNumber, status: invoice.status },
        });
      }
    }

    if (collected > 0 && (invoice.amountPaidCents < collected - 1 || (collected >= invoice.totalCents && invoice.balanceCents > 0 && invoice.status !== "PAID" && invoice.status !== "REFUNDED"))) {
      const offender = siblings.find((payment) => SUCCESS_PAYMENTS.has(payment.status)) ?? siblings[0];
      push({
        fingerprint: fingerprint("PAYMENT_NOT_APPLIED", `invoice:${invoice.id}`),
        type: "PAYMENT_NOT_APPLIED",
        severity: "CRITICAL",
        jobId: invoice.jobId,
        invoiceId: invoice.id,
        paymentId: offender?.id ?? null,
        customerId: invoice.customerId,
        technicianId: null,
        amountAtRiskCents: collected,
        amountUnknown: false,
        title: name,
        subtitle: invoice.invoiceNumber,
        reason: "A verified payment exists but is not correctly applied to this invoice.",
        recommendedAction: "Review the payment. Do not move money between invoices automatically.",
        actions: [{ label: "Review payment", href: `/invoices/${invoice.id}` }],
        metadata: { collectedCents: collected, amountPaidCents: invoice.amountPaidCents, balanceCents: invoice.balanceCents },
      });
    }

    if (sent && invoice.balanceCents > 0 && invoice.dueDate && invoice.dueDate < input.asOf) {
      const overdueDays = daysAgo(input.asOf, invoice.dueDate);
      push({
        fingerprint: fingerprint("OVERDUE_INVOICE", `invoice:${invoice.id}`),
        type: "OVERDUE_INVOICE",
        severity: overdueDays < 3 ? "WATCH" : "ACTION_NEEDED",
        jobId: invoice.jobId,
        invoiceId: invoice.id,
        paymentId: null,
        customerId: invoice.customerId,
        technicianId: null,
        amountAtRiskCents: invoice.balanceCents,
        amountUnknown: false,
        title: name,
        subtitle: invoice.invoiceNumber,
        reason: `${invoice.invoiceNumber} is ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue.`,
        recommendedAction: "Follow up from the invoice. Watchdog will not contact the customer automatically.",
        actions: [
          { label: "Open invoice", href: `/invoices/${invoice.id}` },
          ...(customer?.phone ? [{ label: "Text", href: `/invoices/${invoice.id}` }, { label: "Call", href: `tel:${customer.phone}` }] : []),
          { label: "Send reminder", href: `/invoices/${invoice.id}` },
        ],
        metadata: { daysOverdue: overdueDays, dueDate: invoice.dueDate.toISOString() },
      });
    }

    if (input.qboConnected) {
      const paidLocally = invoice.status === "PAID" || (collected > 0 && invoice.balanceCents === 0);
      const invoiceMap = qboInvoices.get(invoice.id);
      const unsyncedPayment = siblings.find((payment) => SUCCESS_PAYMENTS.has(payment.status) && qboPayments.get(payment.id)?.status !== "SYNCED");
      const paidAt = siblings.find((payment) => SUCCESS_PAYMENTS.has(payment.status))?.paidAt ?? invoice.updatedAt ?? invoice.createdAt;
      if (paidLocally && (!invoiceMap || invoiceMap.status !== "SYNCED" || unsyncedPayment)) {
        if (hoursAgo(input.asOf, paidAt) < input.settings.accountingSyncGraceHours) continue;
        push({
          fingerprint: fingerprint("ACCOUNTING_OUT_OF_SYNC", `invoice:${invoice.id}`),
          type: "ACCOUNTING_OUT_OF_SYNC",
          severity: "ACTION_NEEDED",
          jobId: invoice.jobId,
          invoiceId: invoice.id,
          paymentId: unsyncedPayment?.id ?? null,
          customerId: invoice.customerId,
          technicianId: null,
          amountAtRiskCents: invoice.totalCents,
          amountUnknown: false,
          title: name,
          subtitle: invoice.invoiceNumber,
          reason: "ContractorYou shows this invoice paid, but QuickBooks still has an unresolved discrepancy after the sync grace period.",
          recommendedAction: "Review QuickBooks Sync Center. Do not invent a matching payment.",
          actions: [
            { label: "Review QuickBooks sync", href: "/settings/quickbooks/manage" },
            { label: "Open invoice", href: `/invoices/${invoice.id}` },
          ],
          metadata: { qboInvoiceStatus: invoiceMap?.status ?? "MISSING" },
        });
      }
    }
  }

  return findings;
}

export function summarizeFindings(findings: Array<{ type: string; amountAtRiskCents: number | null; amountUnknown: boolean; status?: string }>): {
  openCount: number;
  verifiedAtRiskCents: number;
  unknownAmountCount: number;
  byType: Record<string, number>;
  unbilledJobs: number;
  unsentInvoices: number;
  checkoutIssues: number;
  contactIssues: number;
  paymentIssues: number;
  quickbooksIssues: number;
  overdueInvoices: number;
  morningLine: string;
} {
  const open = findings.filter((row) => !row.status || row.status === "OPEN");
  const byType: Record<string, number> = {};
  let verifiedAtRiskCents = 0;
  let unknownAmountCount = 0;
  for (const row of open) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    if (row.amountUnknown || row.amountAtRiskCents == null) unknownAmountCount += 1;
    else verifiedAtRiskCents += row.amountAtRiskCents;
  }
  const count = (type: string) => byType[type] ?? 0;
  const parts = Object.entries(byType)
    .filter(([, value]) => value > 0)
    .map(([type, value]) => `${value} ${TYPE_LABELS[type as keyof typeof TYPE_LABELS] ?? type}`);
  const morningLine =
    open.length === 0
      ? "All clear. No billing issues detected."
      : `${open.length} item${open.length === 1 ? "" : "s"} need attention. ${formatRisk(verifiedAtRiskCents, unknownAmountCount)}`;
  return {
    openCount: open.length,
    verifiedAtRiskCents,
    unknownAmountCount,
    byType,
    unbilledJobs: count("COMPLETED_NO_INVOICE"),
    unsentInvoices: count("INVOICE_NOT_SENT"),
    checkoutIssues: count("TECH_CHECKOUT_INCOMPLETE") + count("READY_TO_INVOICE_CHECKOUT_INCOMPLETE"),
    contactIssues: count("CUSTOMER_MISSING_EMAIL") + count("INVOICE_DELIVERY_FAILED"),
    paymentIssues: count("PAYMENT_NOT_APPLIED"),
    quickbooksIssues: count("ACCOUNTING_OUT_OF_SYNC"),
    overdueInvoices: count("OVERDUE_INVOICE"),
    morningLine: parts.length ? `${morningLine} ${parts.join(". ")}.` : morningLine,
  };
}

function formatRisk(cents: number, unknown: number) {
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
  if (cents > 0 && unknown > 0) return `${money} verified revenue at risk. ${unknown} amount${unknown === 1 ? "" : "s"} unknown.`;
  if (cents > 0) return `${money} verified revenue at risk.`;
  if (unknown > 0) return `${unknown} amount${unknown === 1 ? "" : "s"} unknown.`;
  return "No verified dollars at risk.";
}
