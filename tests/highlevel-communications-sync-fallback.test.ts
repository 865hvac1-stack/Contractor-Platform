import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as highlevelClient from "@/lib/highlevel/client";
import * as store from "@/lib/integrations/store";
import { syncHighLevelCommunications } from "@/lib/highlevel/comms-sync";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import {
  highLevelConnectionUsable,
  isHighLevelConnected,
  loadHighLevelAccess,
  recoverStaleHighLevelSyncing,
} from "@/lib/highlevel/connection";

const prisma = new PrismaClient();

describe("HighLevel communications API sync fallback", () => {
  const ids = { company: "", connection: "", user: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const user = await prisma.user.create({
      data: { email: `hl-sync-fallback-${stamp}@test.local`, passwordHash: hash, firstName: "Ops", lastName: "User" },
    });
    ids.user = user.id;
    const company = await prisma.company.create({
      data: { businessName: `HL Sync Fallback ${stamp}`, status: "ACTIVE" },
    });
    ids.company = company.id;
    const connection = await store.upsertConnection({
      companyId: company.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      accountLabel: "865 HVAC",
      externalAccountId: "qPjPtcAUzdkBtYTJUUWB",
      scopes: ["conversations.readonly", "conversations/message.readonly", "contacts.readonly"],
    });
    ids.connection = connection.id;
    await store.saveConnectionTokens({
      companyId: company.id,
      connectionId: connection.id,
      tokens: { accessToken: "hl-sync-token-v1", scopes: connection.scopes },
    });
  });

  afterAll(async () => {
    await prisma.communicationMessage.deleteMany({ where: { companyId: ids.company } });
    await prisma.communicationThread.deleteMany({ where: { companyId: ids.company } });
    await prisma.callRecord.deleteMany({ where: { companyId: ids.company } });
    await prisma.providerIdentityMap.deleteMany({ where: { companyId: ids.company } });
    await prisma.integrationSync.deleteMany({ where: { companyId: ids.company } });
    await prisma.integrationEvent.deleteMany({ where: { companyId: ids.company } });
    await prisma.integrationCredential.deleteMany({ where: { companyId: ids.company } });
    await prisma.integrationConnection.deleteMany({ where: { companyId: ids.company } });
    await prisma.lead.deleteMany({ where: { companyId: ids.company } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    if (ids.user) await prisma.user.delete({ where: { id: ids.user } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("imports SMS and CALL records with message pagination", async () => {
    const searchSpy = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockImplementation(async (input) => {
      if (input.startAfterDate) return { conversations: [] };
      return {
        conversations: [
          {
            id: "conv_paginated",
            locationId: "qPjPtcAUzdkBtYTJUUWB",
            contactId: "hl_contact_1",
            phone: "+18655550199",
            lastMessageType: "TYPE_CALL",
            lastMessageDate: "2026-09-03T15:00:00.000Z",
          },
        ],
      };
    });
    const convoSpy = vi.spyOn(highlevelClient, "getHighLevelConversation").mockResolvedValue({
      id: "conv_paginated",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
      contactId: "hl_contact_1",
    });
    const contactSpy = vi.spyOn(highlevelClient, "getHighLevelContact").mockResolvedValue({
      id: "hl_contact_1",
      firstName: "Pat",
      lastName: "Caller",
      phone: "+18655550199",
    });
    const messagesSpy = vi.spyOn(highlevelClient, "getHighLevelConversationMessages").mockImplementation(async ({ lastMessageId }) => {
      if (!lastMessageId) {
        return {
          messages: {
            nextPage: true,
            lastMessageId: "cursor_1",
            messages: [
              {
                id: "msg_sms_1",
                conversationId: "conv_paginated",
                locationId: "qPjPtcAUzdkBtYTJUUWB",
                messageType: "SMS",
                direction: "inbound",
                dateAdded: "2026-09-03T14:55:00.000Z",
                body: "Need service",
              },
            ],
          },
        };
      }
      return {
        messages: {
          nextPage: false,
          messages: [
            {
              id: "msg_call_1",
              conversationId: "conv_paginated",
              locationId: "qPjPtcAUzdkBtYTJUUWB",
              messageType: "CALL",
              messageTypeString: "TYPE_CALL",
              direction: "inbound",
              dateAdded: "2026-09-03T14:56:00.000Z",
              callDuration: 95,
              callStatus: "completed",
              from: "+18655550199",
              to: "+18655550100",
            },
          ],
        },
      };
    });

    const result = await syncHighLevelCommunications(prisma, ids.company);
    expect(result.conversationsFound).toBe(1);
    expect(result.messagesImported).toBe(2);
    expect(result.smsImported).toBe(1);
    expect(result.callsImported).toBe(1);

    const call = await prisma.callRecord.findFirst({
      where: { companyId: ids.company, recordingRef: "msg_call_1" },
    });
    expect(call?.durationSeconds).toBe(95);
    expect(call?.missed).toBe(false);

    searchSpy.mockRestore();
    convoSpy.mockRestore();
    contactSpy.mockRestore();
    messagesSpy.mockRestore();
  });

  it("skips conversations from the wrong location", async () => {
    await prisma.integrationSync.deleteMany({ where: { companyId: ids.company, connectionId: ids.connection } });
    const searchSpy = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockResolvedValue({
      conversations: [{ id: "conv_wrong_location", locationId: "other_location", contactId: "hl_x" }],
    });
    const result = await syncHighLevelCommunications(prisma, ids.company);
    expect(result.skipped).toBe(1);
    expect(result.reasons.some((row) => row.reason.includes("wrong location"))).toBe(true);
    const thread = await prisma.communicationThread.findFirst({
      where: { companyId: ids.company, externalId: "conv_wrong_location" },
    });
    expect(thread).toBeNull();
    searchSpy.mockRestore();
  });

  it("refreshes token after 401 and retries", async () => {
    await prisma.integrationSync.deleteMany({ where: { companyId: ids.company, connectionId: ids.connection } });
    const tokenSpy = vi.spyOn(store, "getValidAccessToken").mockImplementation(async (input) => {
      const current = await store.loadConnectionTokens(input.companyId, input.connectionId);
      return {
        accessToken: current?.accessToken === "hl-sync-token-v1" ? "hl-sync-token-v2" : current?.accessToken || "hl-sync-token-v2",
        refreshToken: "hl-refresh-token",
        scopes: ["conversations.readonly"],
      };
    });
    let first = true;
    const searchSpy = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockImplementation(async () => {
      if (first) {
        first = false;
        throw new highlevelClient.HighLevelApiError("expired", 401);
      }
      return { conversations: [] };
    });

    const result = await syncHighLevelCommunications(prisma, ids.company);
    expect(result.conversationsFound).toBe(0);
    expect(tokenSpy).toHaveBeenCalled();
    searchSpy.mockRestore();
    tokenSpy.mockRestore();
  });

  it("does not advance safe checkpoint when a run fails mid-stream", async () => {
    await prisma.integrationSync.deleteMany({ where: { companyId: ids.company, connectionId: ids.connection } });
    let page = 0;
    const searchSpy = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockImplementation(async () => {
      page += 1;
      if (page === 1) {
        return {
          conversations: [{ id: "conv_checkpoint", locationId: "qPjPtcAUzdkBtYTJUUWB", lastMessageDate: "2026-09-03T14:00:00.000Z" }],
        };
      }
      throw new highlevelClient.HighLevelApiError("rate-limit", 500);
    });
    vi.spyOn(highlevelClient, "getHighLevelConversationMessages").mockResolvedValue({
      messages: { nextPage: false, messages: [{ id: "msg_checkpoint_1", conversationId: "conv_checkpoint", messageType: "SMS" }] },
    });
    vi.spyOn(highlevelClient, "getHighLevelConversation").mockResolvedValue({
      id: "conv_checkpoint",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
    });
    vi.spyOn(highlevelClient, "getHighLevelContact").mockResolvedValue({ id: "hl_ckpt" });

    await expect(syncHighLevelCommunications(prisma, ids.company)).rejects.toThrow();
    const failedRun = await prisma.integrationSync.findFirst({
      where: { companyId: ids.company, connectionId: ids.connection, kind: "communications" },
      orderBy: { startedAt: "desc" },
    });
    expect(failedRun?.status).toBe("FAILED");
    const afterFailure = await prisma.integrationConnection.findFirst({ where: { id: ids.connection } });
    expect(afterFailure?.status).toBe("CONNECTED");
    expect(await isHighLevelConnected(prisma, ids.company)).toBe(true);

    searchSpy.mockRestore();
    vi.restoreAllMocks();
    await store.upsertConnection({
      companyId: ids.company,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      externalAccountId: "qPjPtcAUzdkBtYTJUUWB",
      accountLabel: "865 HVAC",
      scopes: ["conversations.readonly", "conversations/message.readonly", "contacts.readonly"],
    });
    await store.saveConnectionTokens({
      companyId: ids.company,
      connectionId: ids.connection,
      tokens: { accessToken: "hl-sync-token-v1", scopes: ["conversations.readonly", "conversations/message.readonly"] },
    });

    const searchSuccess = vi.spyOn(highlevelClient, "searchHighLevelConversations").mockImplementation(async (input) => {
      if (input.startAfterDate) return { conversations: [] };
      return {
        conversations: [{ id: "conv_checkpoint", locationId: "qPjPtcAUzdkBtYTJUUWB", lastMessageDate: "2026-09-03T14:00:00.000Z" }],
      };
    });
    vi.spyOn(highlevelClient, "getHighLevelConversationMessages").mockResolvedValue({
      messages: { nextPage: false, messages: [{ id: "msg_checkpoint_1", conversationId: "conv_checkpoint", messageType: "SMS" }] },
    });
    vi.spyOn(highlevelClient, "getHighLevelConversation").mockResolvedValue({
      id: "conv_checkpoint",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
    });
    vi.spyOn(highlevelClient, "getHighLevelContact").mockResolvedValue({ id: "hl_ckpt" });
    const recovered = await syncHighLevelCommunications(prisma, ids.company);
    expect(recovered.messagesImported).toBeGreaterThanOrEqual(1);

    const completedRun = await prisma.integrationSync.findFirst({
      where: { companyId: ids.company, connectionId: ids.connection, kind: "communications", status: "COMPLETED" },
      orderBy: { startedAt: "desc" },
    });
    const summary = (completedRun?.summary ?? {}) as Record<string, unknown>;
    expect(typeof summary.checkpointTo).toBe("string");
    searchSuccess.mockRestore();
    vi.restoreAllMocks();
  });

  it("keeps HighLevel usable while SYNCING and recovers a stale sync lock", async () => {
    expect(
      highLevelConnectionUsable({ status: "SYNCING", externalAccountId: "qPjPtcAUzdkBtYTJUUWB" })
    ).toBe(true);
    expect(
      highLevelConnectionUsable({ status: "ERROR", externalAccountId: "qPjPtcAUzdkBtYTJUUWB" })
    ).toBe(true);
    expect(
      highLevelConnectionUsable({ status: "DISABLED", externalAccountId: "qPjPtcAUzdkBtYTJUUWB" })
    ).toBe(false);

    await store.upsertConnection({
      companyId: ids.company,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "SYNCING",
      externalAccountId: "qPjPtcAUzdkBtYTJUUWB",
      accountLabel: "865 HVAC",
      scopes: ["conversations.readonly"],
    });
    expect(await isHighLevelConnected(prisma, ids.company)).toBe(true);
    expect(await loadHighLevelAccess(prisma, ids.company)).not.toBeNull();

    await prisma.integrationConnection.update({
      where: { id: ids.connection },
      data: { status: "SYNCING", lastAttemptAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const recovered = await recoverStaleHighLevelSyncing(prisma, {
      id: ids.connection,
      status: "SYNCING",
      lastAttemptAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    expect(recovered).toBe("CONNECTED");
    const row = await prisma.integrationConnection.findFirst({ where: { id: ids.connection } });
    expect(row?.status).toBe("CONNECTED");
  });
});
