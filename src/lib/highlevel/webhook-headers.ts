/**
 * Header-name inspection only. Safe for Edge middleware.
 * Never returns header values — callers that verify signatures must read them separately.
 */

export const HIGHLEVEL_WEBHOOK_ROUTE = "/api/webhooks/highlevel";

/** Official Marketplace headers. https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/ */
export const HIGHLEVEL_GHL_SIGNATURE_HEADER = "x-ghl-signature";
export const HIGHLEVEL_LEGACY_SIGNATURE_HEADER = "x-wh-signature";

export type HighLevelWebhookHeaderPresence = {
  hasXGhlSignature: boolean;
  hasXWhSignature: boolean;
  hasAuthorization: boolean;
};

function present(value: string | null) {
  return Boolean(value && value !== "N/A");
}

export function inspectHighLevelWebhookHeaders(headers: { get(name: string): string | null }): HighLevelWebhookHeaderPresence {
  return {
    hasXGhlSignature: present(headers.get(HIGHLEVEL_GHL_SIGNATURE_HEADER)),
    hasXWhSignature: present(headers.get(HIGHLEVEL_LEGACY_SIGNATURE_HEADER)),
    hasAuthorization: present(headers.get("authorization")),
  };
}

export function isHighLevelWebhookPost(pathname: string, method: string) {
  return method === "POST" && (pathname === HIGHLEVEL_WEBHOOK_ROUTE || pathname === `${HIGHLEVEL_WEBHOOK_ROUTE}/`);
}
