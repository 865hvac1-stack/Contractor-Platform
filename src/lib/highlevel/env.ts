import { appUrl } from "@/lib/integrations/env";
import { HIGHLEVEL_SCOPES } from "@/lib/highlevel/config";

export function highlevelOAuthConfigured() {
  return Boolean(process.env.HIGHLEVEL_CLIENT_ID?.trim() && process.env.HIGHLEVEL_CLIENT_SECRET?.trim());
}

export function highlevelClientId() {
  return process.env.HIGHLEVEL_CLIENT_ID?.trim() || "";
}

export function highlevelClientSecret() {
  return process.env.HIGHLEVEL_CLIENT_SECRET?.trim() || "";
}

export function highlevelRedirectUri() {
  return (
    process.env.HIGHLEVEL_REDIRECT_URI?.trim() ||
    `${appUrl()}/api/integrations/highlevel/callback`
  );
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
