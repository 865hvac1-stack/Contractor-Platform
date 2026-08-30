import { oauthCallbackUrl } from "@/lib/integrations/env";
import { META_SCOPES } from "@/lib/integrations/catalog";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

export function metaRedirectUri() {
  return oauthCallbackUrl("meta");
}

export function metaAuthorizeUrl(input: { state: string; providerKey: string }) {
  const scopes = META_SCOPES[input.providerKey] ?? ["pages_show_list"];
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID || "",
    redirect_uri: metaRedirectUri(),
    state: input.state,
    response_type: "code",
    scope: scopes.join(","),
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeMetaCode(code: string): Promise<ProviderTokenPayload> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID || "",
    client_secret: process.env.META_APP_SECRET || "",
    redirect_uri: metaRedirectUri(),
    code,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`);
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error?.message || "Meta authorization failed.");
  }

  const longLived = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID || "",
      client_secret: process.env.META_APP_SECRET || "",
      fb_exchange_token: json.access_token,
    }).toString()}`
  );
  const longJson = (await longLived.json()) as { access_token?: string; expires_in?: number };
  const token = longJson.access_token || json.access_token;
  const expires = longJson.expires_in ?? json.expires_in;
  return {
    accessToken: token,
    expiresAt: expires ? new Date(Date.now() + expires * 1000).toISOString() : undefined,
    scopes: META_SCOPES.facebook,
  };
}

export async function revokeMetaToken(token: string) {
  await fetch(`https://graph.facebook.com/v21.0/me/permissions`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

export async function metaGet(accessToken: string, path: string) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}
