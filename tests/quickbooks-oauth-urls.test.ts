import { afterEach, describe, expect, it } from "vitest";
import { createQuickBooksState, quickbooksAuthorizeHref } from "@/lib/quickbooks/oauth";
import {
  PRODUCTION_QUICKBOOKS_APP_URL,
  PRODUCTION_QUICKBOOKS_CALLBACK_URI,
  assertQuickBooksRedirectUriSafe,
  isLoopbackUrl,
  quickbooksBrowserRedirect,
  quickbooksPostOAuthPath,
  quickbooksRedirectUri,
  resolveQuickBooksPublicOrigin,
} from "@/lib/quickbooks/public-url";
import { canAutoSyncInvoice, isEligibleForBulkSync } from "@/lib/quickbooks/sync";

const PRODUCTION_APP = PRODUCTION_QUICKBOOKS_APP_URL;
const KEYS = ["APP_URL", "QUICKBOOKS_REDIRECT_URI", "RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL"] as const;
const previous: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of KEYS) previous[key] = process.env[key];
}

function restoreEnv() {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function withEnv(base: NodeJS.ProcessEnv, overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
  }
  return env;
}

function productionEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return withEnv({ ...process.env, NODE_ENV: "production" }, overrides);
}

function developmentEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return withEnv({ ...process.env, NODE_ENV: "development" }, overrides);
}

function authorizeRedirectUri(env: NodeJS.ProcessEnv) {
  if (env.APP_URL) process.env.APP_URL = env.APP_URL;
  else delete process.env.APP_URL;
  if (env.QUICKBOOKS_REDIRECT_URI) process.env.QUICKBOOKS_REDIRECT_URI = env.QUICKBOOKS_REDIRECT_URI;
  else delete process.env.QUICKBOOKS_REDIRECT_URI;
  const href = quickbooksAuthorizeHref("state-csrf-test", {
    clientId: "cid-public",
    clientSecret: "unused-in-url",
    environment: "sandbox",
    source: "company",
  });
  return new URL(href).searchParams.get("redirect_uri");
}

describe("QuickBooks OAuth production URLs", () => {
  snapshotEnv();
  afterEach(restoreEnv);

  it("production start generates the exact Railway callback URL", () => {
    const env = productionEnv({
      APP_URL: PRODUCTION_APP,
      QUICKBOOKS_REDIRECT_URI: undefined,
    });
    expect(quickbooksRedirectUri(undefined, env)).toBe(PRODUCTION_QUICKBOOKS_CALLBACK_URI);
    expect(authorizeRedirectUri(env)).toBe(PRODUCTION_QUICKBOOKS_CALLBACK_URI);
  });

  it("production OAuth never generates or redirects to localhost", () => {
    const env = productionEnv({
      APP_URL: undefined,
      QUICKBOOKS_REDIRECT_URI: undefined,
      RAILWAY_PUBLIC_DOMAIN: undefined,
    });
    const loopbackRequest = new Request("http://localhost:43123/api/integrations/quickbooks/callback?code=x");
    const redirectUri = quickbooksRedirectUri(loopbackRequest, env);
    const afterAuth = quickbooksBrowserRedirect("/settings/quickbooks/setup", loopbackRequest, env);
    const failed = quickbooksBrowserRedirect(
      quickbooksPostOAuthPath({ error: "QuickBooks authorization failed." }),
      loopbackRequest,
      env
    );
    expect(redirectUri).toBe(PRODUCTION_QUICKBOOKS_CALLBACK_URI);
    expect(afterAuth.toString()).toBe(`${PRODUCTION_APP}/settings/quickbooks/setup`);
    expect(failed.toString()).toBe(`${PRODUCTION_APP}/settings/quickbooks?error=QuickBooks%20authorization%20failed.`);
    expect(isLoopbackUrl(redirectUri)).toBe(false);
    expect(isLoopbackUrl(afterAuth.toString())).toBe(false);
    expect(isLoopbackUrl(failed.toString())).toBe(false);
    expect(
      assertQuickBooksRedirectUriSafe("http://127.0.0.1:43123/api/integrations/quickbooks/callback", env).ok
    ).toBe(false);
  });

  it("successful sandbox OAuth callback returns to the production setup or manage flow", () => {
    const env = productionEnv({ APP_URL: PRODUCTION_APP });
    const firstConnect = quickbooksBrowserRedirect(
      quickbooksPostOAuthPath({ connected: true, wizardCompleted: false }),
      undefined,
      env
    );
    const returning = quickbooksBrowserRedirect(
      quickbooksPostOAuthPath({ connected: true, wizardCompleted: true }),
      undefined,
      env
    );
    expect(firstConnect.toString()).toBe(`${PRODUCTION_APP}/settings/quickbooks/setup`);
    expect(returning.toString()).toBe(`${PRODUCTION_APP}/settings/quickbooks/manage`);
  });

  it("failed OAuth returns to a safe production ContractorYou error state", () => {
    const env = productionEnv({ APP_URL: PRODUCTION_APP });
    const expired = quickbooksBrowserRedirect(
      quickbooksPostOAuthPath({ error: "Authorization expired. Start again." }),
      undefined,
      env
    );
    expect(expired.origin).toBe(PRODUCTION_APP);
    expect(expired.pathname).toBe("/settings/quickbooks");
    expect(expired.searchParams.get("error")).toBe("Authorization expired. Start again.");
    expect(expired.toString()).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("local development can still use localhost when intentionally configured", () => {
    const env = developmentEnv({
      APP_URL: "http://127.0.0.1:43123",
      QUICKBOOKS_REDIRECT_URI: undefined,
    });
    expect(quickbooksRedirectUri(undefined, env)).toBe("http://127.0.0.1:43123/api/integrations/quickbooks/callback");
    expect(quickbooksBrowserRedirect("/settings/quickbooks/setup", undefined, env).toString()).toBe(
      "http://127.0.0.1:43123/settings/quickbooks/setup"
    );
  });

  it("ignores a localhost APP_URL in production and still uses the live site", () => {
    const env = productionEnv({
      APP_URL: "http://localhost:3000",
      QUICKBOOKS_REDIRECT_URI: undefined,
    });
    expect(resolveQuickBooksPublicOrigin(undefined, env).origin).toBe(PRODUCTION_APP);
    expect(quickbooksRedirectUri(undefined, env)).toBe(PRODUCTION_QUICKBOOKS_CALLBACK_URI);
  });

  it("keeps company-scoped OAuth state and CSRF nonce generation", () => {
    const first = createQuickBooksState();
    const second = createQuickBooksState();
    expect(first).toMatch(/^[a-f0-9]{48}$/);
    expect(second).toMatch(/^[a-f0-9]{48}$/);
    expect(first).not.toBe(second);
  });

  it("keeps QuickBooks safe-mode protections", () => {
    expect(isEligibleForBulkSync({ importMode: "LIVE", recordDate: new Date(), syncActivated: false }).allowed).toBe(
      false
    );
    expect(
      canAutoSyncInvoice({ trigger: "WHEN_CREATED", event: "created", importMode: "HISTORICAL" }).allowed
    ).toBe(false);
  });
});
