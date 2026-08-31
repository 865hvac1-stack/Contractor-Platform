import { createHash, randomBytes } from "crypto";
import {
  QUICKBOOKS_SCOPES,
  quickbooksAuthorizeUrl,
  quickbooksClientId,
  quickbooksClientSecret,
  quickbooksRedirectUri,
  quickbooksRevokeUrl,
  quickbooksTokenUrl,
} from "@/lib/quickbooks/config";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

function basicAuth() {
  return Buffer.from(`${quickbooksClientId()}:${quickbooksClientSecret()}`).toString("base64");
}

export function createQuickBooksState() {
  return randomBytes(24).toString("hex");
}

export function quickbooksAuthorizeHref(state: string) {
  const params = new URLSearchParams({
    client_id: quickbooksClientId(),
    redirect_uri: quickbooksRedirectUri(),
    response_type: "code",
    scope: QUICKBOOKS_SCOPES.join(" "),
    state,
  });
  return `${quickbooksAuthorizeUrl()}?${params.toString()}`;
}

export async function exchangeQuickBooksCode(code: string): Promise<ProviderTokenPayload> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: quickbooksRedirectUri(),
  });
  const response = await fetch(quickbooksTokenUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
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

export async function refreshQuickBooksToken(refreshToken: string): Promise<ProviderTokenPayload> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch(quickbooksTokenUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
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

export async function revokeQuickBooksToken(token: string) {
  await fetch(quickbooksRevokeUrl(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

export function fingerprintRealm(realmId: string) {
  return createHash("sha256").update(realmId).digest("hex").slice(0, 12);
}
