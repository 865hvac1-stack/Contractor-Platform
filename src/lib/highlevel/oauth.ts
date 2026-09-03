import { HIGHLEVEL_API_BASE, HIGHLEVEL_AUTHORIZE_URL, HIGHLEVEL_AUTHORIZE_URL_WHITELABEL, HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import {
  highlevelClientId,
  highlevelClientSecret,
  highlevelMarketplaceVersionId,
  highlevelRedirectUri,
  highlevelRequestedScopes,
} from "@/lib/highlevel/env";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";
import { inspectHighLevelTokenClaims } from "@/lib/highlevel/token-claims";

export function highlevelAuthorizeBaseUrl() {
  const override = process.env.HIGHLEVEL_AUTHORIZE_URL?.trim();
  if (override && /^https:\/\/marketplace\.(gohighlevel|leadconnectorhq)\.com\/oauth\/chooselocation$/i.test(override)) {
    return override.replace(/\/$/, "");
  }
  if (process.env.HIGHLEVEL_WHITELABEL_OAUTH === "true") {
    return HIGHLEVEL_AUTHORIZE_URL_WHITELABEL;
  }
  return HIGHLEVEL_AUTHORIZE_URL;
}

/** Same Redirect URL as Marketplace Auth. Must match token-exchange redirect_uri. */
export function highlevelOAuthRedirectUri() {
  return highlevelRedirectUri();
}

export function highlevelAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: highlevelClientId(),
    redirect_uri: highlevelOAuthRedirectUri(),
    scope: highlevelRequestedScopes().join(" "),
    state,
  });
  const versionId = highlevelMarketplaceVersionId();
  if (versionId) params.set("version_id", versionId);
  return `${highlevelAuthorizeBaseUrl()}?${params.toString()}`;
}

export class HighLevelOAuthExchangeError extends Error {
  readonly errorClass = "HighLevelOAuthExchangeError";

  constructor(
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "HighLevelOAuthExchangeError";
  }
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  locationId?: string;
  companyId?: string;
  userType?: string;
  userId?: string;
  approvedLocations?: string[];
  isBulkInstallation?: boolean;
  approveAllLocations?: boolean;
  installToFutureLocations?: boolean;
};

export type HighLevelTokenExchange = {
  tokens: ProviderTokenPayload;
  locationId: string | null;
  agencyId: string | null;
  userType: string | null;
  httpStatus?: number;
};

function tokenErrorMessage(data: { message?: unknown; error?: unknown }) {
  const raw = data.message ?? data.error;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string").join(" ").trim();
  }
  return "";
}

function payloadFromTokenResponse(data: TokenResponse): ProviderTokenPayload {
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined;
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token,
    expiresAt,
    scopes: data.scope?.split(/[,\s]+/).filter(Boolean) ?? highlevelRequestedScopes(),
    userType: data.userType,
    highlevelCompanyId: data.companyId,
    locationId: data.locationId,
    approvedLocations: Array.isArray(data.approvedLocations) ? data.approvedLocations.filter((id) => typeof id === "string") : undefined,
    isBulkInstallation: data.isBulkInstallation,
    approveAllLocations: data.approveAllLocations,
    installToFutureLocations: data.installToFutureLocations,
  };
}

export async function exchangeHighLevelCode(code: string): Promise<HighLevelTokenExchange> {
  return requestHighLevelToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: highlevelOAuthRedirectUri(),
  });
}

export async function refreshHighLevelToken(refreshToken: string, userType: "Location" | "Company" = "Location") {
  const result = await requestHighLevelToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: userType,
  });
  return result.tokens;
}

