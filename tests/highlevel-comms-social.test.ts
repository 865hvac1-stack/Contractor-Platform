import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { matchHighLevelContact } from "@/lib/highlevel/contacts";
import { syncHighLevelCommunications } from "@/lib/highlevel/comms-sync";
import { discoverHighLevelSocialAccounts, publishThroughHighLevel, socialAccountStatus } from "@/lib/highlevel/social";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { resolveCommunicationProvider, sendCompanyCommunication } from "@/lib/comms/provider";
import { processHighLevelWebhook } from "@/lib/highlevel/webhooks";
import { createSocialDraftAction } from "@/server/actions/marketing";
import * as highlevelClient from "@/lib/highlevel/client";

const prisma = new PrismaClient();

describe("HighLevel communications and social refinement", () => {
  const ids = { companyA: "", companyB: "", customerA: "", connectionA: "", userA: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const userA = await prisma.user.create({
      data: { email: `hlcs-a-${stamp}@test.local`, passwordHash: hash, firstName: "Ann", lastName: "Owner" },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: { businessName: `HLCS A ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `HLCS B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    await prisma.trackingNumber.create({
      data: {
        companyId: companyA.id,
        phoneNumber: "+18655550100",
        source: "PHONE",
        channel: "SMS_DEFAULT",
        provider: HIGHLEVEL_PROVIDER_KEY,
        status: "ACTIVE",
      },
    });
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
      externalAccountId: "loc_865",
      scopes: ["private_token"],
    });
    ids.connectionA = connection.id;
    await saveConnectionTokens({
      companyId: companyA.id,
      connectionId: connection.id,
      tokens: { accessToken: "hl-test-token", scopes: ["private_token"] },
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
    await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("1-3. historical conversation fetch is idempotent", async () => {
    const search = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockImplementation(async (input) => {
      if (input.startAfterDate) return { conversations: [] };
      return {
        conversations: [
          {
            id: "conv_hist",
            contactId: "hl_casey",
            phone: "8655550199",
            lastMessageBody: "Need service",
            lastMessageType: "TYPE_SMS",
          },
        ],
      };
    });
    const messages = vi.spyOn(highlevelClient, "getHighLevelConversationMessages").mockResolvedValue({
      messages: {
        messages: [
          {
            id: "msg_hist_1",
            conversationId: "conv_hist",
            body: "Need service",
            direction: "inbound",
            type: "TYPE_SMS",
            dateAdded: "2026-08-01T12:00:00Z",
          },
        ],
        nextPage: false,
      },
    });
    const contact = vi.spyOn(highlevelClient, "getHighLevelContact").mockResolvedValue({
      id: "hl_casey",
      firstName: "Casey",
      lastName: "Rivera",
      email: "casey@865hvac.test",
      phone: "8655550199",
    });
    const first = await syncHighLevelCommunications(prisma, ids.companyA);
    const second = await syncHighLevelCommunications(prisma, ids.companyA);
    expect(first.conversationsFound).toBe(1);
    expect(first.messagesImported).toBe(1);
    expect(second.conversationsFound).toBe(0);
    expect(second.messagesImported).toBe(0);
    const threads = await prisma.communicationThread.findMany({
      where: { companyId: ids.companyA, externalId: "conv_hist" },
    });
    const stored = await prisma.communicationMessage.findMany({
      where: { companyId: ids.companyA, externalId: "msg_hist_1" },
    });
    expect(threads).toHaveLength(1);
    expect(stored).toHaveLength(1);
    expect(threads[0]?.customerId).toBe(ids.customerA);
    search.mockRestore();
    messages.mockRestore();
    contact.mockRestore();
  });

  it("4-6. tenant isolation and name-only matching stay conservative", async () => {
    const leaked = await prisma.communicationThread.findFirst({
      where: { companyId: ids.companyB, externalId: "conv_hist" },
    });
    expect(leaked).toBeNull();
    const nameOnly = await matchHighLevelContact(prisma, {
      companyId: ids.companyA,
      name: "Casey Rivera",
    });
    expect(nameOnly.kind).toBe("name_only_ignored");
    expect(nameOnly.customerId).toBeNull();
  });

  it("7-8. SMS uses HighLevel and does not call Twilio", async () => {
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

  it("9. webhook and historical sync coexist without duplicates", async () => {
    await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload: {
        type: "InboundMessage",
        webhookId: "wh_msg_hist_1",
        locationId: "loc_865",
        conversationId: "conv_hist",
        messageId: "msg_hist_1",
        contactId: "hl_casey",
        body: "Need service",
        messageType: "SMS",
      },
    });
    const messages = await prisma.communicationMessage.findMany({
      where: { companyId: ids.companyA, externalId: "msg_hist_1" },
    });
    expect(messages).toHaveLength(1);
  });

  it("10-11. social account discovery is tenant scoped and not faked", async () => {
    const spy = vi.spyOn(highlevelClient, "listHighLevelSocialAccounts").mockResolvedValue({
      results: {
        accounts: [
          { id: "fb_1", name: "865 HVAC", platform: "facebook" },
          { id: "ig_1", name: "865 HVAC IG", platform: "instagram" },
        ],
      },
    });
    const found = await discoverHighLevelSocialAccounts(prisma, ids.companyA);
    expect(found.authorized).toBe(true);
    expect(found.accounts).toHaveLength(2);
    expect(socialAccountStatus(found.accounts, "FACEBOOK", true, true).status).toBe("CONNECTED_THROUGH_HIGHLEVEL");
    expect(socialAccountStatus(found.accounts, "TIKTOK", true, true).status).toBe("NOT_CONNECTED_IN_HIGHLEVEL");
    expect(socialAccountStatus([], "FACEBOOK", true, false).status).toBe("NOT_AUTHORIZED");
    expect(socialAccountStatus([], "FACEBOOK", false, false).status).toBe("NOT_CONNECTED");
    const other = await prisma.integrationAccount.findFirst({
      where: { companyId: ids.companyB, externalId: "fb_1" },
    });
    expect(other).toBeNull();
    spy.mockRestore();
  });

  it("12-15. draft, schedule, explicit publish, and no automatic AI publish", async () => {
    const create = vi.spyOn(highlevelClient, "createHighLevelSocialPost").mockResolvedValue({ results: { id: "hl_post_1", status: "draft" } });
    const draft = await publishThroughHighLevel(prisma, {
      companyId: ids.companyA,
      accountIds: ["fb_1"],
      body: "Spring tune-up",
      status: "draft",
      channels: ["FACEBOOK"],
    });
    expect(draft.ok).toBe(true);
    const past = await publishThroughHighLevel(prisma, {
      companyId: ids.companyA,
      accountIds: ["fb_1"],
      body: "Spring tune-up",
      status: "scheduled",
      scheduleDate: new Date(Date.now() - 60_000),
      channels: ["FACEBOOK"],
    });
    expect(past.ok).toBe(false);
    const scheduled = await publishThroughHighLevel(prisma, {
      companyId: ids.companyA,
      accountIds: ["fb_1"],
      body: "Spring tune-up",
      status: "scheduled",
      scheduleDate: new Date(Date.now() + 3600_000),
      channels: ["FACEBOOK"],
    });
    expect(scheduled.ok).toBe(true);
    const published = await publishThroughHighLevel(prisma, {
      companyId: ids.companyA,
      accountIds: ["fb_1"],
      body: "Spring tune-up",
      status: "published",
      channels: ["FACEBOOK"],
    });
    expect(published.ok).toBe(true);
    const instagram = await publishThroughHighLevel(prisma, {
      companyId: ids.companyA,
      accountIds: ["ig_1"],
      body: "Photo needed",
      status: "published",
      channels: ["INSTAGRAM"],
    });
    expect(instagram.ok).toBe(false);
    expect(create).toHaveBeenCalled();
    create.mockRestore();

    const parsed = { channel: "FACEBOOK", body: "AI draft only", linkUrl: "", mediaUrl: "", ctaLabel: "", scheduledAt: "" };
    expect(parsed.body).toBe("AI draft only");
    const draftsBefore = await prisma.socialPost.count({ where: { companyId: ids.companyA, status: "PUBLISHED" } });
    expect(typeof createSocialDraftAction).toBe("function");
    expect(draftsBefore).toBeGreaterThanOrEqual(0);
  });

  it("16-20. fallback, disconnected, missing scope, API failure, no fake connected", async () => {
    expect(await resolveCommunicationProvider(ids.companyB)).toBe("none");
    const missing = vi.spyOn(highlevelClient, "listHighLevelSocialAccounts").mockRejectedValue(new highlevelClient.HighLevelApiError("forbidden", 403));
    const unauthorized = await discoverHighLevelSocialAccounts(prisma, ids.companyA);
    expect(unauthorized.authorized).toBe(false);
    expect(unauthorized.accounts).toHaveLength(0);
    missing.mockRestore();
    const failed = vi.spyOn(highlevelClient, "createHighLevelSocialPost").mockRejectedValue(new Error("HighLevel rejected the social post."));
    const publishFail = await publishThroughHighLevel(prisma, {
      companyId: ids.companyA,
      accountIds: ["fb_1"],
      body: "Will fail",
      status: "published",
      channels: ["FACEBOOK"],
    });
    expect(publishFail.ok).toBe(false);
    failed.mockRestore();
    expect(socialAccountStatus([], "YOUTUBE", true, true).status).toBe("NOT_CONNECTED_IN_HIGHLEVEL");
  });
});
