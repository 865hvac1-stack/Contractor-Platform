import { describe, expect, it } from "vitest";
import { highlevelCapabilities } from "@/lib/highlevel/capabilities";
import type { HighLevelConversationsDiagnostic } from "@/lib/highlevel/conversations-diagnostic";
import { highlevelSettingsHealth } from "@/lib/highlevel/settings-health";

function inactiveConversationsDiagnostic(): HighLevelConversationsDiagnostic {
  return {
    locationId: "loc_inactive_oauth",
    authMode: "oauth",
    mappedContactTested: false,
    probes: [
      {
        endpoint: "GET /conversations/search",
        version: "2021-04-15",
        httpStatus: 401,
        errorCode: "401",
        errorMessage: "Location is not active",
        conversationsReturned: false,
        contactObjectReturned: false,
        topLevelKeys: ["statusCode", "message"],
      },
    ],
  };
}

describe("HighLevel settings health", () => {
  it("does not show operational CONNECTED when conversations return 401 Location is not active", () => {
    const health = highlevelSettingsHealth({
      authenticated: true,
      operationalTokens: true,
      connectionStatus: "CONNECTED",
      diagnostic: inactiveConversationsDiagnostic(),
    });
    expect(health.operational).toBe(false);
    expect(health.headerStatus).toBe("AUTHENTICATED — NEEDS ATTENTION");
    expect(health.verifiedKeys).not.toContain("conversations");
    expect(health.verifiedKeys).not.toContain("sms");
    expect(health.verifiedKeys).not.toContain("phone");
    expect(health.errorKeys).toEqual(["conversations", "sms", "phone"]);

    const capabilities = highlevelCapabilities({
      connected: health.operational,
      authenticated: true,
      scopes: ["conversations.readonly", "conversations/message.write", "phonenumbers.read", "contacts.readonly"],
      verifiedKeys: health.verifiedKeys,
      errorKeys: health.errorKeys,
    });
    expect(capabilities.find((row) => row.key === "conversations")?.status).toBe("CONNECTION_ERROR");
    expect(capabilities.find((row) => row.key === "sms")?.status).toBe("CONNECTION_ERROR");
    expect(capabilities.find((row) => row.key === "phone")?.status).toBe("CONNECTION_ERROR");
    expect(capabilities.find((row) => row.key === "conversations")?.status).not.toBe("CONNECTED");
  });

  it("does not mark a wrong-location token as operational CONNECTED", () => {
    const health = highlevelSettingsHealth({
      authenticated: true,
      operationalTokens: false,
      connectionStatus: "ERROR",
      diagnostic: inactiveConversationsDiagnostic(),
    });
    expect(health.operational).toBe(false);
    expect(health.headerStatus).toBe("AUTHENTICATED — NEEDS ATTENTION");
    expect(health.verifiedKeys).toEqual([]);
  });

  it("requires a successful conversations probe before CONNECTED", () => {
    const health = highlevelSettingsHealth({
      authenticated: true,
      operationalTokens: true,
      connectionStatus: "CONNECTED",
      diagnostic: {
        locationId: "loc_live_ok",
        authMode: "oauth",
        mappedContactTested: false,
        probes: [
          {
            endpoint: "GET /conversations/search",
            version: "2021-07-28",
            httpStatus: 200,
            errorCode: null,
            errorMessage: null,
            conversationsReturned: true,
            contactObjectReturned: false,
            topLevelKeys: ["conversations"],
          },
        ],
      },
    });
    expect(health.operational).toBe(true);
    expect(health.headerStatus).toBe("CONNECTED");
    expect(health.verifiedKeys).toEqual(["conversations", "sms", "phone"]);
  });
});
