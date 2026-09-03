import type { PrismaClient } from "@prisma/client";
import { HighLevelApiError, inspectHighLevelInstalledLocationsForCompany } from "@/lib/highlevel/client";
import { highlevelMarketplaceVersionId } from "@/lib/highlevel/env";
import { getIdentityMap } from "@/lib/highlevel/identity";
import {
  exchangeCompanyTokenForLocation,
  exchangeHighLevelCode,
  refreshHighLevelConnectionTokens,
} from "@/lib/highlevel/oauth";
import { sanitizeHighLevelErrorMessage } from "@/lib/highlevel/sanitize-error";
import { inspectHighLevelTokenClaims } from "@/lib/highlevel/token-claims";
import { saveConnectionTokens } from "@/lib/integrations/store";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

export type HighLevelTokenKind = "company" | "location";

export type HighLevelLocationAccessResult = {
  accessToken: string;
  tokenType: HighLevelTokenKind;
  requestedLocationId: string;
  installed: boolean | null;
  locationTokenExchangeHttpStatus: number | null;
  sanitizedError: string | null;
  storedUserType: string | null;
  oauthLocationIdPresent: boolean;
  storedLocationId: string;
  companyIdPresent: boolean;
  approvedLocationsCount: number | null;
  isBulkInstallation: boolean | null;
  approveAllLocations: boolean | null;
  installToFutureLocations: boolean | null;
};

export type HighLevelLocationAccess = {
  tokenType?: HighLevelTokenKind | null;
  locationAccessError?: string | null;
  accessToken: string;
};

function storedUserType(tokens: ProviderTokenPayload): "Company" | "Location" | null {
  if (tokens.userType === "Company" || tokens.userType === "Location") return tokens.userType;
  return null;
}

export function inferHighLevelTokenKind(tokens: ProviderTokenPayload): HighLevelTokenKind | "unknown" {
  const accessClaims = inspectHighLevelTokenClaims(tokens.accessToken);
  if (accessClaims.userType === "Company") return "company";
  if (accessClaims.userType === "Location") return "location";
  if (tokens.userType === "Company") return "company";
  if (tokens.userType === "Location") return "location";
  return "unknown";
}

function metadataSnapshot(
  tokens: ProviderTokenPayload,
  locationId: string
): Omit<
  HighLevelLocationAccessResult,
  "accessToken" | "tokenType" | "installed" | "locationTokenExchangeHttpStatus" | "sanitizedError"
> {
  return {
    requestedLocationId: locationId,
    storedUserType: storedUserType(tokens),
    oauthLocationIdPresent: Boolean(tokens.locationId),
    storedLocationId: locationId,
    companyIdPresent: Boolean(tokens.highlevelCompanyId),
    approvedLocationsCount: Array.isArray(tokens.approvedLocations) ? tokens.approvedLocations.length : null,
    isBulkInstallation: tokens.isBulkInstallation ?? null,
    approveAllLocations: tokens.approveAllLocations ?? null,
    installToFutureLocations: tokens.installToFutureLocations ?? null,
  };
}

function collectInstalledIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const locations = Array.isArray(root.locations)
    ? root.locations
    : Array.isArray(root.installedLocations)
      ? root.installedLocations
      : [];
  return locations
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      return typeof row._id === "string"
        ? row._id
        : typeof row.id === "string"
          ? row.id
          : typeof row.locationId === "string"
            ? row.locationId
            : "";
    })
    .filter(Boolean);
}

async function resolveAgencyId(
  prisma: PrismaClient,
  companyId: string,
  tokens: ProviderTokenPayload
): Promise<string | null> {
  if (tokens.highlevelCompanyId) return tokens.highlevelCompanyId;
  const claims = inspectHighLevelTokenClaims(tokens.agencyAccessToken || tokens.accessToken);
  if (claims.companyId) return claims.companyId;
  const map = await getIdentityMap(prisma, { companyId, entityType: "COMPANY", internalId: companyId });
  const meta = map?.metadata && typeof map.metadata === "object" ? (map.metadata as { agencyId?: unknown }) : null;
  return typeof meta?.agencyId === "string" && meta.agencyId.trim() ? meta.agencyId.trim() : null;
}

export async function fetchInstalledLocationIds(
  agencyAccessToken: string,
  companyId: string,
  locationId?: string
): Promise<{ ok: boolean; locationIds: string[]; status: number; sanitizedError: string | null }> {
  const appId = highlevelMarketplaceVersionId();
  if (!appId) {
    return { ok: false, locationIds: [], status: 0, sanitizedError: "Marketplace app id is not configured." };
  }
  const inspected = await inspectHighLevelInstalledLocationsForCompany({
    accessToken: agencyAccessToken,
    companyId,
    appId,
    locationId,
  });
  if (!inspected.ok) {
    return {
      ok: false,
      locationIds: [],
      status: inspected.status,
      sanitizedError: sanitizeHighLevelErrorMessage(inspected.errorMessage),
    };
  }
  return {
    ok: true,
    locationIds: collectInstalledIds(inspected.data),
    status: inspected.status,
    sanitizedError: null,
  };
}

