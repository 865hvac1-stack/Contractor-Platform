/**
 * Production-safe HighLevel OAuth diagnostics.
 * Railway-searchable one-line JSON. Never includes codes, tokens, secrets, or cookies.
 */

export const PRODUCTION_OAUTH_CALLBACK_URI =
  "https://contractor-platform-production-c444.up.railway.app/api/integrations/oauth/callback";

export const HIGHLEVEL_OAUTH_MARKERS = {
  START: "HIGHLEVEL_OAUTH_START",
  CALLBACK_RECEIVED: "HIGHLEVEL_OAUTH_CALLBACK_RECEIVED",
  STATE_VALID: "HIGHLEVEL_OAUTH_STATE_VALID",
  STATE_INVALID: "HIGHLEVEL_OAUTH_STATE_INVALID",
  CODE_EXCHANGE_START: "HIGHLEVEL_OAUTH_CODE_EXCHANGE_START",
  CODE_EXCHANGE_SUCCESS: "HIGHLEVEL_OAUTH_CODE_EXCHANGE_SUCCESS",
  CODE_EXCHANGE_FAILED: "HIGHLEVEL_OAUTH_CODE_EXCHANGE_FAILED",
  LOCATION_RESOLVED: "HIGHLEVEL_OAUTH_LOCATION_RESOLVED",
  CONNECTION_SAVED: "HIGHLEVEL_OAUTH_CONNECTION_SAVED",
} as const;

export type HighLevelOAuthMarker =
  (typeof HIGHLEVEL_OAUTH_MARKERS)[keyof typeof HIGHLEVEL_OAUTH_MARKERS];

const FORBIDDEN = [
  "code",
  "authorizationCode",
  "state",
  "rawState",
  "clientSecret",
  "client_secret",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "token",
  "pit",
  "pitToken",
  "cookie",
  "cookies",
  "session",
  "sessionToken",
  "authorization",
] as const;

export type HighLevelOAuthDiagnosticFields = {
  marker: HighLevelOAuthMarker;
  route: string;
  companyId?: string | null;
  httpStatus?: number | null;
  hasCode?: boolean;
  hasState?: boolean;
  hasError?: boolean;
  locationId?: string | null;
  redirectUriMatchesProduction?: boolean;
  errorClass?: string | null;
  errorMessage?: string | null;
  reason?: string | null;
  requestedScopes?: string[];
};

function sanitizeErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .slice(0, 240);
}

export function sanitizeOAuthDiagnostic(
  fields: HighLevelOAuthDiagnosticFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    event: "highlevel.oauth.diagnostic",
    marker: fields.marker,
    route: fields.route,
    timestamp: new Date().toISOString(),
  };
  if (fields.companyId) out.companyId = fields.companyId;
  if (fields.httpStatus != null) out.httpStatus = fields.httpStatus;
  if (fields.hasCode !== undefined) out.hasCode = fields.hasCode;
  if (fields.hasState !== undefined) out.hasState = fields.hasState;
  if (fields.hasError !== undefined) out.hasError = fields.hasError;
  if (fields.locationId) out.locationId = fields.locationId;
  if (fields.redirectUriMatchesProduction !== undefined) {
    out.redirectUriMatchesProduction = fields.redirectUriMatchesProduction;
  }
  if (fields.errorClass) out.errorClass = fields.errorClass;
  if (fields.errorMessage) out.errorMessage = sanitizeErrorMessage(fields.errorMessage);
  if (fields.reason) out.reason = fields.reason;
  if (fields.requestedScopes?.length) {
    out.requestedScopes = fields.requestedScopes.filter((scope) => typeof scope === "string" && scope.length > 0);
  }

  for (const key of FORBIDDEN) {
    delete out[key];
  }
  return out;
}

export function logHighLevelOAuthDiagnostic(fields: HighLevelOAuthDiagnosticFields): void {
  console.info(JSON.stringify(sanitizeOAuthDiagnostic(fields)));
}

export function redirectUriMatchesProduction(redirectUri: string): boolean {
  return redirectUri === PRODUCTION_OAUTH_CALLBACK_URI;
}
