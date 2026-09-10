export const CONTRACTORYOU_OWNS = [
  "customer_operational_profile",
  "property",
  "job",
  "service_type",
  "dispatch",
  "technician",
  "job_notes",
  "equipment",
  "photos",
  "scheduling",
  "estimate_workflow",
  "invoice_workflow",
  "customer_communications",
  "waiting_status",
  "membership_operations",
] as const;

export const QUICKBOOKS_OWNS = [
  "accounting_account",
  "posted_transaction_state",
  "accounting_balances",
  "profit_and_loss",
  "accounting_tax_treatment",
  "finalized_expense_category",
  "ledger_state",
] as const;

export type SharedAccountingEntity = "CUSTOMER" | "INVOICE" | "PAYMENT" | "EXPENSE";

export function fieldOwner(entity: SharedAccountingEntity, field: string): "contractoryou" | "quickbooks" | "mapped" {
  if (entity === "CUSTOMER") {
    if (["firstName", "lastName", "phone", "email", "notes", "tags", "status"].includes(field)) return "contractoryou";
    if (["balance", "accountingDisplayName"].includes(field)) return "quickbooks";
    return "mapped";
  }
  if (entity === "INVOICE") {
    if (["invoiceNumber", "lineItems", "notes", "status", "jobId"].includes(field)) return "contractoryou";
    if (["qboBalance", "qboPaidStatus"].includes(field)) return "quickbooks";
    return "mapped";
  }
  if (entity === "PAYMENT") {
    if (["amountCents", "paidAt", "method", "externalRef"].includes(field)) return "contractoryou";
    return "mapped";
  }
  if (["category", "vendor", "amountCents", "date", "jobId"].includes(field)) return "contractoryou";
  return "quickbooks";
}

export function shouldOverwriteOperationalField() {
  return false;
}
