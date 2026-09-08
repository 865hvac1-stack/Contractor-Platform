import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";

export type HighLevelConnectionCandidate = {
  providerKey: string;
  scopes: string[];
  status: string;
  updatedAt?: Date | string | null;
  externalAccountId?: string | null;
};

/**
 * One authoritative HighLevel connection for a company.
 * Marketplace OAuth wins over legacy PIT/testing rows. History is not deleted.
 */
export function pickCanonicalHighLevelConnection<T extends HighLevelConnectionCandidate>(
  rows: T[]
): T | null {
  const candidates = rows.filter((row) => row.providerKey === HIGHLEVEL_PROVIDER_KEY);
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => {
    const leftRank = canonicalConnectionRank(left);
    const rightRank = canonicalConnectionRank(right);
    if (leftRank.oauth !== rightRank.oauth) return leftRank.oauth ? -1 : 1;
    if (leftRank.usable !== rightRank.usable) return leftRank.usable ? -1 : 1;
    if (leftRank.statusScore !== rightRank.statusScore) return rightRank.statusScore - leftRank.statusScore;
    return rightRank.updated - leftRank.updated;
  })[0] ?? null;
}

function canonicalConnectionRank(row: HighLevelConnectionCandidate) {
  const oauth = !row.scopes.includes("private_token");
  const usable = row.status !== "DISABLED" && Boolean(sanitizeHighLevelLocationId(row.externalAccountId));
  const statusScore =
    row.status === "CONNECTED" || row.status === "SYNCING" ? 3 : row.status === "DISABLED" ? 0 : 1;
  const updated =
    row.updatedAt instanceof Date
      ? row.updatedAt.getTime()
      : row.updatedAt
        ? new Date(row.updatedAt).getTime()
        : 0;
  return { oauth, usable, statusScore, updated };
}

export function extractDiagnosticLocationId(summary: unknown): string | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const row = summary as Record<string, unknown>;
  return (
    sanitizeHighLevelLocationId(row.locationId) ??
    sanitizeHighLevelLocationId(row.requestedLocationId) ??
    sanitizeHighLevelLocationId(row.storedLocationId) ??
    sanitizeHighLevelLocationId(row.finalPersistedLocationId)
  );
}

export function diagnosticAppliesToCanonicalLocation(
  summary: unknown,
  canonicalLocationId: string | null | undefined
) {
  const canonical = sanitizeHighLevelLocationId(canonicalLocationId);
  const diagnosticLocationId = extractDiagnosticLocationId(summary);
  return Boolean(canonical && diagnosticLocationId && canonical === diagnosticLocationId);
}
