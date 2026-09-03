export const HIGHLEVEL_WEBHOOK_LOG_EVENT = "highlevel.webhook";

export type HighLevelWebhookLogStage =
  | "received"
  | "auth_failed"
  | "parse_failed"
  | "location_unmapped"
  | "processed"
  | "duplicate"
  | "failed";

export type HighLevelWebhookLog = {
  event: typeof HIGHLEVEL_WEBHOOK_LOG_EVENT;
  provider: "highlevel";
  stage: HighLevelWebhookLogStage;
  eventType?: string | null;
  locationMapped?: boolean;
  locationId?: string | null;
  companyId?: string | null;
  connectionId?: string | null;
  webhookId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  contactId?: string | null;
  channel?: string | null;
  direction?: string | null;
  trackingSource?: string | null;
  customerMatched?: boolean;
  leadCreated?: boolean;
  callRecordCreated?: boolean;
  callRecordUpdated?: boolean;
  threadId?: string | null;
  hasRecording?: boolean;
  idempotency?: "new" | "duplicate";
  signed?: boolean;
  error?: string | null;
};

const FORBIDDEN_KEY =
  /authorization|token|secret|api[_-]?key|password|signature|credential|bearer|cookie|from|to|phone|caller|body|message$/i;
const PHONE_VALUE = /^\+?[\d().\-\s]{7,20}$/;

function safeErrorMessage(value: unknown) {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : "Webhook processing failed.";
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\+?1?[\s().-]*\d[\d\s().-]{6,16}\d/g, "[redacted-phone]")
    .replace(/\b(pit|sk|whsec|tok)[-_A-Za-z0-9]+/gi, "[redacted]");
}

export function logHighLevelWebhook(entry: Omit<HighLevelWebhookLog, "event" | "provider">) {
  const merged: HighLevelWebhookLog = {
    event: HIGHLEVEL_WEBHOOK_LOG_EVENT,
    provider: "highlevel",
    ...entry,
    error: entry.error ? safeErrorMessage(entry.error) : entry.error,
  };
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "string" && PHONE_VALUE.test(value.trim()) && key !== "locationId") continue;
    safe[key] = value;
  }
  console.info(JSON.stringify(safe));
}

export function formatCallDurationLabel(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes <= 0) return `${remainder}s`;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
