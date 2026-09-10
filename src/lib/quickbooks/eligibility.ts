import { isHistoricalImport } from "@/lib/imports/safety";

function collectedAmountCents(payment: { status: string; amountCents: number; refundedCents?: number | null }) {
  if (!isQboPaymentSuccessStatus(payment.status) && payment.status !== "REFUNDED") return 0;
  return Math.max(0, payment.amountCents - (payment.refundedCents ?? 0));
}

export const QBO_PAYMENT_SUCCESS_STATUSES = ["CONFIRMED", "SUCCEEDED", "RECORDED", "PARTIALLY_REFUNDED"] as const;

export type QboPaymentSuccessStatus = (typeof QBO_PAYMENT_SUCCESS_STATUSES)[number];

export type QboInvoiceEligibilityState =
  | "ELIGIBLE"
  | "MAPPED"
  | "HISTORICAL"
  | "OUT_OF_SCOPE"
  | "NOT_ELIGIBLE"
  | "NEEDS_REVIEW";

export type QboPaymentEligibilityState =
  | "PENDING"
  | "SYNCED"
  | "HISTORICAL"
  | "OUT_OF_SCOPE"
  | "NOT_ELIGIBLE"
  | "PARENT_NOT_SYNCED"
  | "NEEDS_REVIEW";

export type QboMappingSnapshot = {
  entityType: string;
  internalId: string;
  quickbooksId?: string | null;
  status?: string | null;
};

export type InvoiceEligibilityInput = {
  id: string;
  invoiceNumber?: string | null;
  status?: string | null;
  issueDate: Date;
  importMode?: string | null;
};

export type PaymentEligibilityInput = {
  id: string;
  invoiceId?: string | null;
  paidAt: Date;
  importMode?: string | null;
  status: string;
  amountCents: number;
  refundedCents?: number | null;
  provider?: string | null;
  providerPaymentId?: string | null;
};

export type InvoicePaymentSafety = {
  ok: boolean;
  code: "ok" | "overpayment" | "possible_duplicate";
  invoiceTotalCents: number;
  verifiedPaymentCents: number;
  candidateCents: number;
  alreadySyncedCents: number;
  messages: string[];
  possibleDuplicate: boolean;
};

export type InvoiceEligibility = {
  state: QboInvoiceEligibilityState;
  canSyncAsDependency: boolean;
  hasValidMapping: boolean;
  reason: string;
};

export type PaymentEligibility = {
  state: QboPaymentEligibilityState;
  pending: boolean;
  needsReview: boolean;
  canAutoSync: boolean;
  messages: string[];
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceHref: string | null;
  safety: InvoicePaymentSafety;
};

function isPersistedQboId(value?: string | null) {
  const id = (value || "").trim();
  return Boolean(id) && id !== "REVIEW";
}

export function isAfterSyncStart(date: Date, start: Date | null | undefined) {
  return !start || date >= start;
}

export function isQboPaymentSuccessStatus(status: string) {
  return (QBO_PAYMENT_SUCCESS_STATUSES as readonly string[]).includes(status);
}

export function mappingKey(entityType: string, internalId: string) {
  return `${entityType}:${internalId}`;
}

export function hasValidQuickBooksMapping(row?: QboMappingSnapshot | null) {
  return Boolean(row && row.status === "SYNCED" && isPersistedQboId(row.quickbooksId));
}

export function formatAccountingDollars(cents: number) {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) return `$${dollars}`;
  return `$${(cents / 100).toFixed(2)}`;
}

export function parentInvoiceNotSyncedMessage(invoiceNumber: string) {
  return `Payment belongs to ${invoiceNumber}, which has not been synced to QuickBooks.`;
}

export function overpaymentReviewMessage(input: {
  invoiceNumber: string;
  verifiedPaymentCents: number;
  invoiceTotalCents: number;
}) {
  return `${input.invoiceNumber} has ${formatAccountingDollars(input.verifiedPaymentCents)} in recorded payments against a ${formatAccountingDollars(input.invoiceTotalCents)} invoice. Review before accounting sync.`;
}

