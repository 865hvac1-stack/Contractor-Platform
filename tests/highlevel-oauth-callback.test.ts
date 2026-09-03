import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { highlevelAuthorizeUrl } from "@/lib/highlevel/oauth";
import * as highlevelOAuth from "@/lib/highlevel/oauth";
import {
  highlevelMarketplaceVersionId,
  highlevelRedirectUri,
  highlevelWebhookUrl,
  isHighLevelAppOrVersionId,
  isHighLevelClientKey,
} from "@/lib/highlevel/env";
import { MARKETPLACE_OAUTH_CALLBACK_PATH, oauthCallbackUrl } from "@/lib/integrations/env";
import { handleHighLevelMarketplaceCallback } from "@/lib/highlevel/oauth-callback";
import { GET as marketplaceOAuthCallback } from "@/app/api/integrations/oauth/callback/route";
import { HighLevelOAuthExchangeError } from "@/lib/highlevel/oauth";
import { HIGHLEVEL_OAUTH_MARKERS } from "@/lib/highlevel/oauth-diagnostics";
import { consumeOAuthState, consumeOAuthStateDetailed, createOAuthState } from "@/lib/integrations/oauth/state";
import { decryptProviderTokens } from "@/lib/integrations/crypto";
import * as highlevelConnection from "@/lib/highlevel/connection";
import { upsertConnection, saveConnectionTokens } from "@/lib/integrations/store";

const prisma = new PrismaClient();
const PRODUCTION_ORIGIN = "https://contractor-platform-production-c444.up.railway.app";

describe("HighLevel Marketplace OAuth redirect URI", () => {
  const previousAppUrl = process.env.APP_URL;
  const previousRedirect = process.env.HIGHLEVEL_REDIRECT_URI;
  const previousClientId = process.env.HIGHLEVEL_CLIENT_ID;
  const previousVersionId = process.env.HIGHLEVEL_VERSION_ID;

  afterEach(() => {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    if (previousRedirect === undefined) delete process.env.HIGHLEVEL_REDIRECT_URI;
    else process.env.HIGHLEVEL_REDIRECT_URI = previousRedirect;
    if (previousClientId === undefined) delete process.env.HIGHLEVEL_CLIENT_ID;
    else process.env.HIGHLEVEL_CLIENT_ID = previousClientId;
    if (previousVersionId === undefined) delete process.env.HIGHLEVEL_VERSION_ID;
    else process.env.HIGHLEVEL_VERSION_ID = previousVersionId;
  });

  it("uses the neutral Marketplace callback path, not a HighLevel-named path", () => {
    process.env.APP_URL = PRODUCTION_ORIGIN;
    delete process.env.HIGHLEVEL_REDIRECT_URI;
    process.env.HIGHLEVEL_CLIENT_ID = "marketplace-client";
    expect(MARKETPLACE_OAUTH_CALLBACK_PATH).toBe("/api/integrations/oauth/callback");
    expect(highlevelRedirectUri()).toBe(`${PRODUCTION_ORIGIN}/api/integrations/oauth/callback`);
    expect(oauthCallbackUrl("highlevel")).toBe(`${PRODUCTION_ORIGIN}/api/integrations/oauth/callback`);
    expect(highlevelRedirectUri().toLowerCase()).not.toContain("highlevel");
    const authorize = highlevelAuthorizeUrl("state-fixture");
    expect(authorize).toContain(encodeURIComponent(`${PRODUCTION_ORIGIN}/api/integrations/oauth/callback`));
    expect(authorize).not.toContain("/api/integrations/highlevel/callback");
    expect(highlevelWebhookUrl()).toBe(`${PRODUCTION_ORIGIN}/api/webhooks/highlevel`);
  });

  it("ignores a HIGHLEVEL_REDIRECT_URI that still contains highlevel", () => {
    process.env.APP_URL = PRODUCTION_ORIGIN;
    process.env.HIGHLEVEL_REDIRECT_URI = `${PRODUCTION_ORIGIN}/api/integrations/highlevel/callback`;
    expect(highlevelRedirectUri()).toBe(`${PRODUCTION_ORIGIN}/api/integrations/oauth/callback`);
  });

  it("treats a 24-hex Marketplace App/Version ID as invalid client_id", () => {
    expect(isHighLevelAppOrVersionId("6a978663f3f02a98d9623d0f")).toBe(true);
    expect(isHighLevelClientKey("6a978663f3f02a98d9623d0f")).toBe(false);
    expect(isHighLevelClientKey("6a978663f3f02a98d9623d0f-ab12cd")).toBe(true);
    expect(isHighLevelAppOrVersionId("6a978663f3f02a98d9623d0f-ab12cd")).toBe(false);
  });

  it("sends the Client Key as client_id and the app/version prefix as version_id", () => {
    process.env.APP_URL = PRODUCTION_ORIGIN;
    delete process.env.HIGHLEVEL_REDIRECT_URI;
    delete process.env.HIGHLEVEL_VERSION_ID;
    process.env.HIGHLEVEL_CLIENT_ID = "6a978663f3f02a98d9623d0f-ab12cd";
    expect(highlevelMarketplaceVersionId()).toBe("6a978663f3f02a98d9623d0f");
    const authorize = highlevelAuthorizeUrl("state-fixture");
    expect(authorize).toContain("client_id=6a978663f3f02a98d9623d0f-ab12cd");
    expect(authorize).toContain("version_id=6a978663f3f02a98d9623d0f");
    expect(authorize.startsWith("https://marketplace.gohighlevel.com/oauth/chooselocation?")).toBe(true);
  });
});

