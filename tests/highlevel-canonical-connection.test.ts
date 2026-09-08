import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  diagnosticAppliesToCanonicalLocation,
  extractDiagnosticLocationId,
  pickCanonicalHighLevelConnection,
} from "@/lib/highlevel/canonical-connection";
import { ensureCurrentHighLevelDiagnostics } from "@/lib/highlevel/current-diagnostics";
import { highlevelSettingsHealth } from "@/lib/highlevel/settings-health";
import * as conversationsDiagnostic from "@/lib/highlevel/conversations-diagnostic";
import * as tokenTypeDiagnostic from "@/lib/highlevel/token-type-diagnostic";

const STALE = "loc_stale_mapped";
const FRESH = "loc_fresh_oauth";

describe("canonical HighLevel connection selection", () => {
  it("prefers Marketplace OAuth over a newer PIT/testing row", () => {
    const picked = pickCanonicalHighLevelConnection([
      {
        providerKey: "highlevel",
        scopes: ["private_token"],
        status: "CONNECTED",
        updatedAt: new Date("2026-09-08T12:00:00.000Z"),
        externalAccountId: STALE,
      },
      {
        providerKey: "highlevel",
        scopes: ["locations.readonly", "conversations.readonly"],
        status: "CONNECTED",
        updatedAt: new Date("2026-09-08T11:00:00.000Z"),
        externalAccountId: FRESH,
      },
    ]);
    expect(picked?.externalAccountId).toBe(FRESH);
    expect(picked?.scopes).not.toContain("private_token");
  });

  it("does not select a stale diagnostic for a different location", () => {
    expect(extractDiagnosticLocationId({ locationId: STALE, requestedLocationId: STALE })).toBe(STALE);
    expect(diagnosticAppliesToCanonicalLocation({ locationId: STALE }, FRESH)).toBe(false);
    expect(diagnosticAppliesToCanonicalLocation({ requestedLocationId: FRESH, storedLocationId: FRESH }, FRESH)).toBe(
      true
    );

    const health = highlevelSettingsHealth({
      authenticated: true,
      operationalTokens: true,
      connectionStatus: "CONNECTED",
      canonicalLocationId: FRESH,
      diagnostic: {
        locationId: STALE,
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
            topLevelKeys: ["message"],
          },
        ],
      },
    });
    expect(health.liveHealth.locationInactive).toBe(false);
    expect(health.errorKeys).toEqual([]);
    expect(health.verifiedKeys).not.toContain("conversations");
  });

  it("refreshes diagnostics against the canonical location and ignores stale rows", async () => {
    const conversations = vi.spyOn(conversationsDiagnostic, "diagnoseHighLevelConversationsApi").mockResolvedValue({
      locationId: FRESH,
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
    });
    const tokenType = vi.spyOn(tokenTypeDiagnostic, "diagnoseHighLevelTokenType").mockResolvedValue({
      tokenType: "location",
      requestedLocationId: FRESH,
      installed: true,
      locationTokenExchangeHttpStatus: null,
      sanitizedError: null,
      storedUserType: "Location",
      jwtUserType: "Location",
      oauthLocationIdPresent: true,
      storedLocationId: FRESH,
      companyIdPresent: true,
      approvedLocationsCount: 1,
      isBulkInstallation: false,
      approveAllLocations: false,
      installToFutureLocations: false,
    });
    const created: unknown[] = [];
    const prisma = {
      integrationSync: {
        create: async ({ data }: { data: unknown }) => {
          created.push(data);
          return data;
        },
      },
    };
    const result = await ensureCurrentHighLevelDiagnostics(prisma as never, "company_a", {
      connectionId: "conn_a",
      canonicalLocationId: FRESH,
      connected: true,
      lastConversations: { summary: { locationId: STALE } },
      lastTokenType: { summary: { requestedLocationId: STALE, storedLocationId: STALE } },
    });
    expect(result.conversations?.locationId).toBe(FRESH);
    expect(result.tokenType?.requestedLocationId).toBe(FRESH);
    expect(result.tokenType?.storedLocationId).toBe(FRESH);
    expect(conversations).toHaveBeenCalledWith(prisma, "company_a");
    expect(tokenType).toHaveBeenCalledWith(prisma, "company_a");
    expect(created).toHaveLength(2);
    conversations.mockRestore();
    tokenType.mockRestore();
  });

  it("keeps communications, SMS, and diagnostics on the canonical resolver", () => {
    const comms = readFileSync(resolve("src/lib/highlevel/comms-sync.ts"), "utf8");
    const sms = readFileSync(resolve("src/lib/highlevel/communication-provider.ts"), "utf8");
    const conversations = readFileSync(resolve("src/lib/highlevel/conversations-diagnostic.ts"), "utf8");
    const token = readFileSync(resolve("src/lib/highlevel/token-type-diagnostic.ts"), "utf8");
    expect(comms).toContain("loadHighLevelAccess");
    expect(sms).toContain("loadHighLevelAccess");
    expect(sms).toContain("access.locationId");
    expect(conversations).toContain("loadHighLevelAccess");
    expect(conversations).toContain("access.locationId");
    expect(token).toContain("resolveHighLevelConnection");
    expect(comms).not.toContain("qPjPtcAUzdkBtYTJUUWB");
    expect(sms).not.toContain("Ssm2VhAUviopPNmEpNK1");
  });

  it("does not leak another company's connection into the picker", () => {
    const picked = pickCanonicalHighLevelConnection([
      {
        providerKey: "quickbooks",
        scopes: ["accounting"],
        status: "CONNECTED",
        externalAccountId: "realm_other",
      },
    ]);
    expect(picked).toBeNull();
  });
});
