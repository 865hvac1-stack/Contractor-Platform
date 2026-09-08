import { inspectHighLevelTokenClaims } from "@/lib/highlevel/token-claims";
import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";

export const HIGHLEVEL_LOCATION_MISMATCH_REASON =
  "HighLevel location on this company does not match the OAuth token location. Reconnect HighLevel for this company. No HighLevel API call was made.";

export type HighLevelLocationAgreement =
  | { ok: true; locationId: string }
  | { ok: false; reason: string; mappedLocationId: string | null; tokenLocationId: string | null };

/**
 * ContractorYou company mapping, stored token location, and JWT location claim
 * must agree before any location-level HighLevel API call.
 * Never silently reuse a token from another sub-account.
 */
export function agreeHighLevelLocation(input: {
  mappedLocationId?: string | null;
  storedTokenLocationId?: string | null;
  accessToken?: string | null;
}): HighLevelLocationAgreement {
  const mappedLocationId = sanitizeHighLevelLocationId(input.mappedLocationId);
  if (!mappedLocationId) {
    return {
      ok: false,
      reason: "HighLevel is not mapped to a location for this company.",
      mappedLocationId: null,
      tokenLocationId: sanitizeHighLevelLocationId(input.storedTokenLocationId),
    };
  }

  const claimLocationId = sanitizeHighLevelLocationId(inspectHighLevelTokenClaims(input.accessToken).locationId);
  const storedTokenLocationId = sanitizeHighLevelLocationId(input.storedTokenLocationId);
  const tokenLocationId = claimLocationId ?? storedTokenLocationId;

  if (tokenLocationId && tokenLocationId !== mappedLocationId) {
    return {
      ok: false,
      reason: HIGHLEVEL_LOCATION_MISMATCH_REASON,
      mappedLocationId,
      tokenLocationId,
    };
  }

  return { ok: true, locationId: mappedLocationId };
}
