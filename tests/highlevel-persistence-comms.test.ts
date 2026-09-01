import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { decryptProviderTokens } from "@/lib/integrations/crypto";
import { getValidAccessToken, saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { matchHighLevelContact, resolveHighLevelParticipant } from "@/lib/highlevel/contacts";
import { syncHighLevelCommunications } from "@/lib/highlevel/comms-sync";
import { discoverHighLevelSocialAccounts } from "@/lib/highlevel/social";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { publicHighLevelConnectionView, sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";
import { resolveCommunicationProvider, sendCompanyCommunication } from "@/lib/comms/provider";
import { extractHighLevelConversations, highLevelConversationId } from "@/lib/highlevel/client";
import * as highlevelClient from "@/lib/highlevel/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

describe("HighLevel location ID and credential persistence", () => {
  it("rejects emails and profile values as location IDs", () => {
    expect(sanitizeHighLevelLocationId("865hvac1@gmail.com")).toBeNull();
    expect(sanitizeHighLevelLocationId("  user@company.com  ")).toBeNull();
    expect(sanitizeHighLevelLocationId("")).toBeNull();
    expect(sanitizeHighLevelLocationId("Ssm2VhAUlocation")).toBe("Ssm2VhAUlocation");
    expect(sanitizeHighLevelLocationId("loc_865_hvac")).toBe("loc_865_hvac");
  });

  it("never copies user or company email into the public location ID", () => {
    const polluted = publicHighLevelConnectionView({
      status: "CONNECTED",
      externalAccountId: "865hvac1@gmail.com",
      accountLabel: "865 HVAC",
      hasCredential: true,
      companyEmail: "865hvac1@gmail.com",
      userEmail: "865hvac1@gmail.com",
    });
    expect(polluted.locationId).toBeNull();
    expect(polluted.tokenStored).toBe(true);
    expect("token" in polluted).toBe(false);
    expect(JSON.stringify(polluted)).not.toContain("ghp_");
    expect(JSON.stringify(polluted)).not.toContain("pit_");

    const healthy = publicHighLevelConnectionView({
      status: "CONNECTED",
      externalAccountId: "Ssm2VhAUlocation",
      accountLabel: "865 HVAC",
      hasCredential: true,
      companyEmail: "865hvac1@gmail.com",
      userEmail: "865hvac1@gmail.com",
    });
    expect(healthy.locationId).toBe("Ssm2VhAUlocation");
    expect(healthy.locationName).toBe("865 HVAC");
  });

  it("keeps the latest comms/social migration additive", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "prisma/migrations/20260901193000_highlevel_persistence_comms/migration.sql"),
      "utf8"
    );
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DELETE FROM/i);
  });
});

