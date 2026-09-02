export const HIGHLEVEL_OAUTH_LOG_EVENT = "highlevel.oauth";

export type HighLevelOAuthReason =
  | "OAUTH_START"
  | "OAUTH_STATE_MISSING"
  | "OAUTH_STATE_EXPIRED"
  | "OAUTH_STATE_MISMATCH"
  | "OAUTH_CODE_MISSING"
  | "OAUTH_EXCHANGE_FAILED"
  | "OAUTH_REDIRECT_URI_MISMATCH"
  | "LOCATION_ALREADY_OWNED_BY_OTHER_COMPANY"
  | "LOCATION_SAME_COMPANY_PIT_UPGRADE"
  | "LOCATION_ID_MISSING"
  | "OAUTH_CONNECTED"
  | "OAUTH_TEST_ONLY"
  | "OAUTH_PROBE_FAILED";

const FORBIDDEN_KEYS = new Set([
  "authorization",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "clientsecret",
  "apikey",
  "password",
  "signature",
  "credential",
  "bearer",
  "cookie",
  "code",
  "privateToken",
]);

function safeErrorMessage(value: unknown) {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : "OAuth failed.";
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(pit|sk|whsec|tok)[-_A-Za-z0-9]+/gi, "[redacted]");
}

export function logHighLevelOAuth(entry: {
  reason: HighLevelOAuthReason;
  companyId?: string | null;
  userId?: string | null;
  connectionId?: string | null;
  locationId?: string | null;
  hasState?: boolean;
  hasCode?: boolean;
  sandbox?: boolean;
  pitUpgrade?: boolean;
  redirectUriHost?: string | null;
  redirectUriPath?: string | null;
  error?: string | null;
}) {
  const safe: Record<string, unknown> = {
    event: HIGHLEVEL_OAUTH_LOG_EVENT,
    provider: "highlevel",
  };
  for (const [key, value] of Object.entries(entry)) {
    if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    safe[key] = key === "error" && value ? safeErrorMessage(value) : value;
  }
  console.info(JSON.stringify(safe));
}
