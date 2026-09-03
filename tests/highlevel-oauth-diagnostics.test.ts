import { afterEach, describe, expect, it, vi } from "vitest";
import { HIGHLEVEL_API_BASE, HIGHLEVEL_OAUTH_EXCLUDED_SCOPES, HIGHLEVEL_SCOPES } from "@/lib/highlevel/config";
import { highlevelRedirectUri, highlevelRequestedScopes } from "@/lib/highlevel/env";
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
  const previousScopes = process.env.HIGHLEVEL_SCOPES;

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
    if (previousScopes === undefined) delete process.env.HIGHLEVEL_SCOPES;
    else process.env.HIGHLEVEL_SCOPES = previousScopes;
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

  it("requests only documented Sub-Account scopes and never logs secrets with those names", () => {
    delete process.env.HIGHLEVEL_SCOPES;
    const documentedSubAccountScopes = new Set([
      "locations.readonly",
      "contacts.readonly",
      "contacts.write",
      "conversations.readonly",
      "conversations.write",
      "conversations/message.readonly",
      "conversations/message.write",
      "opportunities.readonly",
      "calendars.readonly",
      "workflows.readonly",
      "phonenumbers.read",
      "socialplanner/account.readonly",
      "socialplanner/post.readonly",
      "socialplanner/post.write",
    ]);
    expect([...HIGHLEVEL_OAUTH_EXCLUDED_SCOPES]).toEqual([
      "locations.write",
      "phonenumbers.write",
      "numberpools.read",
      "socialplanner/account.write",
    ]);
    expect([...HIGHLEVEL_SCOPES]).toEqual([
      "locations.readonly",
      "contacts.readonly",
      "contacts.write",
      "conversations.readonly",
      "conversations.write",
      "conversations/message.readonly",
      "conversations/message.write",
      "opportunities.readonly",
      "calendars.readonly",
      "workflows.readonly",
      "phonenumbers.read",
      "socialplanner/account.readonly",
      "socialplanner/post.readonly",
      "socialplanner/post.write",
    ]);
    for (const scope of HIGHLEVEL_SCOPES) {
      expect(documentedSubAccountScopes.has(scope)).toBe(true);
    }
    const requested = highlevelRequestedScopes();
    expect(requested).toEqual([...HIGHLEVEL_SCOPES]);
    for (const excluded of HIGHLEVEL_OAUTH_EXCLUDED_SCOPES) {
      expect(requested).not.toContain(excluded);
    }

    process.env.APP_URL = PRODUCTION_ORIGIN;
    delete process.env.HIGHLEVEL_REDIRECT_URI;
    process.env.HIGHLEVEL_CLIENT_ID = "6a978663f3f02a98d9623d0f-mtkpsg5u";
    const authorize = highlevelAuthorizeUrl("state-fixture-not-logged");
    const params = new URL(authorize).searchParams;
    expect(params.get("redirect_uri")).toBe(PRODUCTION_OAUTH_CALLBACK_URI);
    expect(params.get("scope")?.split(" ")).toEqual(requested);
    expect(params.get("scope")).not.toContain("locations.write");
    expect(params.get("scope")).not.toContain("phonenumbers.write");
    expect(params.get("scope")).not.toContain("numberpools.read");
    expect(params.get("scope")).not.toContain("socialplanner/account.write");
    expect(params.get("scope")).toContain("phonenumbers.read");
    expect(params.get("scope")).toContain("socialplanner/account.readonly");
    expect(params.get("scope")).toContain("socialplanner/post.readonly");
    expect(params.get("scope")).toContain("socialplanner/post.write");

    process.env.HIGHLEVEL_SCOPES =
      "locations.readonly locations.write phonenumbers.write phonenumbers.read numberpools.read socialplanner/account.write socialplanner/account.readonly";
    expect(highlevelRequestedScopes()).toEqual([
      "locations.readonly",
      "phonenumbers.read",
      "socialplanner/account.readonly",
    ]);

    const leaked = sanitizeOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.START,
      route: "/api/integrations/highlevel/start",
      requestedScopes: highlevelRequestedScopes(),
    });
    expect(leaked.requestedScopes).toEqual([
      "locations.readonly",
      "phonenumbers.read",
      "socialplanner/account.readonly",
    ]);
    expect(JSON.stringify(leaked)).not.toMatch(/access_token|refresh_token|client_secret|"state":|"code":/i);
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
