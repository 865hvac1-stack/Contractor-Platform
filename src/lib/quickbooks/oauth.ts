import { createHash, randomBytes } from "crypto";
import {
  QUICKBOOKS_SCOPES,
  envQuickBooksCredentials,
  quickbooksAuthorizeUrl,
  quickbooksRedirectUri,
  quickbooksRevokeUrl,
  quickbooksTokenUrl,
  type QuickBooksAppCredentials,
} from "@/lib/quickbooks/config";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

function basicAuth(app: QuickBooksAppCredentials) {
  return Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
}

function requireApp(app?: QuickBooksAppCredentials | null): QuickBooksAppCredentials {
  const resolved = app ?? envQuickBooksCredentials();
  if (!resolved) throw new Error("QuickBooks app credentials are not configured.");
  return resolved;
}

export function createQuickBooksState() {
  return randomBytes(24).toString("hex");
}

export function quickbooksAuthorizeHref(state: string, app?: QuickBooksAppCredentials | null) {
  const resolved = requireApp(app);
  const params = new URLSearchParams({
    client_id: resolved.clientId,
    redirect_uri: quickbooksRedirectUri(),
    response_type: "code",
    scope: QUICKBOOKS_SCOPES.join(" "),
    state,
  });
  return `${quickbooksAuthorizeUrl()}?${params.toString()}`;
}

export async function exchangeQuickBooksCode(
  code: string,
  app?: QuickBooksAppCredentials | null
): Promise<ProviderTokenPayload> {
  const resolved = requireApp(app);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: quickbooksRedirectUri(),
  });
  const response = await fetch(quickbooksTokenUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(resolved)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    throw new Error("QuickBooks did not accept that authorization.");
  }
  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
    scopes: json.scope?.split(" "),
  };
}

export async function refreshQuickBooksToken(
  refreshToken: string,
  app?: QuickBooksAppCredentials | null
): Promise<ProviderTokenPayload> {
  const resolved = requireApp(app);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch(quickbooksTokenUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(resolved)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    throw new Error("QuickBooks refresh failed.");
  }
  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
  };
}

export async function revokeQuickBooksToken(token: string, app?: QuickBooksAppCredentials | null) {
  const resolved = envQuickBooksCredentials() ?? app;
  if (!resolved) return;
  await fetch(quickbooksRevokeUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(resolved)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

export function fingerprintRealm(realmId: string) {
  return createHash("sha256").update(realmId).digest("hex").slice(0, 12);
}
