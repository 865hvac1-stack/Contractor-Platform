/**
 * Production-safe HighLevel webhook diagnostics.
 * Railway-searchable one-line JSON. Never includes phones, bodies, tokens,
 * secrets, signatures, cookies, or authorization headers.
 */

export const PRODUCTION_HIGHLEVEL_WEBHOOK_URL =
  "https://contractor-platform-production-c444.up.railway.app/api/webhooks/highlevel";

export const HIGHLEVEL_WEBHOOK_MARKERS = {
  RECEIVED: "HIGHLEVEL_WEBHOOK_RECEIVED",
  EVENT_TYPE: "HIGHLEVEL_WEBHOOK_EVENT_TYPE",
  LOCATION_RESOLVED: "HIGHLEVEL_WEBHOOK_LOCATION_RESOLVED",
  PROCESSED: "HIGHLEVEL_WEBHOOK_PROCESSED",
  FAILED: "HIGHLEVEL_WEBHOOK_FAILED",
} as const;

export type HighLevelWebhookMarker =
  (typeof HIGHLEVEL_WEBHOOK_MARKERS)[keyof typeof HIGHLEVEL_WEBHOOK_MARKERS];

export type HighLevelWebhookFailReason =
  | "missing_signature"
  | "invalid_signature"
  | "invalid_json"
  | "location_unmapped"
  | "processing_failed";

const FORBIDDEN_KEYS = [
  "from",
  "to",
  "fromNumber",
  "toNumber",
  "phone",
  "caller",
  "body",
  "message",
  "authorization",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "signature",
  "ghlSignature",
  "legacySignature",
  "cookie",
  "cookies",
  "code",
  "pit",
] as const;

export type HighLevelWebhookDiagnosticFields = {
  marker: HighLevelWebhookMarker;
  route: string;
  httpStatus?: number | null;
  eventType?: string | null;
  messageType?: string | null;
  locationId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  companyId?: string | null;
  connectionId?: string | null;
  channel?: string | null;
  direction?: string | null;
  hasSignature?: boolean;
  hasXGhlSignature?: boolean;
  hasXWhSignature?: boolean;
  hasAuthorization?: boolean;
  requestReachedRoute?: boolean;
  layer?: "middleware" | "route" | null;
  bodyBytes?: number | null;
  locationMapped?: boolean;
  processed?: boolean;
  duplicate?: boolean;
  reason?: HighLevelWebhookFailReason | string | null;
};

function looksLikePhone(value: string) {
  const compact = value.replace(/[\s().-]/g, "");
  return /^\+?\d{7,15}$/.test(compact);
}

function sanitizeText(value: string) {
  return value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\+?1?[\s().-]*\d[\d\s().-]{6,16}\d/g, "[redacted-phone]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(pit|sk|whsec|tok)[-_A-Za-z0-9]+/gi, "[redacted]")
    .slice(0, 240);
}

export function sanitizeWebhookDiagnostic(
  fields: HighLevelWebhookDiagnosticFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    event: "highlevel.webhook.diagnostic",
    marker: fields.marker,
    route: fields.route,
    timestamp: new Date().toISOString(),
  };
  if (fields.httpStatus != null) out.httpStatus = fields.httpStatus;
  if (fields.eventType) out.eventType = fields.eventType;
  if (fields.messageType) out.messageType = fields.messageType;
  if (fields.locationId) out.locationId = fields.locationId;
  if (fields.conversationId) out.conversationId = fields.conversationId;
  if (fields.messageId) out.messageId = fields.messageId;
  if (fields.companyId) out.companyId = fields.companyId;
  if (fields.connectionId) out.connectionId = fields.connectionId;
  if (fields.channel) out.channel = fields.channel;
  if (fields.direction) out.direction = fields.direction;
  if (fields.hasSignature !== undefined) out.hasSignature = fields.hasSignature;
  if (fields.hasXGhlSignature !== undefined) out.hasXGhlSignature = fields.hasXGhlSignature;
  if (fields.hasXWhSignature !== undefined) out.hasXWhSignature = fields.hasXWhSignature;
  if (fields.hasAuthorization !== undefined) out.hasAuthorization = fields.hasAuthorization;
  if (fields.requestReachedRoute !== undefined) out.requestReachedRoute = fields.requestReachedRoute;
  if (fields.layer) out.layer = fields.layer;
  if (fields.bodyBytes != null) out.bodyBytes = fields.bodyBytes;
  if (fields.locationMapped !== undefined) out.locationMapped = fields.locationMapped;
  if (fields.processed !== undefined) out.processed = fields.processed;
  if (fields.duplicate !== undefined) out.duplicate = fields.duplicate;
  if (fields.reason) out.reason = sanitizeText(fields.reason);

  for (const key of FORBIDDEN_KEYS) {
    delete out[key];
  }
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string" && looksLikePhone(value) && key !== "locationId") {
      delete out[key];
    }
  }
  return out;
}

export function logHighLevelWebhookDiagnostic(fields: HighLevelWebhookDiagnosticFields): void {
  console.info(JSON.stringify(sanitizeWebhookDiagnostic(fields)));
}

export function webhookUrlMatchesProduction(url: string) {
  return url === PRODUCTION_HIGHLEVEL_WEBHOOK_URL;
}
