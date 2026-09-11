export const BILLING_WATCHDOG_TYPES = [
  "TECH_CHECKOUT_INCOMPLETE",
  "COMPLETED_NO_INVOICE",
  "INVOICE_NOT_SENT",
  "CUSTOMER_MISSING_EMAIL",
  "INVOICE_DELIVERY_FAILED",
  "PAYMENT_NOT_APPLIED",
  "ACCOUNTING_OUT_OF_SYNC",
  "OVERDUE_INVOICE",
  "READY_TO_INVOICE_CHECKOUT_INCOMPLETE",
  "PROJECT_PHASE_UNBILLED",
  "MILESTONE_UNBILLED",
  "CHANGE_ORDER_UNBILLED",
  "RETAINAGE_DUE",
  "FINAL_INVOICE_MISSING",
] as const;

export type BillingWatchdogType = (typeof BILLING_WATCHDOG_TYPES)[number];

export const BILLING_WATCHDOG_EXCLUSION_CODES = [
  "WARRANTY_NO_CHARGE",
  "INTERNAL_WORK",
  "CALLBACK",
  "INCLUDED_IN_MEMBERSHIP",
  "BUILDER_BILLING",
  "BUNDLED_INVOICE",
  "NO_INVOICE_REQUIRED",
  "DUPLICATE_FINDING",
  "OTHER",
] as const;

export type BillingWatchdogExclusionCode = (typeof BILLING_WATCHDOG_EXCLUSION_CODES)[number];

export type BillingWatchdogSeverity = "CRITICAL" | "ACTION_NEEDED" | "WATCH";
export type BillingWatchdogFindingStatus = "OPEN" | "RESOLVED" | "EXCLUDED";
export type JobBillingReadinessState = "READY" | "BLOCKED" | "NOT_REQUIRED" | "ALREADY_BILLED" | "NEEDS_REVIEW";

export type BillingWatchdogSettingsView = {
  startDate: Date;
  checkoutGraceMinutes: number;
  completedInvoiceGraceHours: number;
  invoiceSendGraceHours: number;
  accountingSyncGraceHours: number;
  morningSummaryEnabled: boolean;
  morningSummaryRoles: string[];
};

export type BillingWatchdogAction = {
  label: string;
  href: string;
};

export type DetectedFinding = {
  fingerprint: string;
  type: BillingWatchdogType;
  severity: BillingWatchdogSeverity;
  jobId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  customerId: string | null;
  technicianId: string | null;
  amountAtRiskCents: number | null;
  amountUnknown: boolean;
  reason: string;
  recommendedAction: string;
  title: string;
  subtitle: string;
  actions: BillingWatchdogAction[];
  metadata: Record<string, unknown>;
};

export type BillingWatchdogFindingView = DetectedFinding & {
  id: string;
  companyId: string;
  status: BillingWatchdogFindingStatus;
  detectedAt: Date;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  resolvedAt: Date | null;
  exclusionCode: string | null;
  exclusionReason: string | null;
};

export type BillingWatchdogSummary = {
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
};

export type JobBillingReadiness = {
  state: JobBillingReadinessState;
  label: string;
  reason: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountCents: number | null;
  amountUnknown: boolean;
  actions: BillingWatchdogAction[];
};
