import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { highlevelAuthorizeUrl } from "@/lib/highlevel/oauth";
import * as highlevelOAuth from "@/lib/highlevel/oauth";
import { highlevelRedirectUri, highlevelWebhookUrl } from "@/lib/highlevel/env";
import { MARKETPLACE_OAUTH_CALLBACK_PATH, oauthCallbackUrl } from "@/lib/integrations/env";
import { handleHighLevelMarketplaceCallback } from "@/lib/highlevel/oauth-callback";
import { GET as marketplaceOAuthCallback } from "@/app/api/integrations/oauth/callback/route";
import { createOAuthState } from "@/lib/integrations/oauth/state";
import { decryptProviderTokens } from "@/lib/integrations/crypto";

const prisma = new PrismaClient();
const PRODUCTION_ORIGIN = "https://contractor-platform-production-c444.up.railway.app";

describe("HighLevel Marketplace OAuth redirect URI", () => {
  const previousAppUrl = process.env.APP_URL;
  const previousRedirect = process.env.HIGHLEVEL_REDIRECT_URI;
  const previousClientId = process.env.HIGHLEVEL_CLIENT_ID;

  afterEach(() => {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    if (previousRedirect === undefined) delete process.env.HIGHLEVEL_REDIRECT_URI;
    else process.env.HIGHLEVEL_REDIRECT_URI = previousRedirect;
    if (previousClientId === undefined) delete process.env.HIGHLEVEL_CLIENT_ID;
    else process.env.HIGHLEVEL_CLIENT_ID = previousClientId;
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

  it("rejects missing or invalid OAuth state", async () => {
    const missing = await marketplaceOAuthCallback(callbackRequest("code=auth-code"));
    expect(missing.status).toBeGreaterThanOrEqual(300);
    expect(missing.headers.get("location") || "").toContain("Authorization+expired");
    const unknown = await handleHighLevelMarketplaceCallback(callbackRequest("code=auth-code&state=not-a-real-state"));
    expect(unknown.headers.get("location") || "").toContain("Authorization+expired");
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
    const response = await handleHighLevelMarketplaceCallback(callbackRequest(`code=valid-code&state=${row.state}`));
    expect(response.headers.get("location") || "").toContain("connected=1");
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
});