export function evaluateInvoiceEligibility(
  invoice: InvoiceEligibilityInput,
  input: {
    syncStartDate?: Date | null;
    mapping?: QboMappingSnapshot | null;
  }
): InvoiceEligibility {
  if (hasValidQuickBooksMapping(input.mapping)) {
    return {
      state: "MAPPED",
      canSyncAsDependency: false,
      hasValidMapping: true,
      reason: "Invoice already has a valid QuickBooks mapping.",
    };
  }
  if (invoice.status === "DRAFT" || invoice.status === "VOID") {
    return {
      state: "NOT_ELIGIBLE",
      canSyncAsDependency: false,
      hasValidMapping: false,
      reason: "Draft and void invoices are not eligible for QuickBooks sync.",
    };
  }
  if (isHistoricalImport(invoice.importMode)) {
    return {
      state: "HISTORICAL",
      canSyncAsDependency: false,
      hasValidMapping: false,
      reason: "Imported history stays in ContractorYou until you sync that record on purpose.",
    };
  }
  if (!isAfterSyncStart(invoice.issueDate, input.syncStartDate)) {
    return {
      state: "OUT_OF_SCOPE",
      canSyncAsDependency: false,
      hasValidMapping: false,
      reason: "This invoice is before the company sync start date.",
    };
  }
  if (input.mapping?.status === "NEEDS_REVIEW") {
    return {
      state: "NEEDS_REVIEW",
      canSyncAsDependency: true,
      hasValidMapping: false,
      reason: "Invoice mapping needs review before payment sync.",
    };
  }
  return {
    state: "ELIGIBLE",
    canSyncAsDependency: true,
    hasValidMapping: false,
    reason: "Invoice is in scope and can sync to QuickBooks first.",
  };
}

export function assessInvoicePaymentSafety(input: {
  invoiceNumber: string;
  invoiceTotalCents: number;
  payments: Array<{
    id: string;
    status: string;
    amountCents: number;
    refundedCents?: number | null;
    provider?: string | null;
    providerPaymentId?: string | null;
  }>;
  candidatePaymentId?: string | null;
  syncedPaymentIds?: Iterable<string>;
}): InvoicePaymentSafety {
  const verified = input.payments
    .map((payment) => ({
      ...payment,
      collectedCents: collectedAmountCents(payment),
    }))
    .filter((payment) => payment.collectedCents > 0);
  const verifiedPaymentCents = verified.reduce((sum, payment) => sum + payment.collectedCents, 0);
  const synced = new Set(input.syncedPaymentIds ?? []);
  const alreadySyncedCents = verified
    .filter((payment) => synced.has(payment.id))
    .reduce((sum, payment) => sum + payment.collectedCents, 0);
  const candidate = input.candidatePaymentId
    ? verified.find((payment) => payment.id === input.candidatePaymentId)
    : null;
  const candidateCents = candidate?.collectedCents ?? 0;

  const providers = new Set(verified.map((payment) => (payment.provider || "").toUpperCase()).filter(Boolean));
  const sameAmountPairs = verified.some((left, index) =>
    verified.slice(index + 1).some((right) => right.collectedCents === left.collectedCents)
  );
  const mixedManualAndStripe = providers.has("MANUAL") && providers.has("STRIPE");
  const possibleDuplicate =
    verified.length >= 2 &&
    sameAmountPairs &&
    (mixedManualAndStripe || verified.some((payment) => !payment.providerPaymentId)) &&
    (verifiedPaymentCents > input.invoiceTotalCents ||
      verified.some((payment) => payment.collectedCents === input.invoiceTotalCents));

  const messages: string[] = [];
  if (verifiedPaymentCents > input.invoiceTotalCents) {
    messages.push(
      overpaymentReviewMessage({
        invoiceNumber: input.invoiceNumber,
        verifiedPaymentCents,
        invoiceTotalCents: input.invoiceTotalCents,
      })
    );
  } else if (alreadySyncedCents + candidateCents > input.invoiceTotalCents && candidateCents > 0) {
    messages.push(
      overpaymentReviewMessage({
        invoiceNumber: input.invoiceNumber,
        verifiedPaymentCents: alreadySyncedCents + candidateCents,
        invoiceTotalCents: input.invoiceTotalCents,
      })
    );
  }
  if (possibleDuplicate && !messages.length) {
    messages.push(
      overpaymentReviewMessage({
        invoiceNumber: input.invoiceNumber,
        verifiedPaymentCents,
        invoiceTotalCents: input.invoiceTotalCents,
      })
    );
  } else if (possibleDuplicate && verifiedPaymentCents > input.invoiceTotalCents) {
    messages.push(
      `${input.invoiceNumber} has both a manual payment and a Stripe payment for ${formatAccountingDollars(input.invoiceTotalCents)}. Review whether those are the same transaction before accounting sync.`
    );
  }

  if (messages.length) {
    return {
      ok: false,
      code: possibleDuplicate ? "possible_duplicate" : "overpayment",
      invoiceTotalCents: input.invoiceTotalCents,
      verifiedPaymentCents,
      candidateCents,
      alreadySyncedCents,
      messages,
      possibleDuplicate,
    };
  }

  return {
    ok: true,
    code: "ok",
    invoiceTotalCents: input.invoiceTotalCents,
    verifiedPaymentCents,
    candidateCents,
    alreadySyncedCents,
    messages: [],
    possibleDuplicate: false,
  };
}

