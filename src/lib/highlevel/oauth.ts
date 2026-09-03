import { HIGHLEVEL_API_BASE, HIGHLEVEL_AUTHORIZE_URL, HIGHLEVEL_AUTHORIZE_URL_WHITELABEL, HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import {
  highlevelClientId,
  highlevelClientSecret,
  highlevelMarketplaceVersionId,
  highlevelRedirectUri,
  highlevelRequestedScopes,
} from "@/lib/highlevel/env";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

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
};

export async function exchangeHighLevelCode(code: string): Promise<{
  tokens: ProviderTokenPayload;
  locationId: string | null;
  agencyId: string | null;
  userType: string | null;
  httpStatus?: number;
}> {
  return requestHighLevelToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: highlevelOAuthRedirectUri(),
  });
}

export async function refreshHighLevelToken(refreshToken: string) {
  const result = await requestHighLevelToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Location",
  });
  return result.tokens;
}

async function requestHighLevelToken(body: Record<string, string>) {
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
    const raw = data.message ?? data.error;
    const message =
      typeof raw === "string" && raw.trim()
        ? raw.trim()
        : Array.isArray(raw)
          ? raw.filter((item): item is string => typeof item === "string").join(" ").trim()
          : "";
    throw new HighLevelOAuthExchangeError(message || "HighLevel did not return an access token.", response.status);
  }
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined;
  return {
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      scopes: data.scope?.split(/[,\s]+/).filter(Boolean) ?? highlevelRequestedScopes(),
    } satisfies ProviderTokenPayload,
    locationId: data.locationId ?? null,
    agencyId: data.companyId ?? null,
    userType: data.userType ?? null,
    httpStatus: response.status,
  };
}

export function highlevelProviderKey() {
  return HIGHLEVEL_PROVIDER_KEY;
}
