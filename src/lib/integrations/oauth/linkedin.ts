import { oauthCallbackUrl } from "@/lib/integrations/env";
import { LINKEDIN_SCOPES } from "@/lib/integrations/catalog";
import type { ProviderTokenPayload } from "@/lib/integrations/crypto";

export function linkedinRedirectUri() {
  return oauthCallbackUrl("linkedin");
}

export function linkedinAuthorizeUrl(input: { state: string }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    redirect_uri: linkedinRedirectUri(),
    state: input.state,
    scope: (LINKEDIN_SCOPES.linkedin ?? []).join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export async function exchangeLinkedInCode(code: string): Promise<ProviderTokenPayload> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: linkedinRedirectUri(),
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "LinkedIn authorization failed.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
    scopes: LINKEDIN_SCOPES.linkedin,
  };
}

export async function revokeLinkedInToken(token: string) {
  await fetch("https://www.linkedin.com/oauth/v2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
      token,
    }),
  }).catch(() => undefined);
}
