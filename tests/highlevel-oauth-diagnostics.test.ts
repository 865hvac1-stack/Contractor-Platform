import { afterEach, describe, expect, it, vi } from "vitest";
import { HIGHLEVEL_API_BASE } from "@/lib/highlevel/config";
import { highlevelRedirectUri } from "@/lib/highlevel/env";
import {
  exchangeHighLevelCode,
  highlevelAuthorizeUrl,
  highlevelOAuthRedirectUri,
  HighLevelOAuthExchangeError,
} from "@/lib/highlevel/oauth";
import {
  HIGHLEVEL_OAUTH_MARKERS,
  PRODUCTION_OAUTH_CALLBACK_URI,
  sanitizeOAuthDiagnostic,
  redirectUriMatchesProduction,
} from "@/lib/highlevel/oauth-diagnostics";

const PRODUCTION_ORIGIN = "https://contractor-platform-production-c444.up.railway.app";

describe("HighLevel OAuth production-safe diagnostics", () => {
  const previousAppUrl = process.env.APP_URL;
  const previousRedirect = process.env.HIGHLEVEL_REDIRECT_URI;
  const previousClientId = process.env.HIGHLEVEL_CLIENT_ID;
  const previousSecret = process.env.HIGHLEVEL_CLIENT_SECRET;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    if (previousRedirect === undefined) delete process.env.HIGHLEVEL_REDIRECT_URI;
    else process.env.HIGHLEVEL_REDIRECT_URI = previousRedirect;
    if (previousClientId === undefined) delete process.env.HIGHLEVEL_CLIENT_ID;
    else process.env.HIGHLEVEL_CLIENT_ID = previousClientId;
    if (previousSecret === undefined) delete process.env.HIGHLEVEL_CLIENT_SECRET;
    else process.env.HIGHLEVEL_CLIENT_SECRET = previousSecret;
  });

  it("uses the exact production Marketplace Redirect URL for authorize and token exchange", async () => {
    process.env.APP_URL = PRODUCTION_ORIGIN;
    delete process.env.HIGHLEVEL_REDIRECT_URI;
    process.env.HIGHLEVEL_CLIENT_ID = "6a978663f3f02a98d9623d0f-mtkpsg5u";
    process.env.HIGHLEVEL_CLIENT_SECRET = "unit-test-secret-not-for-production";

    expect(PRODUCTION_OAUTH_CALLBACK_URI).toBe(
      "https://contractor-platform-production-c444.up.railway.app/api/integrations/oauth/callback"
    );
    expect(highlevelOAuthRedirectUri()).toBe(PRODUCTION_OAUTH_CALLBACK_URI);
    expect(highlevelRedirectUri()).toBe(PRODUCTION_OAUTH_CALLBACK_URI);
    expect(redirectUriMatchesProduction(highlevelOAuthRedirectUri())).toBe(true);

    const authorize = highlevelAuthorizeUrl("state-fixture-not-logged");
    expect(authorize).toContain(`redirect_uri=${encodeURIComponent(PRODUCTION_OAUTH_CALLBACK_URI)}`);
    expect(authorize).not.toContain("/api/integrations/highlevel/callback");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "access-must-not-be-logged", locationId: "loc_diag" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const exchanged = await exchangeHighLevelCode("authorization-code-must-not-be-logged");
    expect(exchanged.httpStatus).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${HIGHLEVEL_API_BASE}/oauth/token`);
    const rawBody = fetchMock.mock.calls[0][1].body;
    const body = rawBody instanceof URLSearchParams ? rawBody : new URLSearchParams(String(rawBody));
    expect(body.get("redirect_uri")).toBe(PRODUCTION_OAUTH_CALLBACK_URI);
    expect(body.get("redirect_uri")).toBe(highlevelOAuthRedirectUri());
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("never writes secrets into diagnostic payloads", () => {
    const leaked = sanitizeOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.CODE_EXCHANGE_FAILED,
      route: "/api/integrations/oauth/callback",
      companyId: "company_internal_1",
      httpStatus: 401,
      hasCode: true,
      hasState: true,
      locationId: "loc_public",
      errorClass: "HighLevelOAuthExchangeError",
      errorMessage: "Bearer supersecrettokenvalue1234567890 failed for user@example.com",
    });
    const serialized = JSON.stringify(leaked);
    expect(leaked.marker).toBe("HIGHLEVEL_OAUTH_CODE_EXCHANGE_FAILED");
    expect(leaked.companyId).toBe("company_internal_1");
    expect(leaked.hasCode).toBe(true);
    expect(leaked.hasState).toBe(true);
    expect(leaked.locationId).toBe("loc_public");
    expect(serialized).not.toContain("supersecrettokenvalue1234567890");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toMatch(/"code":/);
    expect(serialized).not.toMatch(/access_token|refresh_token|client_secret|authorization code/i);
    for (const key of ["code", "state", "clientSecret", "accessToken", "refreshToken", "pit", "cookie"]) {
      expect(leaked).not.toHaveProperty(key);
    }
  });

  it("surfaces HighLevel token HTTP status without returning token material in the error", async () => {
    process.env.APP_URL = PRODUCTION_ORIGIN;
    delete process.env.HIGHLEVEL_REDIRECT_URI;
    process.env.HIGHLEVEL_CLIENT_ID = "6a978663f3f02a98d9623d0f-mtkpsg5u";
    process.env.HIGHLEVEL_CLIENT_SECRET = "unit-test-secret-not-for-production";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ access_token: "should-not-surface", message: "invalid_grant" }),
      })
    );
    await expect(exchangeHighLevelCode("bad-code-must-not-be-logged")).rejects.toMatchObject({
      name: "HighLevelOAuthExchangeError",
      httpStatus: 400,
      message: "HighLevel did not return an access token.",
    } satisfies Partial<HighLevelOAuthExchangeError>);
  });
});
