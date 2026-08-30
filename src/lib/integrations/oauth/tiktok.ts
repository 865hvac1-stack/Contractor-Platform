import { oauthCallbackUrl } from "@/lib/integrations/env";
import { TIKTOK_SCOPES } from "@/lib/integrations/catalog";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

export function tiktokRedirectUri() {
  return oauthCallbackUrl("tiktok");
}

export function tiktokAuthorizeUrl(input: { state: string; codeChallenge: string; providerKey: string }) {
  const scopes = TIKTOK_SCOPES[input.providerKey] ?? ["user.info.basic"];
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY || "",
    redirect_uri: tiktokRedirectUri(),
    response_type: "code",
    scope: scopes.join(","),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

export async function exchangeTikTokCode(code: string, verifier: string): Promise<ProviderTokenPayload> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: tiktokRedirectUri(),
      code_verifier: verifier,
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "TikTok authorization failed.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
    scopes: json.scope?.split(",").filter(Boolean),
  };
}

export async function refreshTikTokToken(refreshToken: string): Promise<ProviderTokenPayload> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || "TikTok token refresh failed.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
  };
}

export async function revokeTikTokToken(token: string) {
  await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
      token,
    }),
  }).catch(() => undefined);
}
