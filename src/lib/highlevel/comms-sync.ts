import type { Prisma, PrismaClient } from "@prisma/client";
import {
  extractHighLevelConversations,
  extractHighLevelMessages,
  getHighLevelContact,
  getHighLevelConversation,
  getHighLevelConversationMessages,
  highLevelConversationId,
  parseHighLevelDate,
  searchHighLevelConversations,
  type HighLevelConversation,
  type HighLevelConversationMessage,
} from "@/lib/highlevel/client";
import { normalizeHighLevelChannel, normalizeHighLevelDirection } from "@/lib/highlevel/channels";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { upsertConversationMessage, upsertConversationThread } from "@/lib/highlevel/conversations";
import { extractHighLevelRecordingHint } from "@/lib/highlevel/attachments";

export type ConversationOutcomeBucket = "mapped" | "provider_only" | "unmatched" | "skipped" | "failed";

export type ConversationSyncReason = {
  conversationId: string | null;
  bucket: ConversationOutcomeBucket;
  reason: string;
};

export type CommunicationsSyncResult = {
  conversationsFound: number;
  conversationsMapped: number;
  providerOnly: number;
  unmatched: number;
  skipped: number;
  failed: number;
  messagesImported: number;
  messageFetchFailed: number;
  reasons: ConversationSyncReason[];
};

function conversationDate(conversation: HighLevelConversation) {
  return parseHighLevelDate(conversation.lastMessageDate) ?? null;
}

async function loadContactDetails(accessToken: string, contactId?: string | null) {
  if (!contactId) return null;
  try {
    return await getHighLevelContact({ accessToken, contactId });
  } catch {
    return null;
  }
}

async function hydrateConversation(accessToken: string, conversation: HighLevelConversation) {
  const id = highLevelConversationId(conversation);
  if (!id) return conversation;
  if (conversation.contactId && (conversation.phone || conversation.email || conversation.fullName || conversation.contactName)) {
    return conversation;
  }
  try {
    const details = await getHighLevelConversation({ accessToken, conversationId: id });
    return { ...conversation, ...details, id: highLevelConversationId(details) || id };
  } catch {
    return conversation;
  }
}

function countBucket(result: CommunicationsSyncResult, bucket: ConversationOutcomeBucket) {
  if (bucket === "mapped") result.conversationsMapped += 1;
  else if (bucket === "provider_only") result.providerOnly += 1;
  else if (bucket === "unmatched") result.unmatched += 1;
  else if (bucket === "skipped") result.skipped += 1;
  else result.failed += 1;
}

export function formatCommunicationsSyncMessage(result: CommunicationsSyncResult) {
  return [
    `Communications sync: ${result.conversationsFound} found`,
    `${result.conversationsMapped} mapped to existing customers`,
    `${result.providerOnly} imported as HighLevel-only contacts`,
    `${result.unmatched} unmatched`,
    `${result.skipped} skipped`,
    `${result.failed} failed`,
    `${result.messagesImported} messages imported`,
    "Nothing was sent",
  ].join(", ") + ".";
}

export async function syncHighLevelCommunications(prisma: PrismaClient, companyId: string): Promise<CommunicationsSyncResult> {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) throw new Error("HighLevel is not connected.");

  const result: CommunicationsSyncResult = {
    conversationsFound: 0,
    conversationsMapped: 0,
    providerOnly: 0,
    unmatched: 0,
    skipped: 0,
    failed: 0,
    messagesImported: 0,
    messageFetchFailed: 0,
    reasons: [],
  };

  let startAfterDate: string | undefined;
  for (let page = 0; page < 15; page += 1) {
    const search = extractHighLevelConversations(
      await searchHighLevelConversations({
        accessToken: access.accessToken,
        locationId: access.locationId,
        limit: 20,
        startAfterDate,
      })
    );
    if (!search.rows.length) break;

    for (const raw of search.rows) {
      result.conversationsFound += 1;
      const outcome = await importConversationSafely(prisma, {
        companyId,
        accessToken: access.accessToken,
        conversation: raw,
      });
      countBucket(result, outcome.bucket);
      result.messagesImported += outcome.messages;
      if (outcome.messageFetchFailed) result.messageFetchFailed += 1;
      result.reasons.push({
        conversationId: outcome.conversationId,
        bucket: outcome.bucket,
        reason: outcome.reason,
      });
    }

    const last = search.rows.at(-1);
    const next = last ? conversationDate(last)?.getTime() : null;
    if (!next || String(next) === startAfterDate) break;
    startAfterDate = String(next);
  }

  const summary = {
    conversationsFound: result.conversationsFound,
    mapped: result.conversationsMapped,
    providerOnly: result.providerOnly,
    unmatched: result.unmatched,
    skipped: result.skipped,
    failed: result.failed,
    messagesImported: result.messagesImported,
    messageFetchFailed: result.messageFetchFailed,
    reasons: result.reasons.slice(0, 50),
  };

  await prisma.integrationSync.create({
    data: {
      companyId,
      connectionId: access.connection.id,
      kind: "communications",
      status: "COMPLETED",
      finishedAt: new Date(),
      recordsIn: result.conversationsFound,
      recordsOut: result.messagesImported,
      summary: summary as Prisma.InputJsonValue,
    },
  });
  await prisma.integrationConnection.update({
    where: { id: access.connection.id },
    data: {
      lastAttemptAt: new Date(),
      lastHealthAt: new Date(),
      healthMessage: formatCommunicationsSyncMessage(result),
    },
  });
  return result;
}

