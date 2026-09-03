import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as highlevelClient from "@/lib/highlevel/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import {
  assertHighLevelLocationToken,
  ensureHighLevelLocationAccess,
  inferHighLevelTokenKind,
} from "@/lib/highlevel/location-token";
import * as highlevelOAuth from "@/lib/highlevel/oauth";
import { inspectHighLevelTokenClaims } from "@/lib/highlevel/token-claims";
import { formatTokenTypeDiagnostic } from "@/lib/highlevel/token-type-diagnostic";
import { decryptProviderTokens } from "@/lib/integrations/crypto";
import * as store from "@/lib/integrations/store";

const prisma = new PrismaClient();

function jwtFor(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.testsig`;
}

const LOCATION_ID = "qPjPtcAUzdkBtYTJUUWB";

describe("HighLevel Company to Location token exchange", () => {
  const ids = { company: "", connection: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const company = await prisma.company.create({
      data: { businessName: `HL Token Type ${stamp}`, status: "ACTIVE", isDemo: false },
    });
    ids.company = company.id;
    const connection = await store.upsertConnection({
      companyId: company.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      accountLabel: "865 HVAC",
      externalAccountId: LOCATION_ID,
      scopes: ["contacts.readonly", "conversations.readonly", "conversations/message.write"],
    });
    ids.connection = connection.id;
  });

  afterAll(async () => {
    await prisma.integrationCredential.deleteMany({ where: { companyId: ids.company } });
    await prisma.integrationConnection.deleteMany({ where: { companyId: ids.company } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads Company and Location claims without exposing the token", () => {
    const companyToken = jwtFor({
      authClass: "Company",
      authClassId: "hl_company_865",
      oauthMeta: { userType: "Company", companyId: "hl_company_865" },
    });
    const locationToken = jwtFor({
      authClass: "Location",
      authClassId: LOCATION_ID,
      primaryAuthClassId: "hl_company_865",
      oauthMeta: { userType: "Location", locationId: LOCATION_ID },
    });
    expect(inspectHighLevelTokenClaims(companyToken)).toEqual({
      userType: "Company",
      locationId: null,
      companyId: "hl_company_865",
      locationIdPresent: false,
      companyIdPresent: true,
    });
    expect(inspectHighLevelTokenClaims(locationToken)).toEqual({
      userType: "Location",
      locationId: LOCATION_ID,
      companyId: "hl_company_865",
      locationIdPresent: true,
      companyIdPresent: true,
    });
    expect(inferHighLevelTokenKind({ accessToken: companyToken, userType: "Company" })).toBe("company");
    expect(inferHighLevelTokenKind({ accessToken: locationToken, userType: "Location" })).toBe("location");
    expect(JSON.stringify(inspectHighLevelTokenClaims(companyToken))).not.toContain(companyToken);
  });

  it("exchanges a Company token and stores the Location token only for this company", async () => {
    const companyToken = jwtFor({
      authClass: "Company",
      authClassId: "hl_company_865",
      oauthMeta: { userType: "Company", companyId: "hl_company_865" },
    });
    const locationToken = jwtFor({
      authClass: "Location",
      authClassId: LOCATION_ID,
      primaryAuthClassId: "hl_company_865",
      oauthMeta: { userType: "Location", locationId: LOCATION_ID },
    });
    await store.saveConnectionTokens({
      companyId: ids.company,
      connectionId: ids.connection,
      tokens: {
        accessToken: companyToken,
        refreshToken: "company-refresh",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        userType: "Company",
        highlevelCompanyId: "hl_company_865",
      },
    });
    vi.spyOn(highlevelClient, "inspectHighLevelInstalledLocationsForCompany").mockResolvedValue({
      ok: true,
      status: 200,
      keys: ["locations"],
      data: { locations: [{ id: LOCATION_ID }] },
      errorMessage: null,
    });
    const exchange = vi.spyOn(highlevelOAuth, "exchangeCompanyTokenForLocation").mockResolvedValue({
      ok: true,
      tokens: {
        accessToken: locationToken,
        refreshToken: "location-refresh",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        userType: "Location",
        locationId: LOCATION_ID,
      },
      httpStatus: 201,
      status: 201,
      error: null,
    });
    const ensured = await ensureHighLevelLocationAccess({
      prisma,
      companyId: ids.company,
      connectionId: ids.connection,
      locationId: LOCATION_ID,
      tokens: {
        accessToken: companyToken,
        refreshToken: "company-refresh",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        userType: "Company",
        highlevelCompanyId: "hl_company_865",
      },
    });
    expect(ensured.tokenType).toBe("location");
    expect(ensured.accessToken).toBe(locationToken);
    expect(ensured.installed).toBe(true);
    expect(ensured.locationTokenExchangeHttpStatus).toBe(201);
    expect(ensured.sanitizedError).toBeNull();
    expect(exchange).toHaveBeenCalledWith({
      companyAccessToken: companyToken,
      companyId: "hl_company_865",
      locationId: LOCATION_ID,
    });
    const access = await loadHighLevelAccess(prisma, ids.company);
    expect(access?.accessToken).toBe(locationToken);
    expect(access?.tokenType).toBe("location");
    const row = await prisma.integrationCredential.findFirst({ where: { connectionId: ids.connection } });
    const decrypted = decryptProviderTokens({
      ciphertext: Buffer.from(row!.ciphertext),
      iv: Buffer.from(row!.iv),
      authTag: Buffer.from(row!.authTag),
      keyVersion: row!.keyVersion,
    });
    expect(decrypted.accessToken).toBe(locationToken);
    expect(decrypted.agencyAccessToken).toBe(companyToken);
    expect(decrypted.highlevelCompanyId).toBe("hl_company_865");
    expect(decrypted.locationId).toBe(LOCATION_ID);
  });

  it("does not exchange when the stored token is already a Location token", async () => {
    const locationToken = jwtFor({
      authClass: "Location",
      authClassId: LOCATION_ID,
      oauthMeta: { userType: "Location", locationId: LOCATION_ID },
    });
    const exchange = vi.spyOn(highlevelOAuth, "exchangeCompanyTokenForLocation");
    const ensured = await ensureHighLevelLocationAccess({
      prisma,
      companyId: ids.company,
      connectionId: ids.connection,
      locationId: LOCATION_ID,
      tokens: {
        accessToken: locationToken,
        refreshToken: "location-refresh",
        userType: "Location",
        locationId: LOCATION_ID,
      },
    });
    expect(ensured.tokenType).toBe("location");
    expect(ensured.accessToken).toBe(locationToken);
    expect(ensured.locationTokenExchangeHttpStatus).toBeNull();
    expect(exchange).not.toHaveBeenCalled();
  });

  it("refreshes a Company token and re-exchanges the Location token", async () => {
    const companyToken = jwtFor({
      authClass: "Company",
      authClassId: "hl_company_865",
      oauthMeta: { userType: "Company", companyId: "hl_company_865" },
    });
    const refreshedCompany = jwtFor({
      authClass: "Company",
      authClassId: "hl_company_865",
      oauthMeta: { userType: "Company", companyId: "hl_company_865", n: 2 },
    });
    const locationToken = jwtFor({
      authClass: "Location",
      authClassId: LOCATION_ID,
      oauthMeta: { userType: "Location", locationId: LOCATION_ID, n: 2 },
    });
    const previousClientId = process.env.HIGHLEVEL_CLIENT_ID;
    const previousClientSecret = process.env.HIGHLEVEL_CLIENT_SECRET;
    process.env.HIGHLEVEL_CLIENT_ID = "6a978663f3f02a98d9623d0f-testkey";
    process.env.HIGHLEVEL_CLIENT_SECRET = "test-client-secret-value";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: refreshedCompany,
            refresh_token: "company-refresh-2",
            expires_in: 3600,
            userType: "Company",
            companyId: "hl_company_865",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/oauth/location-token") || url.includes("/oauth/locationToken")) {
        return new Response(
          JSON.stringify({
            access_token: locationToken,
            refresh_token: "location-refresh-2",
            expires_in: 3600,
            userType: "Location",
            locationId: LOCATION_ID,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch in token refresh test: ${url}`);
    });
    const refreshed = await highlevelOAuth.refreshHighLevelConnectionTokens({
      accessToken: companyToken,
      refreshToken: "company-refresh",
      userType: "Company",
      highlevelCompanyId: "hl_company_865",
      locationId: LOCATION_ID,
    });
    expect(refreshed.accessToken).toBe(locationToken);
    expect(refreshed.agencyAccessToken).toBe(refreshedCompany);
    expect(refreshed.userType).toBe("Location");
    if (previousClientId === undefined) delete process.env.HIGHLEVEL_CLIENT_ID;
    else process.env.HIGHLEVEL_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.HIGHLEVEL_CLIENT_SECRET;
    else process.env.HIGHLEVEL_CLIENT_SECRET = previousClientSecret;
  });

  it("refuses to use a Company token for Sub-Account APIs and keeps sanitized diagnostics token-free", () => {
    expect(() =>
      assertHighLevelLocationToken({
        accessToken: "company-token-must-not-appear",
        tokenType: "company",
        locationAccessError: "Location is not active",
      })
    ).toThrow(/Company token cannot be used|Location is not active/);
    const formatted = formatTokenTypeDiagnostic({
      tokenType: "company",
      requestedLocationId: LOCATION_ID,
      installed: true,
      locationTokenExchangeHttpStatus: 401,
      sanitizedError: "Location is not active",
      storedUserType: null,
      jwtUserType: "Company",
      oauthLocationIdPresent: false,
      storedLocationId: LOCATION_ID,
      companyIdPresent: true,
      approvedLocationsCount: null,
      isBulkInstallation: null,
      approveAllLocations: null,
      installToFutureLocations: null,
    });
    expect(formatted).toContain("tokenType: company");
    expect(formatted).toContain(`requested locationId: ${LOCATION_ID}`);
    expect(formatted).toContain("installed: true");
    expect(formatted).toContain("location-token exchange HTTP status: 401");
    expect(formatted).toContain("sanitized error: Location is not active");
    expect(formatted).not.toContain("eyJ");
    expect(formatted).not.toContain("Bearer");
  });
});