export async function exchangeCompanyTokenForLocation(input: {
  companyAccessToken: string;
  companyId: string;
  locationId: string;
}): Promise<{
  ok: boolean;
  tokens: ProviderTokenPayload;
  httpStatus: number;
  status: number;
  error: string | null;
}> {
  const attempts: Array<{ path: string; version: string }> = [
    { path: "/oauth/location-token", version: "v3" },
    { path: "/oauth/locationToken", version: "2021-07-28" },
  ];
  let lastStatus = 0;
  let lastError = "HighLevel location-token exchange failed.";
  for (const attempt of attempts) {
    const response = await fetch(`${HIGHLEVEL_API_BASE}${attempt.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.companyAccessToken}`,
        Version: attempt.version,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        companyId: input.companyId,
        locationId: input.locationId,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as TokenResponse & { message?: unknown; error?: unknown };
    lastStatus = response.status;
    if (response.ok && data.access_token) {
      const tokens = payloadFromTokenResponse(data);
      return {
        ok: true,
        tokens: { ...tokens, userType: tokens.userType || "Location" },
        httpStatus: response.status,
        status: response.status,
        error: null,
      };
    }
    lastError = tokenErrorMessage(data) || lastError;
  }
  return { ok: false, tokens: { accessToken: "" }, httpStatus: lastStatus, status: lastStatus, error: lastError };
}

export async function refreshHighLevelConnectionTokens(tokens: ProviderTokenPayload): Promise<ProviderTokenPayload> {
  const claims = inspectHighLevelTokenClaims(tokens.agencyAccessToken || tokens.accessToken);
  const originalType = (tokens.userType || claims.userType || "").toLowerCase();
  const companyRefresh =
    tokens.agencyRefreshToken ||
    (originalType === "company" && !tokens.agencyAccessToken ? tokens.refreshToken : undefined);
  const locationRefresh = tokens.agencyAccessToken
    ? tokens.refreshToken
    : originalType === "location" || !originalType
      ? tokens.refreshToken
      : undefined;

  if (companyRefresh) {
    const agency = await refreshHighLevelToken(companyRefresh, "Company");
    const companyId = tokens.highlevelCompanyId || agency.highlevelCompanyId || claims.companyId;
    const locationId = tokens.locationId || claims.locationId;
    const next: ProviderTokenPayload = {
      ...tokens,
      agencyAccessToken: agency.accessToken,
      agencyRefreshToken: agency.refreshToken || companyRefresh,
      agencyExpiresAt: agency.expiresAt,
      userType: "Company",
      highlevelCompanyId: companyId || tokens.highlevelCompanyId,
    };
    if (companyId && locationId) {
      const exchanged = await exchangeCompanyTokenForLocation({
        companyAccessToken: agency.accessToken,
        companyId,
        locationId,
      });
      if (!exchanged.error && exchanged.tokens.accessToken) {
        return {
          ...next,
          accessToken: exchanged.tokens.accessToken,
          refreshToken: exchanged.tokens.refreshToken,
          expiresAt: exchanged.tokens.expiresAt,
          userType: "Location",
          locationId,
        };
      }
    }
    return next;
  }

  if (!locationRefresh) return tokens;
  const refreshed = await refreshHighLevelToken(locationRefresh, "Location");
  return {
    ...tokens,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || locationRefresh,
    expiresAt: refreshed.expiresAt,
    userType: tokens.userType || refreshed.userType || "Location",
    locationId: tokens.locationId || refreshed.locationId || undefined,
  };
}

async function requestHighLevelToken(body: Record<string, string>): Promise<HighLevelTokenExchange> {
  const params = new URLSearchParams({
    client_id: highlevelClientId(),
    client_secret: highlevelClientSecret(),
    ...body,
  });
  const response = await fetch(`${HIGHLEVEL_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse & { message?: unknown; error?: unknown };
  if (!response.ok || !data.access_token) {
    throw new HighLevelOAuthExchangeError(tokenErrorMessage(data) || "HighLevel did not return an access token.", response.status);
  }
  const tokens = payloadFromTokenResponse(data);
  return {
    tokens,
    locationId: data.locationId ?? null,
    agencyId: data.companyId ?? null,
    userType: data.userType ?? null,
    httpStatus: response.status,
  };
}

export function highlevelProviderKey() {
  return HIGHLEVEL_PROVIDER_KEY;
}
