import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatOauthInstallDiagnostic,
  resolveFreshHighLevelOauthLocation,
} from "@/lib/highlevel/oauth-location";
import { highlevelAuthorizeUrl, highlevelAuthorizeUrlHasLocationId } from "@/lib/highlevel/oauth";
import { HIGHLEVEL_OAUTH_MARKERS, sanitizeOAuthDiagnostic } from "@/lib/highlevel/oauth-diagnostics";
import { agreeHighLevelLocation } from "@/lib/highlevel/location-agreement";

const STALE = "loc_stale_mapped";
const FRESH = "loc_fresh_oauth";

function fakeLocationJwt(locationId: string) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ oauthMeta: { userType: "Location", locationId } })).toString(
    "base64url"
  );
  return `${header}.${payload}.sig`;
}

describe("fresh HighLevel OAuth location resolution", () => {
  it("uses the provider token location and never keeps a stale mapping", () => {
    const resolved = resolveFreshHighLevelOauthLocation({
      tokenUserType: "Location",
      tokenResponseLocationId: FRESH,
      jwtLocationId: FRESH,
      previousMappedLocationId: STALE,
    });
    expect(resolved.previousMappedLocationId).toBe(STALE);
    expect(resolved.tokenResponseLocationId).toBe(FRESH);
    expect(resolved.freshOauthLocationId).toBe(FRESH);
    expect(resolved.finalPersistedLocationId).toBe(FRESH);
    expect(resolved.locationSource).toBe("token_response");
    expect(resolved.staleMappingReused).toBe(false);
  });

  it("does not fall back to the previous mapping when HighLevel omits a location", () => {
    const resolved = resolveFreshHighLevelOauthLocation({
      tokenUserType: "Location",
      previousMappedLocationId: STALE,
    });
    expect(resolved.freshOauthLocationId).toBeNull();
    expect(resolved.finalPersistedLocationId).toBeNull();
    expect(resolved.previousMappedLocationId).toBe(STALE);
    expect(resolved.locationSource).toBe("none");
    expect(resolved.staleMappingReused).toBe(false);
  });

  it("uses the JWT location claim when the token body has no locationId", () => {
    const resolved = resolveFreshHighLevelOauthLocation({
      tokenUserType: "Location",
      jwtLocationId: FRESH,
      previousMappedLocationId: STALE,
    });
    expect(resolved.freshOauthLocationId).toBe(FRESH);
    expect(resolved.locationSource).toBe("jwt_claim");
    expect(resolved.staleMappingReused).toBe(false);
  });

  it("rejects a token bound to a different location than the company mapping", () => {
    const result = agreeHighLevelLocation({
      mappedLocationId: FRESH,
      storedTokenLocationId: STALE,
      accessToken: fakeLocationJwt(STALE),
    });
    expect(result.ok).toBe(false);
  });

  it("does not put a locationId on the Marketplace authorize URL", () => {
    const previousClientId = process.env.HIGHLEVEL_CLIENT_ID;
    process.env.HIGHLEVEL_CLIENT_ID = "6a978663f3f02a98d9623d0f-ab12cd";
    const authorize = highlevelAuthorizeUrl("state-fixture");
    expect(highlevelAuthorizeUrlHasLocationId(authorize)).toBe(false);
    expect(authorize).not.toContain("locationId=");
    expect(authorize).not.toContain(STALE);
    if (previousClientId === undefined) delete process.env.HIGHLEVEL_CLIENT_ID;
    else process.env.HIGHLEVEL_CLIENT_ID = previousClientId;
  });

  it("never writes secrets into OAuth location diagnostics", () => {
    const leaked = sanitizeOAuthDiagnostic({
      marker: HIGHLEVEL_OAUTH_MARKERS.LOCATION_RESOLVED,
      route: "/api/integrations/oauth/callback",
      companyId: "company_internal_1",
      tokenUserType: "Location",
      tokenResponseLocationId: FRESH,
      jwtLocationId: FRESH,
      previousMappedLocationId: STALE,
      freshOauthLocationId: FRESH,
      finalPersistedLocationId: FRESH,
      locationSource: "token_response",
      staleMappingReused: false,
      errorMessage: "Bearer supersecrettokenvalue1234567890 failed",
    });
    const serialized = JSON.stringify(leaked);
    const text = formatOauthInstallDiagnostic(leaked);
    expect(leaked.tokenResponseLocationId).toBe(FRESH);
    expect(leaked.previousMappedLocationId).toBe(STALE);
    expect(serialized).not.toContain("supersecrettokenvalue1234567890");
    expect(serialized).not.toMatch(/access_token|refresh_token|client_secret|"code":|"state":/i);
    expect(text).not.toContain("supersecrettokenvalue1234567890");
    for (const key of ["code", "state", "clientSecret", "accessToken", "refreshToken", "pit", "cookie"]) {
      expect(leaked).not.toHaveProperty(key);
    }
  });

  it("does not hardcode production HighLevel location ids in reusable integration logic", () => {
    const files = [
      "src/lib/highlevel/oauth-callback.ts",
      "src/lib/highlevel/oauth-location.ts",
      "src/lib/highlevel/oauth.ts",
      "src/app/api/integrations/highlevel/start/route.ts",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toContain("qPjPtcAUzdkBtYTJUUWB");
      expect(source).not.toContain("Ssm2VhAUviopPNmEpNK1");
    }
  });
});
