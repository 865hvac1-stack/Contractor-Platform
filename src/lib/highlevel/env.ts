import { appUrl, oauthCallbackUrl } from "@/lib/integrations/env";
import { HIGHLEVEL_SCOPES } from "@/lib/highlevel/config";

export const HIGHLEVEL_CLIENT_ID_IS_APP_ID_MESSAGE =
  "HIGHLEVEL_CLIENT_ID is a Marketplace App/Version ID, not a Client Key. In HighLevel Marketplace → your app → Auth → Client Keys, copy the Client ID (it includes a hyphen) into Railway HIGHLEVEL_CLIENT_ID. Do not paste the App ID.";

export function highlevelOAuthConfigured() {
  return Boolean(process.env.HIGHLEVEL_CLIENT_ID?.trim() && process.env.HIGHLEVEL_CLIENT_SECRET?.trim());
}

export function highlevelClientId() {
  return process.env.HIGHLEVEL_CLIENT_ID?.trim() || "";
}

/** Official Marketplace Client Key: `{24-hex app/version id}-{suffix}`. */
export function isHighLevelClientKey(value: string) {
  return /^[a-f0-9]{24}-[a-z0-9]+$/i.test(value.trim());
}

/** Raw Marketplace app/version ObjectId, not a Client Key. */
export function isHighLevelAppOrVersionId(value: string) {
  return /^[a-f0-9]{24}$/i.test(value.trim());
}

export function highlevelMarketplaceVersionId() {
  const explicit = process.env.HIGHLEVEL_VERSION_ID?.trim();
  if (explicit) return explicit;
  const clientId = highlevelClientId();
  const hyphen = clientId.indexOf("-");
  if (hyphen === 24 && isHighLevelClientKey(clientId)) return clientId.slice(0, hyphen);
  return "";
}

export function highlevelClientSecret() {
  return process.env.HIGHLEVEL_CLIENT_SECRET?.trim() || "";
}

export function highlevelRedirectUri() {
  const override = process.env.HIGHLEVEL_REDIRECT_URI?.trim();
  if (override && !/highlevel/i.test(override)) {
    return override.replace(/\/$/, "");
  }
  return oauthCallbackUrl("highlevel");
}

export function highlevelWebhookUrl() {
  return `${appUrl()}/api/webhooks/highlevel`;
}

export function highlevelRequestedScopes() {
  const extra = process.env.HIGHLEVEL_SCOPES?.trim();
  if (extra) return extra.split(/[,\s]+/).filter(Boolean);
  return [...HIGHLEVEL_SCOPES];
}

export function highlevelOAuthNotes() {
  const missing: string[] = [];
  if (!highlevelClientId()) missing.push("HIGHLEVEL_CLIENT_ID");
  if (!highlevelClientSecret()) missing.push("HIGHLEVEL_CLIENT_SECRET");
  return {
    configured: missing.length === 0,
    missing,
    notes: [
      "Marketplace OAuth is the production multi-tenant path.",
      `Redirect URI: ${highlevelRedirectUri()}`,
      `Webhook URL: ${highlevelWebhookUrl()}`,
      "Marketplace OAuth (agency install → location token) is the long-term multi-tenant path.",
      "A location Private Integration Token is acceptable for controlled development and 865 HVAC testing only.",
      "Subscribe to InboundMessage / OutboundMessage so CALL events include from, to, and optional recording attachments.",
      "Production webhook: POST https://contractor-platform-production-c444.up.railway.app/api/webhooks/highlevel",
      "Railway log identifier: highlevel.webhook",
    ],
  };
}