export function evaluatePaymentEligibility(input: {
  payment: PaymentEligibilityInput;
  invoice?: (InvoiceEligibilityInput & { totalCents: number }) | null;
  siblingPayments?: PaymentEligibilityInput[];
  paymentMapping?: QboMappingSnapshot | null;
  invoiceMapping?: QboMappingSnapshot | null;
  syncedPaymentIds?: Iterable<string>;
  syncStartDate?: Date | null;
}): PaymentEligibility {
  const invoiceNumber = input.invoice?.invoiceNumber || "this invoice";
  const invoiceId = input.invoice?.id || input.payment.invoiceId || null;
  const invoiceHref = invoiceId ? `/invoices/${invoiceId}` : null;
  const siblings = input.siblingPayments ?? [input.payment];
  const safety = input.invoice
    ? assessInvoicePaymentSafety({
        invoiceNumber,
        invoiceTotalCents: input.invoice.totalCents,
        payments: siblings,
        candidatePaymentId: input.payment.id,
        syncedPaymentIds: input.syncedPaymentIds,
      })
    : {
        ok: false,
        code: "overpayment" as const,
        invoiceTotalCents: 0,
        verifiedPaymentCents: 0,
        candidateCents: collectedAmountCents(input.payment),
        alreadySyncedCents: 0,
        messages: ["Payment is not linked to a ContractorYou invoice."],
        possibleDuplicate: false,
      };

  const base = {
    invoiceId,
    invoiceNumber: input.invoice?.invoiceNumber ?? null,
    invoiceHref,
    safety,
  };

  if (hasValidQuickBooksMapping(input.paymentMapping)) {
    return {
      state: "SYNCED",
      pending: false,
      needsReview: false,
      canAutoSync: false,
      messages: [],
      ...base,
    };
  }
  if (!isQboPaymentSuccessStatus(input.payment.status)) {
    return {
      state: "NOT_ELIGIBLE",
      pending: false,
      needsReview: false,
      canAutoSync: false,
      messages: ["Only recorded or successful payments sync to QuickBooks."],
      ...base,
    };
  }
  if (isHistoricalImport(input.payment.importMode)) {
    return {
      state: "HISTORICAL",
      pending: false,
      needsReview: false,
      canAutoSync: false,
      messages: ["Imported history stays in ContractorYou until you sync that record on purpose."],
      ...base,
    };
  }
  if (!isAfterSyncStart(input.payment.paidAt, input.syncStartDate)) {
    return {
      state: "OUT_OF_SCOPE",
      pending: false,
      needsReview: false,
      canAutoSync: false,
      messages: ["This payment is before the company sync start date."],
      ...base,
    };
  }
  if (!input.invoice || !invoiceId) {
    return {
      state: "NEEDS_REVIEW",
      pending: false,
      needsReview: true,
      canAutoSync: false,
      messages: safety.messages,
      ...base,
    };
  }

  const invoiceEligibility = evaluateInvoiceEligibility(input.invoice, {
    syncStartDate: input.syncStartDate,
    mapping: input.invoiceMapping,
  });

  if (!safety.ok) {
    const messages = [...safety.messages];
    if (!invoiceEligibility.hasValidMapping) {
      messages.unshift(parentInvoiceNotSyncedMessage(invoiceNumber));
    }
    return {
      state: "NEEDS_REVIEW",
      pending: false,
      needsReview: true,
      canAutoSync: false,
      messages,
      ...base,
    };
  }

  if (invoiceEligibility.hasValidMapping) {
    return {
      state: "PENDING",
      pending: true,
      needsReview: false,
      canAutoSync: true,
      messages: [],
      ...base,
    };
  }

  if (invoiceEligibility.canSyncAsDependency) {
    return {
      state: "PENDING",
      pending: true,
      needsReview: false,
      canAutoSync: true,
      messages: ["Parent invoice will sync to QuickBooks first, then this payment."],
      ...base,
    };
  }

  return {
    state: invoiceEligibility.state === "HISTORICAL" ? "HISTORICAL" : "PARENT_NOT_SYNCED",
    pending: false,
    needsReview: invoiceEligibility.state !== "HISTORICAL",
    canAutoSync: false,
    messages: [parentInvoiceNotSyncedMessage(invoiceNumber)],
    ...base,
  };
}

