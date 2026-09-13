/** QuickBooks write-back stays disabled until inbound import reconciles. */

export const QUICKBOOKS_WRITEBACK_ENABLED = false;

export const QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE =
  "ContractorYou → QuickBooks write-back is not enabled. QuickBooks remains the accounting ledger until inbound history reconciles.";

export function assertQuickBooksWritebackDisabled(operation: string) {
  if (!QUICKBOOKS_WRITEBACK_ENABLED) {
    throw new Error(`${QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE} Blocked: ${operation}.`);
  }
}

export function isQuickBooksWriteMethod(method?: string | null) {
  const value = (method || "").toUpperCase();
  return value === "POST" || value === "POST_JSON" || value === "PUT" || value === "PATCH" || value === "DELETE";
}