describe("HighLevel persistence and conversation mapping", () => {
  const ids = { companyA: "", companyB: "", customerA: "", connectionA: "", userA: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const userA = await prisma.user.create({
      data: { email: `hlpersist-a-${stamp}@test.local`, passwordHash: hash, firstName: "Ann", lastName: "Owner" },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: { businessName: `HL Persist A ${stamp}`, industry: "HVAC", status: "ACTIVE", email: "865hvac1@gmail.com" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `HL Persist B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    const customer = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Casey",
        lastName: "Rivera",
        email: "casey@865hvac.test",
        phone: "8655550199",
      },
    });
    ids.customerA = customer.id;
    const connection = await upsertConnection({
      companyId: companyA.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      accountLabel: "865 HVAC",
      externalAccountId: "Ssm2VhAUlocation",
      scopes: ["private_token"],
    });
    ids.connectionA = connection.id;
    await saveConnectionTokens({
      companyId: companyA.id,
      connectionId: connection.id,
      tokens: { accessToken: "hl-pit-secret-do-not-return", scopes: ["private_token"] },
    });
  });

  afterAll(async () => {
    const companyIds = [ids.companyA, ids.companyB];
    await prisma.socialPostPublication.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.socialPost.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.communicationMessage.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.communicationThread.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.callRecord.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.providerIdentityMap.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationAccount.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationSync.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationCredential.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationConnection.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.lead.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("1-5. connection and stored PIT persist after a refresh-shaped reload", async () => {
    const connection = await prisma.integrationConnection.findFirst({
      where: { id: ids.connectionA, companyId: ids.companyA },
    });
    const credential = await prisma.integrationCredential.findFirst({
      where: { companyId: ids.companyA, connectionId: ids.connectionA },
      select: { id: true, ciphertext: true, iv: true, authTag: true, keyVersion: true },
    });
    const view = publicHighLevelConnectionView({
      status: connection?.status,
      externalAccountId: connection?.externalAccountId,
      accountLabel: connection?.accountLabel,
      hasCredential: Boolean(credential),
      companyEmail: "865hvac1@gmail.com",
      userEmail: "865hvac1@gmail.com",
    });
    expect(view.status).toBe("CONNECTED");
    expect(view.locationId).toBe("Ssm2VhAUlocation");
    expect(view.tokenStored).toBe(true);
    expect(JSON.stringify(view)).not.toContain("hl-pit-secret-do-not-return");
    const usable = await getValidAccessToken({
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
    });
    expect(usable?.accessToken).toBe("hl-pit-secret-do-not-return");
    const decoded = decryptProviderTokens({
      ciphertext: Buffer.from(credential!.ciphertext),
      iv: Buffer.from(credential!.iv),
      authTag: Buffer.from(credential!.authTag),
      keyVersion: credential!.keyVersion,
    });
    expect(decoded.accessToken).toBe("hl-pit-secret-do-not-return");
  });

  it("6. replacing the PIT overwrites the encrypted credential only", async () => {
    await saveConnectionTokens({
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      tokens: { accessToken: "hl-pit-rotated-secret", scopes: ["private_token"] },
    });
    const usable = await getValidAccessToken({
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
    });
    expect(usable?.accessToken).toBe("hl-pit-rotated-secret");
    const count = await prisma.integrationCredential.count({
      where: { companyId: ids.companyA, connectionId: ids.connectionA },
    });
    expect(count).toBe(1);
    await saveConnectionTokens({
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      tokens: { accessToken: "hl-pit-secret-do-not-return", scopes: ["private_token"] },
    });
  });

  it("7. disconnected companies are not treated as connected", async () => {
    expect(await resolveCommunicationProvider(ids.companyB)).toBe("none");
    const view = publicHighLevelConnectionView({
      status: "DISABLED",
      externalAccountId: null,
      hasCredential: false,
    });
    expect(view.locationId).toBeNull();
    expect(view.tokenStored).toBe(false);
  });

  it("8-13. conversations become explainable buckets and stay idempotent", async () => {
    const sendSpy = vi.spyOn(highlevelClient, "sendHighLevelSms");
    const search = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockImplementation(async (input) => {
      if (input.startAfterDate) return { conversations: [] };
      return {
        total: 4,
        conversations: [
          {
            conversationId: "conv_mapped",
            contactId: "hl_casey",
            phone: "8655550199",
            lastMessageBody: "Need service",
            lastMessageType: "TYPE_SMS",
          },
          {
            id: "conv_provider",
            contactId: "hl_name_only",
            fullName: "Jordan Lane",
            lastMessageBody: "Can you come by?",
            lastMessageType: "TYPE_SMS",
          },
          {
            id: "conv_unmatched",
            lastMessageBody: "Unknown thread",
            lastMessageType: "TYPE_EMAIL",
          },
          {
            id: "",
            lastMessageBody: "broken",
          },
        ],
      };
    });
    const details = vi.spyOn(highlevelClient, "getHighLevelConversation").mockImplementation(async ({ conversationId }) => ({
      id: conversationId,
      conversationId,
    }));
    const messages = vi.spyOn(highlevelClient, "getHighLevelConversationMessages").mockImplementation(async ({ conversationId }) => {
      if (conversationId === "conv_mapped") {
        return {
          messages: {
            messages: [
              {
                id: "msg_mapped_1",
                conversationId: "conv_mapped",
                body: "Need service",
                direction: "inbound",
                type: "TYPE_SMS",
                dateAdded: "2026-08-01T12:00:00Z",
              },
            ],
            nextPage: false,
          },
        };
      }
      if (conversationId === "conv_provider") {
        return {
          messages: {
            messages: [
              {
                messageId: "msg_provider_1",
                conversationId: "conv_provider",
                body: "Can you come by?",
                direction: "inbound",
                type: "TYPE_SMS",
                dateAdded: 1722513600000,
              },
            ],
            nextPage: false,
          },
        };
      }
      return { messages: { messages: [], nextPage: false } };
    });
    const contact = vi.spyOn(highlevelClient, "getHighLevelContact").mockImplementation(async ({ contactId }) => {
      if (contactId === "hl_casey") {
        return { id: "hl_casey", name: "Casey Rivera", email: "casey@865hvac.test", phone: "8655550199" };
      }
      return { id: contactId, name: "Jordan Lane" };
    });

    const first = await syncHighLevelCommunications(prisma, ids.companyA);
    const second = await syncHighLevelCommunications(prisma, ids.companyA);
    expect(first.conversationsFound).toBe(4);
    expect(first.conversationsMapped).toBe(1);
    expect(first.providerOnly).toBe(1);
    expect(first.unmatched).toBe(1);
    expect(first.skipped).toBe(1);
    expect(first.failed).toBe(0);
    expect(first.messagesImported).toBe(2);
    expect(second.conversationsFound).toBe(4);
    expect(second.messagesImported).toBe(2);
    expect(sendSpy).not.toHaveBeenCalled();

    const threads = await prisma.communicationThread.findMany({
      where: { companyId: ids.companyA },
      orderBy: { externalId: "asc" },
    });
    expect(threads.map((row) => row.externalId).sort()).toEqual(["conv_mapped", "conv_provider", "conv_unmatched"]);
    expect(threads.find((row) => row.externalId === "conv_mapped")?.customerId).toBe(ids.customerA);
    expect(threads.find((row) => row.externalId === "conv_provider")?.customerId).toBeNull();
    expect(threads.find((row) => row.externalId === "conv_provider")?.externalContactId).toBe("hl_name_only");
    expect(threads.find((row) => row.externalId === "conv_unmatched")?.customerId).toBeNull();

    const storedMessages = await prisma.communicationMessage.findMany({
      where: { companyId: ids.companyA },
    });
    expect(storedMessages).toHaveLength(2);
    const identities = await prisma.providerIdentityMap.findMany({
      where: { companyId: ids.companyA, provider: HIGHLEVEL_PROVIDER_KEY, entityType: "CONTACT" },
    });
    expect(identities).toHaveLength(2);
    const leaked = await prisma.communicationThread.findFirst({
      where: { companyId: ids.companyB, externalId: { in: ["conv_mapped", "conv_provider"] } },
    });
    expect(leaked).toBeNull();

    search.mockRestore();
    details.mockRestore();
    messages.mockRestore();
    contact.mockRestore();
    sendSpy.mockRestore();
  });

  it("keeps a thread when historical messages fail", async () => {
    const search = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockImplementation(async (input) => {
      if (input.startAfterDate) return { conversations: [] };
      return {
        conversations: [{ id: "conv_api_fail", contactId: "hl_fail", fullName: "Riley Fox", lastMessageType: "TYPE_SMS" }],
      };
    });
    vi.spyOn(highlevelClient, "getHighLevelConversation").mockResolvedValue({ id: "conv_api_fail", contactId: "hl_fail" });
    vi.spyOn(highlevelClient, "getHighLevelContact").mockResolvedValue({ id: "hl_fail", name: "Riley Fox" });
    vi.spyOn(highlevelClient, "getHighLevelConversationMessages").mockRejectedValue(
      new highlevelClient.HighLevelApiError("The token does not have access to this location.", 401)
    );

    const result = await syncHighLevelCommunications(prisma, ids.companyA);
    expect(result.conversationsFound).toBe(1);
    expect(result.providerOnly).toBe(1);
    expect(result.messageFetchFailed).toBe(1);
    expect(result.failed).toBe(0);
    const thread = await prisma.communicationThread.findFirst({
      where: { companyId: ids.companyA, externalId: "conv_api_fail" },
    });
    expect(thread).toBeTruthy();
    expect(thread?.customerId).toBeNull();

    search.mockRestore();
    vi.restoreAllMocks();
  });

  it("14-16. verified email, normalized phone, and name-only stay conservative", async () => {
    const email = await matchHighLevelContact(prisma, { companyId: ids.companyA, email: "Casey@865hvac.test" });
    expect(email.kind).toBe("email");
    const phone = await matchHighLevelContact(prisma, { companyId: ids.companyA, phone: "(865) 555-0199" });
    expect(phone.kind).toBe("phone");
    const nameOnly = await matchHighLevelContact(prisma, { companyId: ids.companyA, name: "Casey Rivera" });
    expect(nameOnly.kind).toBe("name_only_ignored");
    expect(nameOnly.customerId).toBeNull();
    const providerOnly = await resolveHighLevelParticipant(prisma, {
      companyId: ids.companyA,
      contactId: "hl_name_only",
      name: "Jordan Lane",
    });
    expect(providerOnly.bucket).toBe("provider_only");
    expect(providerOnly.customerId).toBeNull();
  });

  it("17-18. HighLevel-only threads are inbox-visible and tenant scoped", async () => {
    const inbox = await prisma.communicationThread.findMany({
      where: { companyId: ids.companyA },
    });
    expect(inbox.some((row) => !row.customerId && row.externalId === "conv_provider")).toBe(true);
    const other = await prisma.communicationThread.findMany({ where: { companyId: ids.companyB } });
    expect(other).toHaveLength(0);
  });

  it("19-20. HighLevel remains the SMS provider and sync never sends", async () => {
    expect(await resolveCommunicationProvider(ids.companyA)).toBe("highlevel");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input).includes("api.twilio.com")).toBe(false);
      return { ok: true, status: 200, json: async () => ({ messageId: "msg_out" }) } as Response;
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const result = await sendCompanyCommunication({
        companyId: ids.companyA,
        channel: "SMS",
        to: "8655550199",
        body: "Office reply",
        customerId: ids.customerA,
      });
      expect(result.provider).toBe("highlevel");
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("21. Social Planner discovery still works", async () => {
    const spy = vi.spyOn(highlevelClient, "listHighLevelSocialAccounts").mockResolvedValue({
      results: { accounts: [{ id: "fb_persist", name: "865 HVAC", platform: "facebook" }] },
    });
    const found = await discoverHighLevelSocialAccounts(prisma, ids.companyA);
    expect(found.authorized).toBe(true);
    expect(found.accounts).toHaveLength(1);
    expect(found.accounts[0]?.platform).toBe("facebook");
    spy.mockRestore();
  });

  it("extracts nested HighLevel conversation payloads and conversationId fields", () => {
    const extracted = extractHighLevelConversations({
      total: 2,
      conversations: {
        conversations: [{ conversationId: "nested_1" }, { id: "nested_2" }],
        total: 2,
      },
    });
    expect(extracted.rows).toHaveLength(2);
    expect(highLevelConversationId(extracted.rows[0])).toBe("nested_1");
    expect(highLevelConversationId({ id: "865hvac1@gmail.com" })).toBeNull();
  });
});
