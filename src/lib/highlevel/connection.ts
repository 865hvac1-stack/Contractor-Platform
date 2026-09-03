import type { PrismaClient } from "@prisma/client";
import {
  HIGHLEVEL_LOCATION_GET_ENDPOINT,
  HIGHLEVEL_PROVIDER_KEY,
  type HighLevelAuthMode,
} from "@/lib/highlevel/config";
import { getCompanyConnection, getValidAccessToken } from "@/lib/integrations/store";
import {
  inspectHighLevelContactsReachability,
  inspectHighLevelInstalledLocations,
  inspectHighLevelLocation,
  type HighLevelLocation,
} from "@/lib/highlevel/client";
import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";
import { HIGHLEVEL_OAUTH_MARKERS, logHighLevelOAuthDiagnostic } from "@/lib/highlevel/oauth-diagnostics";

export async function getHighLevelConnection(prisma: PrismaClient, companyId: string) {
  return getCompanyConnection(companyId, HIGHLEVEL_PROVIDER_KEY);
}

export async function isHighLevelConnected(prisma: PrismaClient, companyId: string) {
  const connection = await getHighLevelConnection(prisma, companyId);
  return connection?.status === "CONNECTED" && Boolean(sanitizeHighLevelLocationId(connection.externalAccountId));
}

export function highlevelAuthMode(scopes: string[]): HighLevelAuthMode {
  return scopes.includes("private_token") ? "private_token" : "oauth";
}

export function highlevelTokenType(userType?: string | null): "location" | "company" | "unknown" {
  const normalized = userType?.trim().toLowerCase();
  if (normalized === "location") return "location";
  if (normalized === "company" || normalized === "agency") return "company";
  return "unknown";
}

export async function loadHighLevelAccess(prisma: PrismaClient, companyId: string) {
  const connection = await getHighLevelConnection(prisma, companyId);
  if (!connection || connection.status !== "CONNECTED") return null;
  const tokens = await getValidAccessToken({
    companyId,
    connectionId: connection.id,
    providerKey: HIGHLEVEL_PROVIDER_KEY,
  });
  const locationId = sanitizeHighLevelLocationId(connection.externalAccountId);
  if (!tokens?.accessToken || !locationId) return null;
  return {
    connection,
    accessToken: tokens.accessToken,
    locationId,
    authMode: highlevelAuthMode(connection.scopes),
  };
}

export async function probeHighLevelLocation(
  accessToken: string,
  locationId: string,
  context?: { tokenLocationId?: string | null; userType?: string | null }
) {
  const sanitized = sanitizeHighLevelLocationId(locationId);
  const tokenType = highlevelTokenType(context?.userType);
  const tokenLocationId = sanitizeHighLevelLocationId(context?.tokenLocationId);
  if (!sanitized) {
    return { ok: false as const, error: "HighLevel Location ID is missing or invalid. Email addresses cannot be used." };
  }

  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_START,
    route: "/api/integrations/oauth/callback",
    locationId: sanitized,
    endpoint: HIGHLEVEL_LOCATION_GET_ENDPOINT,
    tokenType,
    verified: false,
  });

  const locationGet = await inspectHighLevelLocation(accessToken, sanitized);
  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_RESPONSE,
    route: "/api/integrations/oauth/callback",
    locationId: sanitized,
    endpoint: HIGHLEVEL_LOCATION_GET_ENDPOINT,
    httpStatus: locationGet.status,
    tokenType,
    responseKeys: locationGet.keys,
    errorClass: locationGet.ok ? null : "HighLevelApiError",
    errorMessage: locationGet.errorMessage,
    verified: Boolean(locationGet.ok && locationGet.location?.id),
    reason: locationGet.ok ? "locations_get" : "locations_get_failed",
  });

  if (locationGet.ok && locationGet.location?.id) {
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_SUCCESS,
      route: "/api/integrations/oauth/callback",
      locationId: sanitized,
      endpoint: HIGHLEVEL_LOCATION_GET_ENDPOINT,
      httpStatus: locationGet.status,
      tokenType,
      responseKeys: locationGet.keys,
      verified: true,
      reason: "locations_get",
    });
    return { ok: true as const, location: locationGet.location, locationId: sanitized };
  }

  const contacts = await inspectHighLevelContactsReachability(accessToken, sanitized);
  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_RESPONSE,
    route: "/api/integrations/oauth/callback",
    locationId: sanitized,
    endpoint: "GET /contacts/",
    httpStatus: contacts.status,
    tokenType,
    responseKeys: contacts.keys,
    errorClass: contacts.ok ? null : "HighLevelApiError",
    errorMessage: contacts.errorMessage,
    verified: contacts.ok,
    reason: contacts.ok ? "contacts_reachable" : "contacts_unreachable",
  });
  if (contacts.ok) {
    const location: HighLevelLocation = {
      id: sanitized,
      name: locationGet.location?.name,
    };
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_SUCCESS,
      route: "/api/integrations/oauth/callback",
      locationId: sanitized,
      endpoint: "GET /contacts/",
      httpStatus: contacts.status,
      tokenType,
      verified: true,
      reason: "contacts_reachable",
    });
    return { ok: true as const, location, locationId: sanitized };
  }

  const installed = await inspectHighLevelInstalledLocations(accessToken);
  const installedIds = (installed.data.locations ?? [])
    .map((row) => sanitizeHighLevelLocationId(row.id || row._id))
    .filter((id): id is string => Boolean(id));
  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_RESPONSE,
    route: "/api/integrations/oauth/callback",
    locationId: sanitized,
    endpoint: "GET /oauth/installedLocations",
    httpStatus: installed.status,
    tokenType,
    responseKeys: installed.keys,
    errorClass: installed.ok ? null : "HighLevelApiError",
    errorMessage: installed.errorMessage,
    verified: installed.ok && installedIds.includes(sanitized),
    reason: "installed_locations",
  });
  if (installed.ok && installedIds.includes(sanitized)) {
    const location: HighLevelLocation = { id: sanitized, name: locationGet.location?.name };
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_SUCCESS,
      route: "/api/integrations/oauth/callback",
      locationId: sanitized,
      endpoint: "GET /oauth/installedLocations",
      httpStatus: installed.status,
      tokenType,
      verified: true,
      reason: "installed_locations",
    });
    return { ok: true as const, location, locationId: sanitized };
  }

  if (tokenLocationId && tokenLocationId === sanitized) {
    const location: HighLevelLocation = { id: sanitized, name: locationGet.location?.name };
    logHighLevelOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_SUCCESS,
      route: "/api/integrations/oauth/callback",
      locationId: sanitized,
      endpoint: HIGHLEVEL_LOCATION_GET_ENDPOINT,
      httpStatus: locationGet.status,
      tokenType,
      verified: true,
      reason: "oauth_token_location_bound",
    });
    return { ok: true as const, location, locationId: sanitized };
  }

  const error = locationGet.errorMessage || contacts.errorMessage || "HighLevel location probe failed.";
  logHighLevelOAuthDiagnostic({
    marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_FAILED,
    route: "/api/integrations/oauth/callback",
    locationId: sanitized,
    endpoint: HIGHLEVEL_LOCATION_GET_ENDPOINT,
    httpStatus: locationGet.status,
    tokenType,
    responseKeys: locationGet.keys,
    errorClass: "HighLevelLocationVerifyError",
    errorMessage: error,
    verified: false,
    reason: "location_verify_failed",
  });
  return { ok: false as const, error };
}
