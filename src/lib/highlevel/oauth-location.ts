import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";

export type FreshOauthLocationSource =
  | "token_response"
  | "jwt_claim"
  | "callback_query"
  | "approved_locations_single"
  | "none";

export type FreshOauthLocationResolution = {
  tokenUserType: string | null;
  tokenResponseLocationId: string | null;
  jwtLocationId: string | null;
  callbackQueryLocationId: string | null;
  agencyCompanyId: string | null;
  isBulkInstallation: boolean | null;
  approvedLocationsCount: number | null;
  approveAllLocations: boolean | null;
  installToFutureLocations: boolean | null;
  previousMappedLocationId: string | null;
  freshOauthLocationId: string | null;
  finalPersistedLocationId: string | null;
  locationSource: FreshOauthLocationSource;
  staleMappingReused: boolean;
  locationIdsDisagree: boolean;
};

function asFlag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asUserType(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Provider-authoritative location for a fresh Marketplace OAuth exchange.
 * Never falls back to a previously stored ContractorYou mapping.
 */
export function resolveFreshHighLevelOauthLocation(input: {
  tokenUserType?: string | null;
  tokenResponseLocationId?: string | null;
  jwtLocationId?: string | null;
  callbackQueryLocationId?: string | null;
  agencyCompanyId?: string | null;
  approvedLocations?: string[] | null;
  isBulkInstallation?: boolean | null;
  approveAllLocations?: boolean | null;
  installToFutureLocations?: boolean | null;
  previousMappedLocationId?: string | null;
}): FreshOauthLocationResolution {
  const tokenResponseLocationId = sanitizeHighLevelLocationId(input.tokenResponseLocationId);
  const jwtLocationId = sanitizeHighLevelLocationId(input.jwtLocationId);
  const callbackQueryLocationId = sanitizeHighLevelLocationId(input.callbackQueryLocationId);
  const previousMappedLocationId = sanitizeHighLevelLocationId(input.previousMappedLocationId);
  const approved = (input.approvedLocations ?? [])
    .map((id) => sanitizeHighLevelLocationId(id))
    .filter((id): id is string => Boolean(id));
  const uniqueApproved = [...new Set(approved)];
  const singleApproved = uniqueApproved.length === 1 ? uniqueApproved[0] : null;

  let freshOauthLocationId: string | null = null;
  let locationSource: FreshOauthLocationSource = "none";
  if (tokenResponseLocationId) {
    freshOauthLocationId = tokenResponseLocationId;
    locationSource = "token_response";
  } else if (jwtLocationId) {
    freshOauthLocationId = jwtLocationId;
    locationSource = "jwt_claim";
  } else if (callbackQueryLocationId) {
    freshOauthLocationId = callbackQueryLocationId;
    locationSource = "callback_query";
  } else if (singleApproved) {
    freshOauthLocationId = singleApproved;
    locationSource = "approved_locations_single";
  }

  const issued = [tokenResponseLocationId, jwtLocationId, callbackQueryLocationId].filter(
    (id): id is string => Boolean(id)
  );
  const locationIdsDisagree = new Set(issued).size > 1;

  return {
    tokenUserType: asUserType(input.tokenUserType),
    tokenResponseLocationId,
    jwtLocationId,
    callbackQueryLocationId,
    agencyCompanyId: sanitizeHighLevelLocationId(input.agencyCompanyId),
    isBulkInstallation: asFlag(input.isBulkInstallation),
    approvedLocationsCount: Array.isArray(input.approvedLocations) ? uniqueApproved.length : null,
    approveAllLocations: asFlag(input.approveAllLocations),
    installToFutureLocations: asFlag(input.installToFutureLocations),
    previousMappedLocationId,
    freshOauthLocationId,
    finalPersistedLocationId: freshOauthLocationId,
    locationSource,
    staleMappingReused: false,
    locationIdsDisagree,
  };
}

export function formatOauthInstallDiagnostic(summary: Partial<FreshOauthLocationResolution> & {
  authorizeUrlHasLocationId?: boolean | null;
}) {
  return [
    "HighLevel OAuth install · metadata only",
    `tokenUserType=${summary.tokenUserType ?? "none"}`,
    `tokenResponseLocationId=${summary.tokenResponseLocationId ?? "none"}`,
    `jwtLocationId=${summary.jwtLocationId ?? "none"}`,
    `agencyCompanyId=${summary.agencyCompanyId ?? "none"}`,
    `approvedLocationsCount=${summary.approvedLocationsCount ?? "none"}`,
    `isBulkInstallation=${summary.isBulkInstallation ?? "none"}`,
    `approveAllLocations=${summary.approveAllLocations ?? "none"}`,
    `installToFutureLocations=${summary.installToFutureLocations ?? "none"}`,
    `previousMappedLocationId=${summary.previousMappedLocationId ?? "none"}`,
    `freshOauthLocationId=${summary.freshOauthLocationId ?? "none"}`,
    `finalPersistedLocationId=${summary.finalPersistedLocationId ?? "none"}`,
    `locationSource=${summary.locationSource ?? "none"}`,
    `staleMappingReused=${summary.staleMappingReused ? "yes" : "no"}`,
    `authorizeUrlHasLocationId=${summary.authorizeUrlHasLocationId ? "yes" : "no"}`,
    `locationIdsDisagree=${summary.locationIdsDisagree ? "yes" : "no"}`,
  ].join("\n");
}
