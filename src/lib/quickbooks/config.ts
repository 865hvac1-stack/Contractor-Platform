export const QUICKBOOKS_PROVIDER_KEY = "quickbooks_online";

export function quickbooksEnvironment(): "sandbox" | "production" {
  const value = (process.env.QUICKBOOKS_ENVIRONMENT || "sandbox").toLowerCase();
  return value === "production" ? "production" : "sandbox";
}

export function quickbooksClientId() {
  return process.env.QUICKBOOKS_CLIENT_ID?.trim() || "";
}

export function quickbooksClientSecret() {
  return process.env.QUICKBOOKS_CLIENT_SECRET?.trim() || "";
}

export function quickbooksRedirectUri() {
  if (process.env.QUICKBOOKS_REDIRECT_URI?.trim()) return process.env.QUICKBOOKS_REDIRECT_URI.trim();
  const app = (process.env.APP_URL || "http://127.0.0.1:43123").replace(/\/$/, "");
  return `${app}/api/integrations/quickbooks/callback`;
}

export function quickbooksAuthorizeUrl() {
  return "https://appcenter.intuit.com/connect/oauth2";
}

export function quickbooksTokenUrl() {
  return "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
}

export function quickbooksRevokeUrl() {
  return "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
}

export function quickbooksApiBase() {
  return quickbooksEnvironment() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function quickbooksConfigured() {
  return Boolean(quickbooksClientId() && quickbooksClientSecret());
}

export const QUICKBOOKS_SCOPES = ["com.intuit.quickbooks.accounting"];
