import type { Prisma, PrismaClient } from "@prisma/client";
import { getValidAccessToken } from "@/lib/integrations/store";
import {
  extractHighLevelConversations,
  extractHighLevelMessages,
  getHighLevelContact,
  getHighLevelConversation,
  getHighLevelConversationMessages,
  highLevelConversationId,
  HighLevelApiError,
  parseHighLevelDate,
  searchHighLevelConversations,
  type HighLevelConversation,
  type HighLevelConversationMessage,
} from "@/lib/highlevel/client";
import { normalizeHighLevelChannel, normalizeHighLevelDirection } from "@/lib/highlevel/channels";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { assertHighLevelLocationToken, ensureHighLevelLocationAccess } from "@/lib/highlevel/location-token";
import { upsertConversationMessage, upsertConversationThread } from "@/lib/highlevel/conversations";
import { extractHighLevelRecordingHint } from "@/lib/highlevel/attachments";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";

export type ConversationOutcomeBucket = "mapped" | "provider_only" | "unmatched" | "skipped" | "failed";

export type ConversationSyncReason = {
  conversationId: string | null;
  bucket: ConversationOutcomeBucket;
  reason: string;
};

export type CommunicationsSyncResult = {
  conversationsFound: number;
  conversationsScanned: number;
  conversationsImported: number;
  conversationsUpdated: number;
  conversationsMapped: number;
  providerOnly: number;
  unmatched: number;
  unmatchedCommunications: number;
  skipped: number;
  failed: number;
  messagesImported: number;
  smsImported: number;
  callsImported: number;
  duplicates: number;
  messageFetchFailed: number;
  failures: number;
  checkpointFrom: string | null;
  checkpointTo: string | null;
  reasons: ConversationSyncReason[];
};

function conversationDate(conversation: HighLevelConversation) {
  return parseHighLevelDate(conversation.lastMessageDate) ?? null;
}

type SyncAccessState = {
  companyId: string;
  connectionId: string;
  locationId: string;
  accessToken: string;
};

const DEFAULT_LOOKBACK_DAYS = 120;
const MAX_CONVERSATION_PAGES = 30;
const MAX_MESSAGE_PAGES = 10;

function parseEnvInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callHighLevelWithResilience<T>(
  prisma: PrismaClient,
  access: SyncAccessState,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  let didRefresh = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fn(access.accessToken);
    } catch (error) {
      if (error instanceof HighLevelApiError && error.status === 429 && attempt < 3) {
        await sleep(500 * (2 ** attempt));
        continue;
      }
      if (error instanceof HighLevelApiError && error.status === 401 && !didRefresh) {
        didRefresh = true;
        const refreshed = await getValidAccessToken({
          companyId: access.companyId,
          connectionId: access.connectionId,
          providerKey: HIGHLEVEL_PROVIDER_KEY,
        });
        if (refreshed?.accessToken) {
          const ensured = await ensureHighLevelLocationAccess({
            prisma,
            companyId: access.companyId,
            connectionId: access.connectionId,
            locationId: access.locationId,
            tokens: refreshed,
          });
          assertHighLevelLocationToken(ensured);
          access.accessToken = ensured.accessToken;
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error("HighLevel request failed after retries.");
}

function getLastSuccessfulCheckpoint(summary: Prisma.JsonValue | null | undefined) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const value = (summary as Record<string, unknown>).checkpointTo;
  return typeof value === "string" && value ? value : null;
}

function isCallLikeMessage(message: HighLevelConversationMessage) {
  const raw = `${message.messageType || ""} ${message.messageTypeString || ""}`.toUpperCase();
  const normalized = normalizeHighLevelChannel(typeof message.type === "string" ? message.type : message.messageType || "");
  return normalized === "CALL" || normalized === "VOICEMAIL" || raw.includes("CALL") || raw.includes("VOICEMAIL");
}

function isSmsLikeMessage(message: HighLevelConversationMessage) {
  const normalized = normalizeHighLevelChannel(typeof message.type === "string" ? message.type : message.messageType || "");
  return normalized === "SMS";
}

async function loadContactDetails(prisma: PrismaClient, access: SyncAccessState, contactId?: string | null) {
  if (!contactId) return null;
  try {
    return await callHighLevelWithResilience(prisma, access, (accessToken) =>
      getHighLevelContact({ accessToken, contactId })
    );
  } catch {
    return null;
  }
}

async function hydrateConversation(prisma: PrismaClient, access: SyncAccessState, conversation: HighLevelConversation) {
  const id = highLevelConversationId(conversation);
  if (!id) return conversation;
  if (conversation.contactId && (conversation.phone || conversation.email || conversation.fullName || conversation.contactName)) {
    return conversation;
  }
  try {
    const details = await callHighLevelWithResilience(prisma, access, (accessToken) =>
      getHighLevelConversation({ accessToken, conversationId: id })
    );
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
    `Communications sync: ${result.conversationsScanned} scanned`,
    `${result.conversationsImported} new threads`,
    `${result.conversationsUpdated} updated threads`,
    `${result.smsImported} SMS`,
    `${result.callsImported} calls/voicemail`,
    `${result.unmatchedCommunications} unmatched`,
    `${result.duplicates} duplicate records`,
    `${result.failures} failures`,
    "Nothing was sent",
  ].join(", ") + ".";
}

export async function syncHighLevelCommunications(prisma: PrismaClient, companyId: string): Promise<CommunicationsSyncResult> {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) throw new Error("HighLevel is not connected.");
  assertHighLevelLocationToken(access);
  const lookbackDays = parseEnvInt("HIGHLEVEL_COMMS_LOOKBACK_DAYS", DEFAULT_LOOKBACK_DAYS);
  const maxConversationPages = parseEnvInt("HIGHLEVEL_COMMS_MAX_PAGES", MAX_CONVERSATION_PAGES);
  const maxMessagePages = parseEnvInt("HIGHLEVEL_COMMS_MAX_MESSAGE_PAGES", MAX_MESSAGE_PAGES);

  const lastCompleted = await prisma.integrationSync.findFirst({
    where: {
      companyId,
      connectionId: access.connection.id,
      kind: "communications",
      status: "COMPLETED",
    },
    orderBy: { startedAt: "desc" },
  });

  const fallbackFrom = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const safeCheckpoint = getLastSuccessfulCheckpoint(lastCompleted?.summary);
  const checkpointFrom = safeCheckpoint || fallbackFrom;
  let checkpointTo = checkpointFrom;

  await prisma.integrationConnection.update({
    where: { id: access.connection.id },
    data: {
      status: "SYNCING",
      lastAttemptAt: new Date(),
      errorMessage: null,
      healthMessage: "Communications sync started.",
    },
  });

  const syncRun = await prisma.integrationSync.create({
    data: {
      companyId,
      connectionId: access.connection.id,
      kind: "communications",
      status: "RUNNING",
      summary: { checkpointFrom } as Prisma.InputJsonValue,
    },
  });

  const result: CommunicationsSyncResult = {
    conversationsFound: 0,
    conversationsScanned: 0,
    conversationsImported: 0,
    conversationsUpdated: 0,
    conversationsMapped: 0,
    providerOnly: 0,
    unmatched: 0,
    unmatchedCommunications: 0,
    skipped: 0,
    failed: 0,
    messagesImported: 0,
    smsImported: 0,
    callsImported: 0,
    duplicates: 0,
    messageFetchFailed: 0,
    failures: 0,
    checkpointFrom,
    checkpointTo,
    reasons: [],
  };

  const accessState: SyncAccessState = {
    companyId,
    connectionId: access.connection.id,
    locationId: access.locationId,
    accessToken: access.accessToken,
  };
  let startAfterDate: string | undefined = safeCheckpoint ? String(new Date(checkpointFrom).getTime()) : undefined;

  try {
    for (let page = 0; page < maxConversationPages; page += 1) {
      const searchPayload = await callHighLevelWithResilience(prisma, accessState, (accessToken) =>
        searchHighLevelConversations({
          accessToken,
          locationId: access.locationId,
          limit: 20,
          sort: "asc",
          status: "all",
          startAfterDate,
        })
      );
      const search = extractHighLevelConversations(searchPayload);
      if (!search.rows.length) break;

      for (const raw of search.rows) {
        result.conversationsFound += 1;
        result.conversationsScanned += 1;
        const existingThread = highLevelConversationId(raw)
          ? await prisma.communicationThread.findUnique({
              where: {
                companyId_provider_externalId: {
                  companyId,
                  provider: HIGHLEVEL_PROVIDER_KEY,
                  externalId: highLevelConversationId(raw) as string,
                },
              },
              select: { id: true },
            })
          : null;
        const outcome = await importConversationSafely(prisma, accessState, {
          companyId,
          locationId: access.locationId,
          conversation: raw,
          maxMessagePages,
        });
        if (outcome.checkpointTo && outcome.checkpointTo > checkpointTo) {
          checkpointTo = outcome.checkpointTo;
        }
        countBucket(result, outcome.bucket);
        if (outcome.bucket === "provider_only" || outcome.bucket === "unmatched") result.unmatchedCommunications += 1;
        if (outcome.bucket === "failed") result.failures += 1;
        result.messagesImported += outcome.messages;
        result.smsImported += outcome.sms ?? 0;
        result.callsImported += outcome.calls ?? 0;
        result.duplicates += outcome.duplicates ?? 0;
        if (outcome.messageFetchFailed) result.messageFetchFailed += 1;
        if (outcome.bucket !== "skipped" && outcome.bucket !== "failed") {
          if (existingThread) result.conversationsUpdated += 1;
          else result.conversationsImported += 1;
        }
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

    result.checkpointTo = checkpointTo;
    const summary = {
      conversationsFound: result.conversationsFound,
      conversationsScanned: result.conversationsScanned,
      conversationsImported: result.conversationsImported,
      conversationsUpdated: result.conversationsUpdated,
      mapped: result.conversationsMapped,
      providerOnly: result.providerOnly,
      unmatched: result.unmatched,
      unmatchedCommunications: result.unmatchedCommunications,
      skipped: result.skipped,
      failed: result.failed,
      failures: result.failures,
      messagesImported: result.messagesImported,
      smsImported: result.smsImported,
      callsImported: result.callsImported,
      duplicates: result.duplicates,
      messageFetchFailed: result.messageFetchFailed,
      checkpointFrom: result.checkpointFrom,
      checkpointTo: result.checkpointTo,
      reasons: result.reasons.slice(0, 80),
    };

    await prisma.integrationSync.update({
      where: { id: syncRun.id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        recordsIn: result.conversationsScanned,
        recordsOut: result.messagesImported,
        summary: summary as Prisma.InputJsonValue,
      },
    });
    await prisma.integrationConnection.update({
      where: { id: access.connection.id },
      data: {
        status: "CONNECTED",
        lastSyncAt: new Date(),
        lastAttemptAt: new Date(),
        lastHealthAt: new Date(),
        healthMessage: formatCommunicationsSyncMessage(result),
        errorMessage: null,
      },
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Communications sync failed.";
    const authFailure = error instanceof HighLevelApiError && error.status === 401;
    await prisma.integrationSync.update({
      where: { id: syncRun.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        recordsIn: result.conversationsScanned,
        recordsOut: result.messagesImported,
        errorMessage,
        summary: {
          checkpointFrom,
          checkpointToAttempted: checkpointTo,
          failures: result.failures + 1,
          reasons: result.reasons.slice(0, 80),
        } as Prisma.InputJsonValue,
      },
    });
    await prisma.integrationConnection.update({
      where: { id: access.connection.id },
      data: {
        status: authFailure ? "REAUTH_REQUIRED" : "CONNECTED",
        lastAttemptAt: new Date(),
        healthMessage: authFailure
          ? "HighLevel asked for a reconnect. Tokens are still stored."
          : "Communications sync failed. HighLevel is still connected.",
        errorMessage,
      },
    });
    throw error;
  }
}

async function importConversationSafely(
  prisma: PrismaClient,
  access: SyncAccessState,
  input: { companyId: string; locationId: string; conversation: HighLevelConversation; maxMessagePages: number }
) {
  try {
    const conversation = await hydrateConversation(prisma, access, input.conversation);
    const conversationId = highLevelConversationId(conversation);
    if (!conversationId) {
      return {
        conversationId: null,
        bucket: "skipped" as const,
        reason: "skipped — conversation id missing",
        messages: 0,
        sms: 0,
        calls: 0,
        duplicates: 0,
        checkpointTo: null,
        messageFetchFailed: false,
      };
    }
    if (conversation.locationId && conversation.locationId !== input.locationId) {
      return {
        conversationId,
        bucket: "skipped" as const,
        reason: "skipped — wrong location",
        messages: 0,
        sms: 0,
        calls: 0,
        duplicates: 0,
        checkpointTo: null,
        messageFetchFailed: false,
      };
    }

    const contact = await loadContactDetails(prisma, access, conversation.contactId);
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

    const imported = await importMessages(prisma, access, {
      companyId: input.companyId,
      conversation: { ...conversation, id: conversationId },
      contactName,
      phone,
      email,
      maxMessagePages: input.maxMessagePages,
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
      sms: imported.sms,
      calls: imported.calls,
      duplicates: imported.duplicates,
      checkpointTo: imported.checkpointTo ?? conversationDate(conversation)?.toISOString() ?? null,
      messageFetchFailed: Boolean(imported.error),
    };
  } catch (error) {
    return {
      conversationId: highLevelConversationId(input.conversation),
      bucket: "failed" as const,
      reason: `failed — ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 180),
      messages: 0,
      sms: 0,
      calls: 0,
      duplicates: 0,
      checkpointTo: null,
      messageFetchFailed: false,
    };
  }
}

async function importMessages(
  prisma: PrismaClient,
  access: SyncAccessState,
  input: {
    companyId: string;
    conversation: HighLevelConversation;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    maxMessagePages: number;
  }
) {
  const conversationId = highLevelConversationId(input.conversation);
  if (!conversationId) return { messages: 0, error: "conversation id missing" };

  let lastMessageId: string | undefined;
  let messages = 0;
  let sms = 0;
  let calls = 0;
  let duplicates = 0;
  let checkpointTo: string | null = null;
  try {
    for (let page = 0; page < input.maxMessagePages; page += 1) {
      const payload = await callHighLevelWithResilience(prisma, access, (accessToken) =>
        getHighLevelConversationMessages({
          accessToken,
          conversationId,
          lastMessageId,
          limit: 50,
        })
      );
      const extracted = extractHighLevelMessages(payload);
      if (!extracted.rows.length) break;
      for (const message of extracted.rows) {
        const externalId = message.id || message.messageId;
        if (externalId) {
          const existing = await prisma.communicationMessage.findUnique({
            where: {
              companyId_provider_externalId: {
                companyId: input.companyId,
                provider: HIGHLEVEL_PROVIDER_KEY,
                externalId,
              },
            },
            select: { id: true },
          });
          if (existing) duplicates += 1;
        }
        await storeMessage(prisma, input, message);
        messages += 1;
        if (isSmsLikeMessage(message)) sms += 1;
        if (isCallLikeMessage(message)) calls += 1;
        const occurredAt = parseHighLevelDate(message.dateAdded);
        if (occurredAt) {
          const iso = occurredAt.toISOString();
          if (!checkpointTo || iso > checkpointTo) checkpointTo = iso;
        }
      }
      if (!extracted.nextPage || !extracted.lastMessageId || extracted.lastMessageId === lastMessageId) break;
      lastMessageId = extracted.lastMessageId;
    }
    return { messages, sms, calls, duplicates, checkpointTo, error: null as string | null };
  } catch (error) {
    return {
      messages,
      sms,
      calls,
      duplicates,
      checkpointTo,
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
    channel: normalizeHighLevelChannel(
      (typeof message.type === "string" ? message.type : message.messageType) || conversation.conversation.lastMessageType
    ),
    direction: normalizeHighLevelDirection(message.direction),
    kind: normalizeHighLevelChannel(typeof message.type === "string" ? message.type : message.messageType),
    occurredAt: parseHighLevelDate(message.dateAdded),
    status: message.status ?? null,
    unread: (conversation.conversation.unreadCount ?? 0) > 0,
    callDuration: message.callDuration ?? message.meta?.callDuration ?? null,
    callStatus: message.callStatus ?? message.meta?.callStatus ?? message.status ?? null,
    recordingUrl: recordingHint.hasRecording ? "available" : null,
    attachments: message.attachments,
    fromNumber: message.from || null,
    toNumber: message.to || null,
    locationId: message.locationId ?? conversation.conversation.locationId ?? null,
  });
}