export function paymentReviewLabel(state: QboPaymentEligibilityState) {
  if (state === "PARENT_NOT_SYNCED") return "PARENT INVOICE NOT SYNCED";
  if (state === "HISTORICAL") return "HISTORICAL";
  if (state === "OUT_OF_SCOPE" || state === "NOT_ELIGIBLE") return "NOT ELIGIBLE";
  if (state === "NEEDS_REVIEW") return "NEEDS REVIEW";
  return state.replaceAll("_", " ");
}

export type PaymentReviewItem = {
  id: string;
  entityType: "PAYMENT";
  internalId: string;
  status: "NEEDS_REVIEW";
  state: QboPaymentEligibilityState;
  error: string;
  href: string | null;
  hrefLabel: string | null;
};

export function reviewItemFromPaymentEligibility(
  paymentId: string,
  eligibility: PaymentEligibility
): PaymentReviewItem | null {
  if (!eligibility.needsReview) return null;
  return {
    id: `payment-elig:${paymentId}`,
    entityType: "PAYMENT",
    internalId: paymentId,
    status: "NEEDS_REVIEW",
    state: eligibility.state,
    error: eligibility.messages.join(" "),
    href: eligibility.invoiceHref,
    hrefLabel: eligibility.invoiceNumber ? `Open ${eligibility.invoiceNumber}` : "Open invoice",
  };
}

export function describeInvoicePaidSource(input: {
  amountPaidCents: number;
  payments: Array<{ id: string; status: string; amountCents: number; refundedCents?: number | null }>;
}) {
  const verifiedPaymentCents = input.payments.reduce((sum, payment) => sum + collectedAmountCents(payment), 0);
  if (input.payments.length === 0 && input.amountPaidCents > 0) {
    return {
      source: "INVOICE_STATUS_WITHOUT_PAYMENT_RECORD" as const,
      verifiedPaymentCents,
      note: "Invoice shows paid from amountPaidCents / status. There is no ContractorYou Payment row to send to QuickBooks.",
    };
  }
  if (input.payments.length === 0) {
    return {
      source: "NONE" as const,
      verifiedPaymentCents,
      note: "Invoice has no Payment records.",
    };
  }
  return {
    source: "PAYMENT_RECORDS" as const,
    verifiedPaymentCents,
    note: "Paid amount is backed by ContractorYou Payment rows.",
  };
}
