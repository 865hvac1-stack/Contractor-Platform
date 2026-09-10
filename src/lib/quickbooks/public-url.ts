export const PRODUCTION_QUICKBOOKS_APP_URL = "https://contractor-platform-production-c444.up.railway.app";
export const QUICKBOOKS_CALLBACK_PATH = "/api/integrations/quickbooks/callback";
export const PRODUCTION_QUICKBOOKS_CALLBACK_URI = `${PRODUCTION_QUICKBOOKS_APP_URL}${QUICKBOOKS_CALLBACK_PATH}`;

const LOCAL_DEV_ORIGIN = "http://127.0.0.1:43123";

export function isLoopbackHost(host?: string | null) {
  const value = (host || "").trim().toLowerCase();
  return Boolean(value && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(value));
}

export function isLoopbackUrl(value?: string | null) {
  const raw = (value || "").trim();
  if (!raw) return false;
  try {
    return isLoopbackHost(new URL(raw).host);
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]/i.test(raw);
  }
}

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production";
}

function stripSlash(value: string) {
  return value.replace(/\/$/, "");
}

function publicOriginFromValue(value?: string | null): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    if (isLoopbackHost(url.host)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function publicOriginFromRequest(request?: Request): string | null {
  if (!request) return null;
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim();
  if (!host || isLoopbackHost(host)) return null;
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.includes("localhost") ? "http" : "https");
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

export function resolveQuickBooksPublicOrigin(
  request?: Request,
  env: NodeJS.ProcessEnv = process.env
): { origin: string; source: string } {
  const appUrl = publicOriginFromValue(env.APP_URL);
  if (appUrl) return { origin: appUrl, source: "APP_URL" };

  const redirect = env.QUICKBOOKS_REDIRECT_URI?.trim();
  if (redirect) {
    const fromRedirect = publicOriginFromValue(redirect);
    if (fromRedirect) return { origin: fromRedirect, source: "QUICKBOOKS_REDIRECT_URI" };
  }

  const railway = publicOriginFromValue(env.RAILWAY_PUBLIC_DOMAIN || env.RAILWAY_STATIC_URL);
  if (railway) return { origin: railway, source: "RAILWAY_PUBLIC_DOMAIN" };

  const forwarded = publicOriginFromRequest(request);
  if (forwarded) return { origin: forwarded, source: "forwarded_host" };

  if (!isProductionRuntime(env)) {
    const localApp = (env.APP_URL || LOCAL_DEV_ORIGIN).trim();
    try {
      return { origin: new URL(localApp.includes("://") ? localApp : `http://${localApp}`).origin, source: "local_default" };
    } catch {
      return { origin: LOCAL_DEV_ORIGIN, source: "local_default" };
    }
  }

  return { origin: PRODUCTION_QUICKBOOKS_APP_URL, source: "production_canonical" };
}

export function quickbooksRedirectUri(request?: Request, env: NodeJS.ProcessEnv = process.env) {
  const explicit = env.QUICKBOOKS_REDIRECT_URI?.trim();
  if (explicit) {
    const normalized = stripSlash(explicit);
    if (isProductionRuntime(env) && isLoopbackUrl(normalized)) {
      return PRODUCTION_QUICKBOOKS_CALLBACK_URI;
    }
    return normalized;
  }
  return `${resolveQuickBooksPublicOrigin(request, env).origin}${QUICKBOOKS_CALLBACK_PATH}`;
}

export function assertQuickBooksRedirectUriSafe(redirectUri: string, env: NodeJS.ProcessEnv = process.env) {
  if (isProductionRuntime(env) && isLoopbackUrl(redirectUri)) {
    return {
      ok: false as const,
      error: "QuickBooks OAuth is missing a public APP_URL. Set APP_URL to the live ContractorYou site before connecting.",
    };
  }
  return { ok: true as const, redirectUri };
}

export function quickbooksBrowserRedirect(path: string, request?: Request, env: NodeJS.ProcessEnv = process.env) {
  const { origin } = resolveQuickBooksPublicOrigin(request, env);
  return new URL(path, origin);
}

export function quickbooksPostOAuthPath(input: {
  error?: string | null;
  connected?: boolean;
  wizardCompleted?: boolean;
}) {
  if (input.error) return `/settings/quickbooks?error=${encodeURIComponent(input.error)}`;
  if (input.connected && input.wizardCompleted) return "/settings/quickbooks/manage";
  if (input.connected) return "/settings/quickbooks/setup";
  return "/settings/quickbooks";
}
