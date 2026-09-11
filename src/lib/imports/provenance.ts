export const HOUSECALL_PRO_SOURCE = "HOUSECALL_PRO";
export const HCP_RESET_CONFIRMATION = "DELETE HOUSECALL PRO IMPORT";
export const QUICKBOOKS_SOURCE = "QUICKBOOKS";
export const HIGHLEVEL_SOURCE = "HIGHLEVEL";
export const STRIPE_SOURCE = "STRIPE";
export const CONTRACTORYOU_SOURCE = "CONTRACTORYOU";

export const PROVENANCE_BUCKETS = [
  "NATIVE_LIVE",
  "HOUSECALL_PRO",
  "OTHER_IMPORT",
  "QUICKBOOKS",
  "HIGHLEVEL",
  "STRIPE",
  "UNKNOWN",
] as const;

export type ProvenanceBucket = (typeof PROVENANCE_BUCKETS)[number];

const HCP_TOKENS = new Set(["HOUSECALL_PRO", "HOUSECALLPRO", "HCP"]);
const QBO_TOKENS = new Set(["QUICKBOOKS", "QUICKBOOKS_ONLINE", "QBO"]);
const HL_TOKENS = new Set(["HIGHLEVEL", "GOHIGHLEVEL", "LEADCONNECTOR"]);
const STRIPE_TOKENS = new Set(["STRIPE"]);
const OTHER_IMPORT_TOKENS = new Set([
  "SERVICETITAN",
  "JOBBER",
  "FIELDEDGE",
  "SERVICE_FUSION",
  "WORKIZ",
  "HUBSPOT",
  "SALESFORCE",
  "SPREADSHEET",
  "OTHER",
]);

export function normalizeSourceToken(value?: string | null): string {
  return (value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function isHousecallProSource(value?: string | null): boolean {
  const token = normalizeSourceToken(value);
  return HCP_TOKENS.has(token);
}

export function isQuickBooksSource(value?: string | null): boolean {
  const token = normalizeSourceToken(value);
  return QBO_TOKENS.has(token);
}

export function isHighLevelSource(value?: string | null): boolean {
  const token = normalizeSourceToken(value);
  return HL_TOKENS.has(token);
}

export function isStripeSource(value?: string | null): boolean {
  const token = normalizeSourceToken(value);
  return STRIPE_TOKENS.has(token);
}

export type ProvenanceSignals = {
  sourceSystem?: string | null;
  importMode?: string | null;
  importSessionId?: string | null;
  importSessionSource?: string | null;
  externalId?: string | null;
  provider?: string | null;
  hasHousecallProRef?: boolean;
  hasQuickBooksMapping?: boolean;
  hasHighLevelIdentity?: boolean;
};

/**
 * Authoritative provenance only. Age, name, status, and “looks historical”
 * are never enough to classify a record as imported.
 */
export function classifyProvenance(input: ProvenanceSignals): ProvenanceBucket {
  if (isStripeSource(input.provider) || isStripeSource(input.sourceSystem)) return "STRIPE";
  if (isHousecallProSource(input.sourceSystem) || isHousecallProSource(input.importSessionSource) || input.hasHousecallProRef) {
    return "HOUSECALL_PRO";
  }
  if (isQuickBooksSource(input.sourceSystem) || input.hasQuickBooksMapping) return "QUICKBOOKS";
  if (isHighLevelSource(input.sourceSystem) || isHighLevelSource(input.provider) || input.hasHighLevelIdentity) {
    return "HIGHLEVEL";
  }
  if (isHousecallProSource(input.importSessionSource)) return "HOUSECALL_PRO";
  const sessionOrSource = normalizeSourceToken(input.sourceSystem || input.importSessionSource);
  if (OTHER_IMPORT_TOKENS.has(sessionOrSource)) return "OTHER_IMPORT";
  if (input.importMode === "HISTORICAL" || input.importMode === "REFERENCE") return "UNKNOWN";
  if (input.importSessionId && !input.sourceSystem && !input.importSessionSource) return "UNKNOWN";
  return "NATIVE_LIVE";
}

export function isAuthoritativeHousecallPro(input: ProvenanceSignals): boolean {
  return classifyProvenance(input) === "HOUSECALL_PRO";
}

export function isUnsafeToDelete(bucket: ProvenanceBucket): boolean {
  return bucket === "NATIVE_LIVE" || bucket === "UNKNOWN" || bucket === "STRIPE" || bucket === "QUICKBOOKS" || bucket === "HIGHLEVEL";
}

export const PROVENANCE_LABELS: Record<ProvenanceBucket, string> = {
  NATIVE_LIVE: "ContractorYou live",
  HOUSECALL_PRO: "Housecall Pro import",
  OTHER_IMPORT: "Other import",
  QUICKBOOKS: "QuickBooks",
  HIGHLEVEL: "HighLevel",
  STRIPE: "Stripe",
  UNKNOWN: "Unknown / unsafe to delete",
};