function mergeLocationTokens(
  companyTokens: ProviderTokenPayload,
  locationTokens: ProviderTokenPayload,
  agencyId: string,
  locationId: string
): ProviderTokenPayload {
  return {
    ...companyTokens,
    accessToken: locationTokens.accessToken,
    refreshToken: locationTokens.refreshToken,
    expiresAt: locationTokens.expiresAt,
    scopes: locationTokens.scopes?.length ? locationTokens.scopes : companyTokens.scopes,
    userType: "Location",
    locationId,
    highlevelCompanyId: agencyId,
    agencyAccessToken: companyTokens.agencyAccessToken || companyTokens.accessToken,
    agencyRefreshToken: companyTokens.agencyRefreshToken || companyTokens.refreshToken,
    agencyExpiresAt: companyTokens.agencyExpiresAt || companyTokens.expiresAt,
  };
}

export async function materializeOAuthLocationTokens(input: {
  exchanged: Awaited<ReturnType<typeof exchangeHighLevelCode>>;
  locationId: string;
}): Promise<{
  tokens: ProviderTokenPayload;
  accessToken: string;
  exchangedToLocation: boolean;
  locationTokenExchangeHttpStatus: number | null;
  installed: boolean | null;
  sanitizedError: string | null;
}> {
  const claims = inspectHighLevelTokenClaims(input.exchanged.tokens.accessToken);
  const userType = input.exchanged.userType || input.exchanged.tokens.userType || claims.userType;
  const tokens: ProviderTokenPayload = {
    ...input.exchanged.tokens,
    userType: userType || input.exchanged.tokens.userType,
    highlevelCompanyId: input.exchanged.agencyId || input.exchanged.tokens.highlevelCompanyId || claims.companyId || undefined,
    locationId: input.exchanged.locationId || input.exchanged.tokens.locationId || input.locationId,
    approvedLocations: input.exchanged.tokens.approvedLocations,
    isBulkInstallation: input.exchanged.tokens.isBulkInstallation,
    approveAllLocations: input.exchanged.tokens.approveAllLocations,
    installToFutureLocations: input.exchanged.tokens.installToFutureLocations,
  };
  if ((userType || "").toLowerCase() !== "company") {
    return {
      tokens,
      accessToken: tokens.accessToken,
      exchangedToLocation: false,
      locationTokenExchangeHttpStatus: null,
      installed: null,
      sanitizedError: null,
    };
  }
  const agencyId = tokens.highlevelCompanyId;
  if (!agencyId) {
    return {
      tokens,
      accessToken: tokens.accessToken,
      exchangedToLocation: false,
      locationTokenExchangeHttpStatus: null,
      installed: null,
      sanitizedError: "Company token is stored but HighLevel companyId is missing, so a Location token cannot be exchanged.",
    };
  }
  const installed = await fetchInstalledLocationIds(tokens.accessToken, agencyId, input.locationId);
  const isInstalled = installed.ok ? installed.locationIds.includes(input.locationId) : null;
  if (installed.ok && isInstalled === false) {
    return {
      tokens,
      accessToken: tokens.accessToken,
      exchangedToLocation: false,
      locationTokenExchangeHttpStatus: null,
      installed: false,
      sanitizedError: "HighLevel reports this location is not an installed Marketplace location for the app.",
    };
  }
  const exchanged = await exchangeCompanyTokenForLocation({
    companyAccessToken: tokens.accessToken,
    companyId: agencyId,
    locationId: input.locationId,
  });
  if (!exchanged.ok || !exchanged.tokens.accessToken) {
    return {
      tokens,
      accessToken: tokens.accessToken,
      exchangedToLocation: false,
      locationTokenExchangeHttpStatus: exchanged.status,
      installed: isInstalled,
      sanitizedError: sanitizeHighLevelErrorMessage(exchanged.error),
    };
  }
  const merged = mergeLocationTokens(tokens, exchanged.tokens, agencyId, input.locationId);
  return {
    tokens: merged,
    accessToken: merged.accessToken,
    exchangedToLocation: true,
    locationTokenExchangeHttpStatus: exchanged.status,
    installed: isInstalled ?? true,
    sanitizedError: null,
  };
}

