import type { BillingWatchdogExclusionCode, BillingWatchdogType } from "@/lib/billing-watchdog/types";

export const TYPE_LABELS: Record<BillingWatchdogType, string> = {
  TECH_CHECKOUT_INCOMPLETE: "Technician didn't check out",
  COMPLETED_NO_INVOICE: "Completed — no invoice",
  INVOICE_NOT_SENT: "Invoice never sent",
  CUSTOMER_MISSING_EMAIL: "Missing customer email",
  INVOICE_DELIVERY_FAILED: "Invoice delivery failed",
  PAYMENT_NOT_APPLIED: "Payment collected — not applied",
  ACCOUNTING_OUT_OF_SYNC: "Paid locally — accounting out of sync",
  OVERDUE_INVOICE: "Overdue invoice",
  READY_TO_INVOICE_CHECKOUT_INCOMPLETE: "Checkout incomplete",
  PROJECT_PHASE_UNBILLED: "Project phase unbilled",
  MILESTONE_UNBILLED: "Milestone unbilled",
  CHANGE_ORDER_UNBILLED: "Change order unbilled",
  RETAINAGE_DUE: "Retainage due",
  FINAL_INVOICE_MISSING: "Final invoice missing",
};

export const EXCLUSION_LABELS: Record<BillingWatchdogExclusionCode, string> = {
  WARRANTY_NO_CHARGE: "Warranty / no charge",
  INTERNAL_WORK: "Internal work",
  CALLBACK: "Callback",
  INCLUDED_IN_MEMBERSHIP: "Included in membership",
  BUILDER_BILLING: "Builder billing",
  BUNDLED_INVOICE: "Bundled invoice",
  NO_INVOICE_REQUIRED: "No invoice required",
  DUPLICATE_FINDING: "Duplicate finding",
  OTHER: "Other",
};

export const FILTER_TYPES = [
  { key: "all", label: "All" },
  { key: "unbilled", label: "Unbilled", types: ["COMPLETED_NO_INVOICE"] },
  { key: "unsent", label: "Unsent", types: ["INVOICE_NOT_SENT"] },
  { key: "checkout", label: "Checkout", types: ["TECH_CHECKOUT_INCOMPLETE", "READY_TO_INVOICE_CHECKOUT_INCOMPLETE"] },
  { key: "contact", label: "Contact issue", types: ["CUSTOMER_MISSING_EMAIL", "INVOICE_DELIVERY_FAILED"] },
  { key: "payments", label: "Payments", types: ["PAYMENT_NOT_APPLIED"] },
  { key: "quickbooks", label: "QuickBooks", types: ["ACCOUNTING_OUT_OF_SYNC"] },
  { key: "overdue", label: "Overdue", types: ["OVERDUE_INVOICE"] },
  { key: "resolved", label: "Resolved" },
] as const;
