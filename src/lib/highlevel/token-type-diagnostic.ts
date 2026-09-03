import type { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { getHighLevelConnection } from "@/lib/highlevel/connection";
import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";
import { ensureHighLevelLocationAccess } from "@/lib/highlevel/location-token";
import { inspectHighLevelTokenClaims } from "@/lib/highlevel/token-claims";
import { getValidAccessToken, loadConnectionTokens } from "@/lib/integrations/store";

export type HighLevelTokenTypeDiagnostic = {
  tokenType: "company" | "location";
  requestedLocationId: string;
  installed: boolean | null;
  locationTokenExchangeHttpStatus: number | null;
  sanitizedError: string | null;
  storedUserType: string | null;
  jwtUserType: string | null;
  oauthLocationIdPresent: boolean;
  storedLocationId: string;
  companyIdPresent: boolean;
  approvedLocationsCount: number | null;
  isBulkInstallation: boolean | null;
  approveAllLocations: boolean | null;
  installToFutureLocations: boolean | null;
};

export function formatTokenTypeDiagnostic(result: HighLevelTokenTypeDiagnostic) {
  const present = (value: boolean | null) => (value == null ? "not persisted" : value ? "true" : "false");
  const count = (value: number | null) => (value == null ? "not persisted" : String(value));
  return [
    `tokenType: ${result.tokenType}`,
    `requested locationId: ${result.requestedLocationId}`,
    `installed: ${result.installed == null ? "unknown" : result.installed ? "true" : "false"}`,
    `location-token exchange HTTP status: ${result.locationTokenExchangeHttpStatus ?? "not attempted"}`,
    `sanitized error: ${result.sanitizedError || "none"}`,
    `stored userType: ${result.storedUserType || "not persisted"}`,
    `jwt userType: ${result.jwtUserType || "not present"}`,
    `oauth locationId present: ${present(result.oauthLocationIdPresent)}`,
    `stored locationId: ${result.storedLocationId}`,
    `companyId present: ${present(result.companyIdPresent)}`,
    `approvedLocations count: ${count(result.approvedLocationsCount)}`,
    `isBulkInstallation: ${present(result.isBulkInstallation)}`,
    `approveAllLocations: ${present(result.approveAllLocations)}`,
    `installToFutureLocations: ${present(result.installToFutureLocations)}`,
  ].join("\n");
}

export async function diagnoseHighLevelTokenType(
  prisma: PrismaClient,
  companyId: string
): Promise<HighLevelTokenTypeDiagnostic> {
  const connection = await getHighLevelConnection(prisma, companyId);
  const locationId = sanitizeHighLevelLocationId(connection?.externalAccountId);
  if (!connection || !locationId) {
    throw new Error("HighLevel is not connected.");
  }
  const stored = await loadConnectionTokens(companyId, connection.id);
  if (!stored) {
    throw new Error("HighLevel is not connected.");
  }
  const jwtUserType = inspectHighLevelTokenClaims(stored.accessToken).userType;
  const tokens =
    (await getValidAccessToken({
      companyId,
      connectionId: connection.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
    })) ?? stored;
  const result = await ensureHighLevelLocationAccess({
    prisma,
    companyId,
    connectionId: connection.id,
    locationId,
    tokens,
  });
  const diagnostic: HighLevelTokenTypeDiagnostic = {
    tokenType: result.tokenType,
    requestedLocationId: locationId,
    installed: result.installed,
    locationTokenExchangeHttpStatus: result.locationTokenExchangeHttpStatus,
    sanitizedError: result.sanitizedError,
    storedUserType: result.storedUserType,
    jwtUserType,
    oauthLocationIdPresent: result.oauthLocationIdPresent,
    storedLocationId: locationId,
    companyIdPresent: result.companyIdPresent,
    approvedLocationsCount: result.approvedLocationsCount,
    isBulkInstallation: result.isBulkInstallation,
    approveAllLocations: result.approveAllLocations,
    installToFutureLocations: result.installToFutureLocations,
  };
  console.info(
    JSON.stringify({
      event: "highlevel.token_type.diagnostic",
      tokenType: diagnostic.tokenType,
      requestedLocationId: diagnostic.requestedLocationId,
      installed: diagnostic.installed,
      locationTokenExchangeHttpStatus: diagnostic.locationTokenExchangeHttpStatus,
      sanitizedError: diagnostic.sanitizedError,
      storedUserType: diagnostic.storedUserType,
      jwtUserType: diagnostic.jwtUserType,
      oauthLocationIdPresent: diagnostic.oauthLocationIdPresent,
      companyIdPresent: diagnostic.companyIdPresent,
      approvedLocationsCount: diagnostic.approvedLocationsCount,
      isBulkInstallation: diagnostic.isBulkInstallation,
      approveAllLocations: diagnostic.approveAllLocations,
      installToFutureLocations: diagnostic.installToFutureLocations,
    })
  );
  return diagnostic;
}
