export const QUICKBOOKS_PROVIDER_KEY = "quickbooks_online";

export type QuickBooksEnvironment = "sandbox" | "production";

export type QuickBooksAppCredentials = {
  clientId: string;
  clientSecret: string;
  environment: QuickBooksEnvironment;
  source: "company" | "env";
};

export type QuickBooksSetupSnapshot = {
  configured: boolean;
  hasEnvClientId: boolean;
  hasEnvClientSecret: boolean;
  hasCompanyClientId: boolean;
  hasCompanySecret: boolean;
  environment: QuickBooksEnvironment;
  redirectUri: string;
  appUrlSet: boolean;
};

export function parseQuickBooksEnvironment(value?: string | null): QuickBooksEnvironment {
  return (value || "").toLowerCase() === "production" ? "production" : "sandbox";
}

export function quickbooksEnvironment(): QuickBooksEnvironment {
  return parseQuickBooksEnvironment(process.env.QUICKBOOKS_ENVIRONMENT);
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

export function quickbooksApiBase(environment?: QuickBooksEnvironment) {
  return (environment ?? quickbooksEnvironment()) === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function envQuickBooksCredentials(): QuickBooksAppCredentials | null {
  const clientId = quickbooksClientId();
  const clientSecret = quickbooksClientSecret();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, environment: quickbooksEnvironment(), source: "env" };
}

export function resolveQuickBooksApp(company: QuickBooksAppCredentials | null): QuickBooksAppCredentials | null {
  if (company?.clientId && company.clientSecret) return company;
  return envQuickBooksCredentials();
}

export function quickbooksConfigured(company?: { hasClientId?: boolean; hasSecret?: boolean } | null) {
  if (company?.hasClientId && company.hasSecret) return true;
  return Boolean(quickbooksClientId() && quickbooksClientSecret());
}

export function quickbooksSetupSnapshot(company?: { hasClientId?: boolean; hasSecret?: boolean; environment?: string | null } | null): QuickBooksSetupSnapshot {
  return {
    configured: quickbooksConfigured(company),
    hasEnvClientId: Boolean(quickbooksClientId()),
    hasEnvClientSecret: Boolean(quickbooksClientSecret()),
    hasCompanyClientId: Boolean(company?.hasClientId),
    hasCompanySecret: Boolean(company?.hasSecret),
    environment: parseQuickBooksEnvironment(company?.environment) || quickbooksEnvironment(),
    redirectUri: quickbooksRedirectUri(),
    appUrlSet: Boolean(process.env.APP_URL?.trim()),
  };
}

export const QUICKBOOKS_SCOPES = ["com.intuit.quickbooks.accounting"];
