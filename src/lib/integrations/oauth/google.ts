import { appUrl, oauthCallbackUrl } from "@/lib/integrations/env";
import { GOOGLE_SCOPES } from "@/lib/integrations/catalog";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

export function googleRedirectUri() {
  return oauthCallbackUrl("google");
}

export function googleAuthorizeUrl(input: {
  state: string;
  codeChallenge: string;
  providerKey: string;
  extraScopes?: string[];
}) {
  const scopes = [...(GOOGLE_SCOPES[input.providerKey] ?? ["openid", "email"]), ...(input.extraScopes ?? [])];
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: [...new Set(scopes)].join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string, verifier: string): Promise<ProviderTokenPayload> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    code,
    grant_type: "authorization_code",
    redirect_uri: googleRedirectUri(),
    code_verifier: verifier,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
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
    throw new Error(json.error_description || json.error || "Google authorization failed.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
    scopes: json.scope?.split(" ").filter(Boolean),
  };
}

export async function refreshGoogleToken(refreshToken: string): Promise<ProviderTokenPayload> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google token refresh failed.");
  }
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
    scopes: json.scope?.split(" ").filter(Boolean),
  };
}

export async function revokeGoogleToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => undefined);
}

export async function googleGet(accessToken: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export function googleSetupHint() {
  return [
    "Create a Google Cloud project.",
    "Enable APIs: Business Profile, Google Ads, Analytics Admin + Data, Search Console, YouTube Data.",
    `OAuth redirect URI: ${googleRedirectUri()}`,
    `Authorized JavaScript origin / app URL: ${appUrl()}`,
    "Railway: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.",
    "Google Ads / LSA also need GOOGLE_ADS_DEVELOPER_TOKEN.",
  ];
}
