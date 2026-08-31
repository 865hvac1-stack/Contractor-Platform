import type { PreviewSummary, RowAccounting } from "@/lib/imports/types";

export type QualityScore = {
  rowsAccountedPct: number;
  readyPct: number;
  customerMatchPct: number | null;
  propertyMatchPct: number | null;
  notes: string[];
};

function pct(part: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((part / total) * 100);
}

export function accountedTotal(accounting: RowAccounting): number {
  return (
    accounting.created +
    accounting.updated +
    accounting.merged +
    accounting.duplicates +
    accounting.skipped +
    accounting.warningImported +
    accounting.errors +
    accounting.other
  );
}

export function finalizeAccounting(accounting: RowAccounting, sourceRows: number): RowAccounting {
  const next: RowAccounting = { ...accounting, sourceRows };
  const sum = accountedTotal(next);
  if (sum < sourceRows) next.other += sourceRows - sum;
  if (sum > sourceRows && next.other > 0) {
    next.other = Math.max(0, next.other - (sum - sourceRows));
  }
  return next;
}

export function computeQualityScore(input: {
  totalRows: number;
  preview?: PreviewSummary | null;
  accounting?: RowAccounting | null;
}): QualityScore {
  const notes: string[] = [];
  const accounting = input.accounting ?? input.preview?.accounting ?? null;
  const rowsAccountedPct = accounting ? pct(accountedTotal(accounting), input.totalRows) : 100;
  const readyPct = pct(input.preview?.ready ?? accounting?.created ?? 0, input.totalRows);
  const unmatchedCustomers = input.preview?.unmatchedCustomers ?? 0;
  const unmatchedProperties = input.preview?.unmatchedProperties ?? 0;
  const customerMatchPct =
    input.preview?.unmatchedCustomers == null ? null : pct(input.totalRows - unmatchedCustomers, input.totalRows);
  const propertyMatchPct =
    input.preview?.unmatchedProperties == null ? null : pct(input.totalRows - unmatchedProperties, input.totalRows);

  if (rowsAccountedPct < 100) {
    notes.push("Some source rows still need an explained outcome.");
  }
  if (customerMatchPct != null && customerMatchPct < 95) {
    notes.push(`${unmatchedCustomers} rows still need a customer match.`);
  }
  if (propertyMatchPct != null && propertyMatchPct < 95 && unmatchedProperties > 0) {
    notes.push(`${unmatchedProperties} rows still need a service location.`);
  }
  if ((input.preview?.unknownTechnicians ?? 0) > 0) {
    notes.push(`${input.preview?.unknownTechnicians} employee names did not match a team member. We kept the name on the record and did not create a login.`);
  }
  if ((input.preview?.errors ?? 0) > 0) {
    notes.push(`${input.preview?.errors} rows have errors and will not import until you skip or fix them.`);
  }
  if (notes.length === 0) {
    notes.push("These numbers come from the file and matches — not from a guess.");
  }

  return { rowsAccountedPct, readyPct, customerMatchPct, propertyMatchPct, notes };
}
