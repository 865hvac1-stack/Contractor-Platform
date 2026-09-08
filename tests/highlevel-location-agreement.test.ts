import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agreeHighLevelLocation,
  HIGHLEVEL_LOCATION_MISMATCH_REASON,
} from "@/lib/highlevel/location-agreement";

function fakeLocationJwt(locationId: string) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ oauthMeta: { userType: "Location", locationId } })
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("HighLevel location agreement", () => {
  it("requires a mapped ContractorYou location", () => {
    const result = agreeHighLevelLocation({ mappedLocationId: "", accessToken: "opaque" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not mapped/);
  });

  it("accepts a mapped location when the token has no location claim", () => {
    const result = agreeHighLevelLocation({
      mappedLocationId: "Ssm2VhAUviopPNmEpNK1",
      accessToken: "opaque-access-token",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.locationId).toBe("Ssm2VhAUviopPNmEpNK1");
  });

  it("rejects a token bound to a different HighLevel location", () => {
    const result = agreeHighLevelLocation({
      mappedLocationId: "Ssm2VhAUviopPNmEpNK1",
      storedTokenLocationId: "qPjPtcAUzdkBtYTJUUWB",
      accessToken: fakeLocationJwt("qPjPtcAUzdkBtYTJUUWB"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(HIGHLEVEL_LOCATION_MISMATCH_REASON);
      expect(result.tokenLocationId).toBe("qPjPtcAUzdkBtYTJUUWB");
      expect(result.mappedLocationId).toBe("Ssm2VhAUviopPNmEpNK1");
    }
  });

  it("accepts when company mapping and token location agree", () => {
    const result = agreeHighLevelLocation({
      mappedLocationId: "Ssm2VhAUviopPNmEpNK1",
      storedTokenLocationId: "Ssm2VhAUviopPNmEpNK1",
      accessToken: fakeLocationJwt("Ssm2VhAUviopPNmEpNK1"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.locationId).toBe("Ssm2VhAUviopPNmEpNK1");
  });

  it("is used by the canonical resolver before location-level API calls", () => {
    const connection = readFileSync(resolve("src/lib/highlevel/connection.ts"), "utf8");
    expect(connection).toContain("agreeHighLevelLocation");
    expect(connection).toContain("HIGHLEVEL_LOCATION_MISMATCH_REASON");
    expect(connection).toContain("needsReauthorization");
    expect(connection).not.toContain("Ssm2VhAUviopPNmEpNK1");
  });
});
