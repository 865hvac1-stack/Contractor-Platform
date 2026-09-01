import type { PrismaClient } from "@prisma/client";
import {
  getHighLevelContact,
  getHighLevelConversationMessages,
  searchHighLevelConversations,
  type HighLevelConversation,
  type HighLevelConversationMessage,
} from "@/lib/highlevel/client";
import { normalizeHighLevelChannel, normalizeHighLevelDirection } from "@/lib/highlevel/channels";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { upsertConversationMessage, upsertConversationThread } from "@/lib/highlevel/conversations";

export type CommunicationsSyncResult = {
  conversationsFound: number;
  conversationsMapped: number;
  messagesImported: number;
  unmatched: number;
  failed: number;
};

function conversationDate(conversation: HighLevelConversation) {
  const raw = conversation.lastMessageDate;
  if (typeof raw === "number") return new Date(raw);
  if (typeof raw === "string" && raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function extractMessages(payload: Awaited<ReturnType<typeof getHighLevelConversationMessages>>) {
  const block = payload.messages;
  if (Array.isArray(block)) return { rows: block, nextPage: false, lastMessageId: undefined as string | undefined };
  return {
    rows: block?.messages ?? [],
    nextPage: Boolean(block?.nextPage),
    lastMessageId: block?.lastMessageId,
  };
}

async function loadContactDetails(accessToken: string, contactId?: string | null) {
  if (!contactId) return null;
  try {
    return await getHighLevelContact({ accessToken, contactId });
  } catch {
    return null;
  }
}

export async function syncHighLevelCommunications(prisma: PrismaClient, companyId: string): Promise<CommunicationsSyncResult> {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) throw new Error("HighLevel is not connected.");

  const result: CommunicationsSyncResult = {
    conversationsFound: 0,
    conversationsMapped: 0,
    messagesImported: 0,
    unmatched: 0,
    failed: 0,
  };

  let startAfterDate: string | undefined;
  for (let page = 0; page < 15; page += 1) {
    const search = await searchHighLevelConversations({
      accessToken: access.accessToken,
      locationId: access.locationId,
      limit: 20,
      startAfterDate,
    });
    const conversations = search.conversations ?? [];
    if (!conversations.length) break;

    for (const conversation of conversations) {
      result.conversationsFound += 1;
      try {
        const contact = await loadContactDetails(access.accessToken, conversation.contactId);
        const imported = await importConversation(prisma, {
          companyId,
          accessToken: access.accessToken,
          conversation,
          contactName: conversation.fullName || conversation.contactName || contact?.name || null,
          phone: conversation.phone || contact?.phone || null,
          email: conversation.email || contact?.email || null,
        });
        result.conversationsMapped += 1;
        result.messagesImported += imported.messages;
        if (!imported.customerId) result.unmatched += 1;
      } catch {
        result.failed += 1;
      }
    }

    const last = conversations.at(-1);
    const next = last ? conversationDate(last)?.getTime() : null;
    if (!next || String(next) === startAfterDate) break;
    startAfterDate = String(next);
  }

  await prisma.integrationSync.create({
    data: {
      companyId,
      connectionId: access.connection.id,
      kind: "communications",
      status: "COMPLETED",
      finishedAt: new Date(),
      recordsIn: result.conversationsFound,
      recordsOut: result.messagesImported,
    },
  });
  await prisma.integrationConnection.update({
    where: { id: access.connection.id },
    data: {
      lastAttemptAt: new Date(),
      lastHealthAt: new Date(),
      healthMessage: `Communications sync: ${result.conversationsMapped} conversations, ${result.messagesImported} messages.`,
    },
  });
  return result;
}

async function importConversation(
  prisma: PrismaClient,
  input: {
    companyId: string;
    accessToken: string;
    conversation: HighLevelConversation;
    contactName: string | null;
    phone: string | null;
    email: string | null;
  }
) {
  let lastMessageId: string | undefined;
  let messages = 0;
  let customerId: string | null = null;
  for (let page = 0; page < 8; page += 1) {
    const payload = await getHighLevelConversationMessages({
      accessToken: input.accessToken,
      conversationId: input.conversation.id,
      lastMessageId,
      limit: 20,
    });
    const extracted = extractMessages(payload);
    if (!extracted.rows.length) {
      if (page === 0) {
        const stored = await upsertConversationThread(prisma, {
          companyId: input.companyId,
          conversationId: input.conversation.id,
          contactId: input.conversation.contactId,
          contactName: input.contactName,
          phone: input.phone,
          email: input.email,
          lastPreview: input.conversation.lastMessageBody || null,
          lastActivityAt: conversationDate(input.conversation) ?? undefined,
          unread: (input.conversation.unreadCount ?? 0) > 0,
          channel: normalizeHighLevelChannel(input.conversation.lastMessageType),
        });
        customerId = stored.customerId;
      }
      break;
    }
    for (const message of extracted.rows) {
      const stored = await storeMessage(prisma, input, message);
      messages += 1;
      customerId = stored.customerId ?? customerId;
    }
    if (!extracted.nextPage || !extracted.lastMessageId || extracted.lastMessageId === lastMessageId) break;
    lastMessageId = extracted.lastMessageId;
  }
  return { messages, customerId };
}

async function storeMessage(
  prisma: PrismaClient,
  conversation: {
    companyId: string;
    conversation: HighLevelConversation;
    contactName: string | null;
    phone: string | null;
    email: string | null;
  },
  message: HighLevelConversationMessage
) {
  const messageId = message.id || message.messageId;
  if (!messageId) {
    throw new Error("HighLevel message did not include an id.");
  }
  const recordingUrl = message.attachments?.find((item) => item.url)?.url || message.meta?.recordingUrl || null;
  return upsertConversationMessage(prisma, {
    companyId: conversation.companyId,
    conversationId: message.conversationId || conversation.conversation.id,
    messageId,
    contactId: message.contactId || conversation.conversation.contactId,
    contactName: conversation.contactName,
    phone: conversation.phone,
    email: conversation.email,
    body: message.body || message.message || null,
    channel: normalizeHighLevelChannel(message.type || message.messageType || conversation.conversation.lastMessageType),
    direction: normalizeHighLevelDirection(message.direction),
    kind: normalizeHighLevelChannel(message.type || message.messageType),
    occurredAt: message.dateAdded ? new Date(message.dateAdded) : undefined,
    status: message.status ?? null,
    unread: (conversation.conversation.unreadCount ?? 0) > 0,
    callDuration: message.meta?.callDuration ?? null,
    callStatus: message.meta?.callStatus ?? message.status ?? null,
    recordingUrl,
  });
}