async function importConversationSafely(
  prisma: PrismaClient,
  input: { companyId: string; accessToken: string; conversation: HighLevelConversation }
) {
  try {
    const conversation = await hydrateConversation(input.accessToken, input.conversation);
    const conversationId = highLevelConversationId(conversation);
    if (!conversationId) {
      return {
        conversationId: null,
        bucket: "skipped" as const,
        reason: "skipped — conversation id missing",
        messages: 0,
        messageFetchFailed: false,
      };
    }

    const contact = await loadContactDetails(input.accessToken, conversation.contactId);
    const contactName = conversation.fullName || conversation.contactName || contact?.name || null;
    const phone = conversation.phone || contact?.phone || null;
    const email = conversation.email || contact?.email || null;

    const stored = await upsertConversationThread(prisma, {
      companyId: input.companyId,
      conversationId,
      contactId: conversation.contactId,
      contactName,
      phone,
      email,
      lastPreview: conversation.lastMessageBody || null,
      lastActivityAt: conversationDate(conversation) ?? undefined,
      unread: (conversation.unreadCount ?? 0) > 0,
      channel: normalizeHighLevelChannel(conversation.lastMessageType),
    });

    const imported = await importMessages(prisma, {
      companyId: input.companyId,
      accessToken: input.accessToken,
      conversation: { ...conversation, id: conversationId },
      contactName,
      phone,
      email,
    });

    const reason = imported.error
      ? `imported thread; messages failed — ${imported.error}`
      : stored.bucket === "mapped"
        ? "mapped to existing customer"
        : stored.bucket === "provider_only"
          ? conversation.contactId
            ? "imported as HighLevel-only contact"
            : "imported without a matched customer"
          : conversation.contactId
            ? "unmatched — no verified email or phone"
            : "unmatched — contact missing";

    return {
      conversationId,
      bucket: stored.bucket,
      reason,
      messages: imported.messages,
      messageFetchFailed: Boolean(imported.error),
    };
  } catch (error) {
    return {
      conversationId: highLevelConversationId(input.conversation),
      bucket: "failed" as const,
      reason: `failed — ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 180),
      messages: 0,
      messageFetchFailed: false,
    };
  }
}

async function importMessages(
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
  const conversationId = highLevelConversationId(input.conversation);
  if (!conversationId) return { messages: 0, error: "conversation id missing" };

  let lastMessageId: string | undefined;
  let messages = 0;
  try {
    for (let page = 0; page < 8; page += 1) {
      const payload = await getHighLevelConversationMessages({
        accessToken: input.accessToken,
        conversationId,
        lastMessageId,
        limit: 20,
      });
      const extracted = extractHighLevelMessages(payload);
      if (!extracted.rows.length) break;
      for (const message of extracted.rows) {
        await storeMessage(prisma, input, message);
        messages += 1;
      }
      if (!extracted.nextPage || !extracted.lastMessageId || extracted.lastMessageId === lastMessageId) break;
      lastMessageId = extracted.lastMessageId;
    }
    return { messages, error: null as string | null };
  } catch (error) {
    return {
      messages,
      error: error instanceof Error ? error.message : "message fetch failed",
    };
  }
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
  const recordingHint = extractHighLevelRecordingHint(message.attachments, message.meta?.recordingUrl);
  return upsertConversationMessage(prisma, {
    companyId: conversation.companyId,
    conversationId: highLevelConversationId({ id: message.conversationId, conversationId: highLevelConversationId(conversation.conversation) }) || conversation.conversation.id || "",
    messageId,
    contactId: message.contactId || conversation.conversation.contactId,
    contactName: conversation.contactName,
    phone: conversation.phone,
    email: conversation.email,
    body: message.body || message.message || null,
    channel: normalizeHighLevelChannel(message.type || message.messageType || conversation.conversation.lastMessageType),
    direction: normalizeHighLevelDirection(message.direction),
    kind: normalizeHighLevelChannel(message.type || message.messageType),
    occurredAt: parseHighLevelDate(message.dateAdded),
    status: message.status ?? null,
    unread: (conversation.conversation.unreadCount ?? 0) > 0,
    callDuration: message.meta?.callDuration ?? null,
    callStatus: message.meta?.callStatus ?? message.status ?? null,
    recordingUrl: recordingHint.hasRecording ? "available" : null,
    attachments: message.attachments,
  });
}