export async function ensureHighLevelLocationAccess(input: {
  prisma: PrismaClient;
  companyId: string;
  connectionId: string;
  locationId: string;
  tokens: ProviderTokenPayload;
}): Promise<HighLevelLocationAccessResult> {
  const { prisma, companyId, connectionId, locationId } = input;
  const claims = inspectHighLevelTokenClaims(input.tokens.accessToken);
  const tokens: ProviderTokenPayload = {
    ...input.tokens,
    userType: input.tokens.userType || claims.userType || undefined,
    highlevelCompanyId: input.tokens.highlevelCompanyId || claims.companyId || undefined,
    locationId: input.tokens.locationId || claims.locationId || locationId,
  };
  const meta = metadataSnapshot(tokens, locationId);
  const kind = inferHighLevelTokenKind(tokens);

  if (kind === "location" || kind === "unknown") {
    const discoveredFromClaims = Boolean(claims.userType || claims.companyId || claims.locationId);
    if (discoveredFromClaims) {
      await saveConnectionTokens({ companyId, connectionId, tokens });
    }
    return {
      accessToken: tokens.accessToken,
      tokenType: "location",
      installed: null,
      locationTokenExchangeHttpStatus: null,
      sanitizedError: null,
      ...meta,
      storedUserType: storedUserType(tokens) ?? (kind === "location" ? "Location" : meta.storedUserType),
      companyIdPresent: Boolean(tokens.highlevelCompanyId),
      oauthLocationIdPresent: Boolean(tokens.locationId),
    };
  }

  const agencyId = await resolveAgencyId(prisma, companyId, tokens);
  const agencyToken = tokens.agencyAccessToken || tokens.accessToken;
  if (!agencyId) {
    return {
      accessToken: tokens.accessToken,
      tokenType: "company",
      installed: null,
      locationTokenExchangeHttpStatus: null,
      sanitizedError: "Company token is stored but HighLevel companyId is missing, so a Location token cannot be exchanged.",
      ...meta,
    };
  }

  const installed = await fetchInstalledLocationIds(agencyToken, agencyId, locationId);
  const isInstalled = installed.ok ? installed.locationIds.includes(locationId) : null;
  if (installed.ok && isInstalled === false) {
    return {
      accessToken: tokens.accessToken,
      tokenType: "company",
      installed: false,
      locationTokenExchangeHttpStatus: null,
      sanitizedError: "HighLevel reports this location is not an installed Marketplace location for the app.",
      ...meta,
      companyIdPresent: true,
    };
  }

  const exchanged = await exchangeCompanyTokenForLocation({
    companyAccessToken: agencyToken,
    companyId: agencyId,
    locationId,
  });
  if (!exchanged.ok || !exchanged.tokens.accessToken) {
    return {
      accessToken: tokens.accessToken,
      tokenType: "company",
      installed: isInstalled,
      locationTokenExchangeHttpStatus: exchanged.status,
      sanitizedError: sanitizeHighLevelErrorMessage(exchanged.error),
      ...meta,
      companyIdPresent: true,
    };
  }

  const merged = mergeLocationTokens({ ...tokens, highlevelCompanyId: agencyId }, exchanged.tokens, agencyId, locationId);
  await saveConnectionTokens({ companyId, connectionId, tokens: merged });
  return {
    accessToken: merged.accessToken,
    tokenType: "location",
    installed: isInstalled ?? true,
    locationTokenExchangeHttpStatus: exchanged.status,
    sanitizedError: null,
    ...meta,
    storedUserType: "Location",
    oauthLocationIdPresent: true,
    companyIdPresent: true,
  };
}

export async function refreshAndEnsureLocationAccess(input: {
  prisma: PrismaClient;
  companyId: string;
  connectionId: string;
  locationId: string;
  tokens: ProviderTokenPayload;
}): Promise<HighLevelLocationAccessResult> {
  try {
    const refreshed = await refreshHighLevelConnectionTokens({
      ...input.tokens,
      locationId: input.tokens.locationId || input.locationId,
    });
    if (
      refreshed.accessToken !== input.tokens.accessToken ||
      refreshed.refreshToken !== input.tokens.refreshToken ||
      refreshed.agencyAccessToken !== input.tokens.agencyAccessToken
    ) {
      await saveConnectionTokens({
        companyId: input.companyId,
        connectionId: input.connectionId,
        tokens: refreshed,
      });
    }
    return ensureHighLevelLocationAccess({ ...input, tokens: refreshed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HighLevel token refresh failed.";
    if (/location is not active/i.test(message)) {
      return ensureHighLevelLocationAccess(input);
    }
    throw error;
  }
}

export function assertHighLevelLocationToken(access: HighLevelLocationAccess) {
  if (access.tokenType === "company") {
    throw new HighLevelApiError(
      access.locationAccessError || "Company token cannot be used for HighLevel Sub-Account APIs.",
      401
    );
  }
}