describe("HighLevel Marketplace OAuth callback", () => {
  const ids = { company: "", other: "", user: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const company = await prisma.company.create({
      data: { businessName: `OAuth Tenant ${stamp}`, status: "ACTIVE", isDemo: false },
    });
    const other = await prisma.company.create({
      data: { businessName: `OAuth Other ${stamp}`, status: "ACTIVE", isDemo: false },
    });
    const user = await prisma.user.create({
      data: {
        email: `oauth-cb-${stamp}@test.local`,
        passwordHash: await bcrypt.hash("TestPassword-123!", 10),
        firstName: "OAuth",
        lastName: "Callback",
      },
    });
    ids.company = company.id;
    ids.other = other.id;
    ids.user = user.id;
  });

  afterAll(async () => {
    for (const id of [ids.company, ids.other]) {
      if (id) await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    if (ids.user) await prisma.user.delete({ where: { id: ids.user } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function stateFor(companyId: string) {
    return createOAuthState({
      companyId,
      userId: ids.user,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      redirectTo: "/settings/highlevel",
    });
  }

  function callbackRequest(query: string) {
    return new Request(`https://contractor-platform-production-c444.up.railway.app/api/integrations/oauth/callback?${query}`);
  }

  function diagnosticRows(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls
      .map((call: unknown[]) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((row): row is Record<string, unknown> => Boolean(row && row.event === "highlevel.oauth.diagnostic"));
  }

  function mockVerifiedLocation(locationId: string, name = "865 HVAC") {
    return vi.spyOn(highlevelConnection, "probeHighLevelLocation").mockResolvedValue({
      ok: true,
      location: { id: locationId, name },
      locationId,
    });
  }

  it("rejects missing HighLevel-install state without treating it as a silent connect", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const missing = await marketplaceOAuthCallback(callbackRequest("code=auth-code"));
    expect(missing.status).toBeGreaterThanOrEqual(300);
    const missingText = decodeURIComponent((missing.headers.get("location") || "").replaceAll("+", " "));
    expect(missingText).toContain("Marketplace install link cannot create ContractorYou authorization state");
    expect(missingText).not.toContain("connected=1");
    const unknown = await handleHighLevelMarketplaceCallback(callbackRequest("code=auth-code&state=not-a-real-state"));
    expect(decodeURIComponent((unknown.headers.get("location") || "").replaceAll("+", " "))).toContain(
      "Marketplace install link cannot create ContractorYou authorization state"
    );
    const markers = diagnosticRows(info).map((row) => row.marker);
    expect(markers).toContain(HIGHLEVEL_OAUTH_MARKERS.CALLBACK_RECEIVED);
    expect(markers).toContain(HIGHLEVEL_OAUTH_MARKERS.STATE_INVALID);
    const serialized = JSON.stringify(diagnosticRows(info));
    expect(serialized).not.toContain("auth-code");
    expect(serialized).not.toContain("not-a-real-state");
    expect(serialized).toContain('"hasCode":true');
    expect(serialized).toContain('"hasState":true');
  });

  it("rejects expired and mismatched state and refuses reuse", async () => {
    const expired = await prisma.oAuthState.create({
      data: {
        companyId: ids.company,
        userId: ids.user,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
        state: `expired-${Date.now()}`,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expiredCb = await handleHighLevelMarketplaceCallback(
      callbackRequest(`code=auth-code&state=${expired.state}`)
    );
    expect(expiredCb.headers.get("location") || "").toContain("Authorization+expired");
    const expiredAgain = await prisma.oAuthState.create({
      data: {
        companyId: ids.company,
        userId: ids.user,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
        state: `expired-detail-${Date.now()}`,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expiredResult = await consumeOAuthStateDetailed(expiredAgain.state, HIGHLEVEL_PROVIDER_KEY);
    expect(expiredResult.ok).toBe(false);
    if (!expiredResult.ok) expect(expiredResult.reason).toBe("OAUTH_STATE_EXPIRED");

    const mismatch = await createOAuthState({
      companyId: ids.company,
      userId: ids.user,
      providerKey: "google_ads",
    });
    const mismatchResult = await consumeOAuthStateDetailed(mismatch.state, HIGHLEVEL_PROVIDER_KEY);
    expect(mismatchResult.ok).toBe(false);
    if (!mismatchResult.ok) expect(mismatchResult.reason).toBe("OAUTH_STATE_MISMATCH");

    const once = await createOAuthState({
      companyId: ids.company,
      userId: ids.user,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
    });
    expect((await consumeOAuthState(once.state))?.companyId).toBe(ids.company);
    expect(await consumeOAuthState(once.state)).toBeNull();
  });

  it("rejects a missing authorization code", async () => {
    const row = await stateFor(ids.company);
    const response = await handleHighLevelMarketplaceCallback(callbackRequest(`state=${row.state}`));
    expect(response.headers.get("location") || "").toContain("Authorization+code+missing");
  });

  it("rejects a missing locationId", async () => {
    const row = await stateFor(ids.company);
    vi.spyOn(highlevelOAuth, "exchangeHighLevelCode").mockResolvedValue({
      tokens: {
        accessToken: "access-should-not-persist",
        refreshToken: "refresh-should-not-persist",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: ["locations.readonly"],
      },
      locationId: null,
      agencyId: null,
      userType: "Location",
    });
    const response = await handleHighLevelMarketplaceCallback(callbackRequest(`code=valid-code&state=${row.state}`));
    expect(response.headers.get("location") || "").toContain("location+id");
    const connection = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.company, providerKey: HIGHLEVEL_PROVIDER_KEY },
    });
    expect(connection?.status === "CONNECTED" ? connection.externalAccountId : null).toBeNull();
  });

  it("completes a valid authorization, stores encrypted tokens, and links the company", async () => {
    const row = await stateFor(ids.company);
    const locationId = `loc_oauth_${Date.now()}`;
    const accessToken = `access-token-${Date.now()}`;
    const refreshToken = `refresh-token-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    vi.spyOn(highlevelOAuth, "exchangeHighLevelCode").mockResolvedValue({
      tokens: { accessToken, refreshToken, expiresAt, scopes: ["locations.readonly"] },
      locationId,
      agencyId: "agency_1",
      userType: "Location",
    });
    mockVerifiedLocation(locationId);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await handleHighLevelMarketplaceCallback(callbackRequest(`code=valid-code&state=${row.state}`));
    expect(response.headers.get("location") || "").toContain("connected=1");
    const markers = diagnosticRows(info).map((row) => row.marker);
    expect(markers).toEqual([
      HIGHLEVEL_OAUTH_MARKERS.CALLBACK_RECEIVED,
      HIGHLEVEL_OAUTH_MARKERS.STATE_VALID,
      HIGHLEVEL_OAUTH_MARKERS.CODE_EXCHANGE_START,
      HIGHLEVEL_OAUTH_MARKERS.CODE_EXCHANGE_SUCCESS,
      HIGHLEVEL_OAUTH_MARKERS.LOCATION_RESOLVED,
      HIGHLEVEL_OAUTH_MARKERS.CONNECTION_SAVED,
    ]);
    const serialized = JSON.stringify(diagnosticRows(info));
    expect(serialized).toContain(ids.company);
    expect(serialized).toContain(locationId);
    expect(serialized).not.toContain("valid-code");
    expect(serialized).not.toContain(row.state);
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(refreshToken);
    const connection = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.company, providerKey: HIGHLEVEL_PROVIDER_KEY },
      include: { credentials: true },
    });
    expect(connection?.status).toBe("CONNECTED");
    expect(connection?.externalAccountId).toBe(locationId);
    expect(connection?.companyId).toBe(ids.company);
    expect(connection?.credentials).toBeTruthy();
    const ciphertext = Buffer.from(connection!.credentials!.ciphertext).toString("utf8");
    expect(ciphertext).not.toContain(accessToken);
    expect(ciphertext).not.toContain(refreshToken);
    const decrypted = decryptProviderTokens({
      ciphertext: Buffer.from(connection!.credentials!.ciphertext),
      iv: Buffer.from(connection!.credentials!.iv),
      authTag: Buffer.from(connection!.credentials!.authTag),
      keyVersion: connection!.credentials!.keyVersion,
    });
    expect(decrypted.accessToken).toBe(accessToken);
    expect(decrypted.refreshToken).toBe(refreshToken);
    expect(decrypted.expiresAt).toBe(expiresAt);
    expect(connection!.credentials!.tokenExpiresAt?.toISOString()).toBe(new Date(expiresAt).toISOString());
    const identity = await prisma.providerIdentityMap.findFirst({
      where: {
        companyId: ids.company,
        entityType: "COMPANY",
        externalId: locationId,
      },
    });
    expect(identity?.internalId).toBe(ids.company);
  });

  it("does not let a second company claim an already-linked location", async () => {
    const owner = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.company, providerKey: HIGHLEVEL_PROVIDER_KEY },
    });
    const locationId = owner?.externalAccountId ?? "";
    expect(locationId).toBeTruthy();
    const row = await stateFor(ids.other);
    vi.spyOn(highlevelOAuth, "exchangeHighLevelCode").mockResolvedValue({
      tokens: {
        accessToken: "other-access-must-not-store",
        refreshToken: "other-refresh-must-not-store",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: ["locations.readonly"],
      },
      locationId,
      agencyId: null,
      userType: "Location",
    });
    mockVerifiedLocation(locationId);
    const response = await handleHighLevelMarketplaceCallback(callbackRequest(`code=other-code&state=${row.state}`));
    expect(decodeURIComponent((response.headers.get("location") || "").replaceAll("+", " "))).toContain(
      "already linked"
    );
    const otherClaim = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.other, providerKey: HIGHLEVEL_PROVIDER_KEY, externalAccountId: locationId },
    });
    expect(otherClaim).toBeNull();
    const ownerAfter = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.company, providerKey: HIGHLEVEL_PROVIDER_KEY },
    });
    expect(ownerAfter?.externalAccountId).toBe(locationId);
    expect(ownerAfter?.status).toBe("CONNECTED");
  });

  it("upgrades a same-company PIT connection to Marketplace OAuth", async () => {
    const locationId = `loc_pit_upgrade_${Date.now()}`;
    const connection = await upsertConnection({
      companyId: ids.company,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      accountLabel: "865 HVAC",
      externalAccountId: locationId,
      scopes: ["private_token"],
      healthMessage: "Connected with a location Private Integration Token (testing / single-location).",
    });
    await saveConnectionTokens({
      companyId: ids.company,
      connectionId: connection.id,
      tokens: { accessToken: "pit-placeholder", scopes: ["private_token"] },
    });
    const row = await stateFor(ids.company);
    const accessToken = `oauth-upgrade-${Date.now()}`;
    vi.spyOn(highlevelOAuth, "exchangeHighLevelCode").mockResolvedValue({
      tokens: {
        accessToken,
        refreshToken: "oauth-refresh",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: ["locations.readonly"],
      },
      locationId,
      agencyId: null,
      userType: "Location",
    });
    mockVerifiedLocation(locationId, "865 HVAC");
    const response = await handleHighLevelMarketplaceCallback(callbackRequest(`code=upgrade-code&state=${row.state}`));
    expect(response.headers.get("location") || "").toContain("connected=1");
    const after = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.company, providerKey: HIGHLEVEL_PROVIDER_KEY },
      include: { credentials: true },
    });
    expect(after?.id).toBe(connection.id);
    expect(after?.externalAccountId).toBe(locationId);
    expect(after?.status).toBe("CONNECTED");
    expect(after?.scopes).toContain("locations.readonly");
    expect(after?.scopes).not.toContain("private_token");
    const decrypted = decryptProviderTokens({
      ciphertext: Buffer.from(after!.credentials!.ciphertext),
      iv: Buffer.from(after!.credentials!.iv),
      authTag: Buffer.from(after!.credentials!.authTag),
      keyVersion: after!.credentials!.keyVersion,
    });
    expect(decrypted.accessToken).toBe(accessToken);
    expect(Buffer.from(after!.credentials!.ciphertext).toString("utf8")).not.toContain(accessToken);
  });

  it("does not mark CONNECTED when the location probe fails", async () => {
    const row = await stateFor(ids.company);
    const locationId = `loc_unverified_${Date.now()}`;
    vi.spyOn(highlevelOAuth, "exchangeHighLevelCode").mockResolvedValue({
      tokens: {
        accessToken: "unverified-access",
        refreshToken: "unverified-refresh",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: ["locations.readonly"],
      },
      locationId,
      agencyId: null,
      userType: "Location",
    });
    vi.spyOn(highlevelConnection, "probeHighLevelLocation").mockResolvedValue({
      ok: false,
      error: "HighLevel location probe failed.",
    });
    const response = await handleHighLevelMarketplaceCallback(callbackRequest(`code=unverified&state=${row.state}`));
    expect(response.headers.get("location") || "").toContain("could+not+be+verified");
    const connection = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.company, providerKey: HIGHLEVEL_PROVIDER_KEY, externalAccountId: locationId },
    });
    expect(connection?.status).not.toBe("CONNECTED");
  });

  it("logs CODE_EXCHANGE_FAILED with HTTP status and no authorization code", async () => {
    const row = await stateFor(ids.company);
    vi.spyOn(highlevelOAuth, "exchangeHighLevelCode").mockRejectedValue(
      new HighLevelOAuthExchangeError("HighLevel did not return an access token.", 400)
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await handleHighLevelMarketplaceCallback(
      callbackRequest(`code=failed-exchange-code&state=${row.state}`)
    );
    expect(response.headers.get("location") || "").toContain("authorization+failed");
    const failed = diagnosticRows(info).find((row) => row.marker === HIGHLEVEL_OAUTH_MARKERS.CODE_EXCHANGE_FAILED);
    expect(failed?.httpStatus).toBe(400);
    expect(failed?.errorClass).toBe("HighLevelOAuthExchangeError");
    expect(failed?.companyId).toBe(ids.company);
    expect(JSON.stringify(diagnosticRows(info))).not.toContain("failed-exchange-code");
    expect(JSON.stringify(diagnosticRows(info))).not.toContain(row.state);
  });
});
