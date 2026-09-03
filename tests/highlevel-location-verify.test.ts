import { afterEach, describe, expect, it, vi } from "vitest";
import { HIGHLEVEL_API_BASE, HIGHLEVEL_LOCATION_API_VERSION, HIGHLEVEL_LOCATION_GET_ENDPOINT } from "@/lib/highlevel/config";
import { probeHighLevelLocation } from "@/lib/highlevel/connection";
import { highlevelCapabilities } from "@/lib/highlevel/capabilities";
import { HIGHLEVEL_OAUTH_MARKERS } from "@/lib/highlevel/oauth-diagnostics";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
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
    .filter((row): row is Record<string, unknown> => Boolean(row && String(row.event || "").startsWith("highlevel.oauth")));
}

describe("HighLevel location verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses GET /locations/:locationId with Version v3 and does not require isActive", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { location: { id: "qPjPtcAUzdkBtYTJUUWB", name: "865 HVAC" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const probe = await probeHighLevelLocation("access-must-not-be-logged", "qPjPtcAUzdkBtYTJUUWB");
    expect(probe.ok).toBe(true);
    if (probe.ok) expect(probe.location.id).toBe("qPjPtcAUzdkBtYTJUUWB");
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${HIGHLEVEL_API_BASE}/locations/qPjPtcAUzdkBtYTJUUWB`);
    expect(fetchMock.mock.calls[0][1].headers.Version).toBe(HIGHLEVEL_LOCATION_API_VERSION);
    expect(HIGHLEVEL_LOCATION_GET_ENDPOINT).toBe("GET /locations/:locationId");
  });

  it("does not fail verification just because HighLevel omits isActive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { location: { id: "loc_no_active_flag", name: "865 HVAC" } }))
    );
    const probe = await probeHighLevelLocation("access-must-not-be-logged", "loc_no_active_flag");
    expect(probe.ok).toBe(true);
  });

  it("treats Location is not active on GET /locations as a HighLevel HTTP error, then accepts a reachable location token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { message: "Location is not active", statusCode: 400 }))
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const probe = await probeHighLevelLocation("access-must-not-be-logged", "qPjPtcAUzdkBtYTJUUWB", {
      tokenLocationId: "qPjPtcAUzdkBtYTJUUWB",
      userType: "Location",
    });
    expect(probe.ok).toBe(true);
    const serialized = JSON.stringify(diagnosticRows(info));
    expect(serialized).toContain(HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_START);
    expect(serialized).toContain(HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_RESPONSE);
    expect(serialized).toContain(HIGHLEVEL_OAUTH_MARKERS.LOCATION_VERIFY_SUCCESS);
    expect(serialized).toContain("Location is not active");
    expect(serialized).not.toContain("access-must-not-be-logged");
    expect(serialized).toContain('"tokenType":"location"');
  });

  it("accepts Marketplace OAuth token binding when the token locationId matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(400, { message: "Location is not active" }))
        .mockResolvedValueOnce(jsonResponse(401, { message: "The token is not authorized." }))
        .mockResolvedValueOnce(jsonResponse(401, { message: "The token is not authorized." }))
    );
    const probe = await probeHighLevelLocation("access-must-not-be-logged", "qPjPtcAUzdkBtYTJUUWB", {
      tokenLocationId: "qPjPtcAUzdkBtYTJUUWB",
      userType: "Location",
    });
    expect(probe.ok).toBe(true);
    if (probe.ok) expect(probe.locationId).toBe("qPjPtcAUzdkBtYTJUUWB");
  });

  it("still fails when GET location fails and the token is not bound to that location", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { message: "Location is not active" }))
    );
    const probe = await probeHighLevelLocation("access-must-not-be-logged", "qPjPtcAUzdkBtYTJUUWB", {
      tokenLocationId: "SOME_OTHER_LOCATION",
      userType: "Location",
    });
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error).toBe("Location is not active");
  });

  it("shows AVAILABLE for granted OAuth scopes only after verification, never faking CONNECTED", () => {
    const pending = highlevelCapabilities({
      connected: false,
      scopes: ["contacts.readonly", "phonenumbers.read", "socialplanner/post.write"],
    });
    expect(pending.every((row) => row.status === "NOT_CONFIGURED")).toBe(true);
    const verified = highlevelCapabilities({
      connected: true,
      scopes: ["contacts.readonly", "phonenumbers.read", "socialplanner/post.write"],
    });
    expect(verified.find((row) => row.key === "contacts")?.status).toBe("AVAILABLE");
    expect(verified.find((row) => row.key === "phone")?.status).toBe("AVAILABLE");
    expect(verified.find((row) => row.key === "social")?.status).toBe("AVAILABLE");
    expect(verified.find((row) => row.key === "reviews")?.status).toBe("NOT_AUTHORIZED");
    expect(verified.find((row) => row.key === "contacts")?.status).not.toBe("CONNECTED");
  });
});
