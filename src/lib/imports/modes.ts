export const IMPORT_MODE_LIVE = "LIVE";
export const IMPORT_MODE_HISTORICAL = "HISTORICAL";
export const IMPORT_MODE_REFERENCE = "REFERENCE";

export const IMPORT_MODES = [IMPORT_MODE_LIVE, IMPORT_MODE_HISTORICAL, IMPORT_MODE_REFERENCE] as const;
export type ImportModeId = (typeof IMPORT_MODES)[number];

export const NON_OPERATIONAL_IMPORT_MODES = [IMPORT_MODE_HISTORICAL, IMPORT_MODE_REFERENCE] as const;

export function isHistoricalImport(mode?: string | null): boolean {
  return mode === IMPORT_MODE_HISTORICAL;
}

export function isReferenceImport(mode?: string | null): boolean {
  return mode === IMPORT_MODE_REFERENCE;
}

export function isNonOperationalImport(mode?: string | null): boolean {
  return mode === IMPORT_MODE_HISTORICAL || mode === IMPORT_MODE_REFERENCE;
}

export function isLiveOperational(mode?: string | null): boolean {
  return !isNonOperationalImport(mode);
}

export function operationalImportModeWhere() {
  return { notIn: [...NON_OPERATIONAL_IMPORT_MODES] };
}

export function operationalRecordWhere() {
  return { importMode: operationalImportModeWhere() };
}

export const OWNERSHIP_COPY = {
  CONTRACTORYOU:
    "Primary source of truth for new operations: customers, jobs, dispatch, scheduling, estimates, invoices, payments, and Billing Watchdog.",
  QUICKBOOKS:
    "Accounting source. Historical invoices and payments stay financial history. They do not become live ContractorYou work.",
  HOUSECALL_PRO:
    "Historical service source only. Jobs, notes, and equipment stay reference history and do not enter Dispatch, Ready to Invoice, or Billing Watchdog.",
} as const;
