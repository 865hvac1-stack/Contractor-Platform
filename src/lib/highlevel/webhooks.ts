import { createVerify, verify as cryptoVerify } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { HIGHLEVEL_ED25519_PUBLIC_KEY, HIGHLEVEL_PROVIDER_KEY, HIGHLEVEL_RSA_PUBLIC_KEY } from "@/lib/highlevel/config";
import { ingestHighLevelLead } from "@/lib/highlevel/leads";
import { matchHighLevelContact, mapContactToCustomer } from "@/lib/highlevel/contacts";
import { extractHighLevelRecordingHint } from "@/lib/highlevel/attachments";
import { upsertConversationMessage } from "@/lib/highlevel/conversations";
import { normalizeHighLevelChannel } from "@/lib/highlevel/channels";
import { parseHighLevelDate } from "@/lib/highlevel/client";

export type HighLevelWebhookAuthReason =
  | "verified"
  | "missing_signature"
  | "invalid_signature"
  | "unsigned_allowed_non_production";

export type HighLevelWebhookAuthResult = {
  ok: boolean;
  reason: HighLevelWebhookAuthReason;
  algorithm: "ed25519" | "rsa-sha256" | null;
};

function usableSignature(value?: string | null) {
  return Boolean(value && value !== "N/A");
}

/**
 * Official Marketplace verification:
 * https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/
 * Prefer X-GHL-Signature (Ed25519) over the raw UTF-8 body. Fall back to
 * X-WH-Signature (RSA-SHA256) only when the GHL header is absent.
 * No Authorization header, shared secret, or timestamp header is documented.
 */
export function evaluateHighLevelWebhookAuth(input: {
  rawBody: string;
  ghlSignature?: string | null;
  legacySignature?: string | null;
  requireSignature?: boolean;
  /** Test-only override. Production always uses the official Marketplace public key. */
  ed25519PublicKey?: string;
  rsaPublicKey?: string;
}): HighLevelWebhookAuthResult {
  if (usableSignature(input.ghlSignature)) {
    try {
      const payloadBuffer = Buffer.from(input.rawBody, "utf8");
      const signatureBuffer = Buffer.from(input.ghlSignature as string, "base64");
      const ok = cryptoVerify(
        null,
        payloadBuffer,
        input.ed25519PublicKey || HIGHLEVEL_ED25519_PUBLIC_KEY,
        signatureBuffer,
      );
      return { ok, reason: ok ? "verified" : "invalid_signature", algorithm: "ed25519" };
    } catch {
      return { ok: false, reason: "invalid_signature", algorithm: "ed25519" };
    }
  }
  if (usableSignature(input.legacySignature)) {
    try {
      const verifier = createVerify("SHA256");
      verifier.update(input.rawBody);
      const ok = verifier.verify(
        input.rsaPublicKey || HIGHLEVEL_RSA_PUBLIC_KEY,
        input.legacySignature as string,
        "base64",
      );
      return { ok, reason: ok ? "verified" : "invalid_signature", algorithm: "rsa-sha256" };
    } catch {
      return { ok: false, reason: "invalid_signature", algorithm: "rsa-sha256" };
    }
  }
  if (input.requireSignature) {
    return { ok: false, reason: "missing_signature", algorithm: null };
  }
  return { ok: true, reason: "unsigned_allowed_non_production", algorithm: null };
}

export function verifyHighLevelWebhookSignature(input: {
  rawBody: string;
  ghlSignature?: string | null;
  legacySignature?: string | null;
}) {
  return evaluateHighLevelWebhookAuth({ ...input, requireSignature: true }).ok;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Marketplace sometimes wraps the documented event in payload / data / webhook.
 * Merge one level so locationId and type still resolve. Official InboundMessage
 * is flat and is unchanged by this.
 */
export function unwrapHighLevelWebhookBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  let obj = { ...(raw as Record<string, unknown>) };
  for (const key of ["payload", "data", "webhook"] as const) {
    const inner = obj[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      obj = { ...obj, ...(inner as Record<string, unknown>) };
    }
  }
  return obj;
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseCallDurationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

export type HighLevelInboundFields = {
  type: string;
  webhookId: string;
  locationId: string;
  contactId: string | null;
  conversationId: string | null;
  messageId: string | null;
  from: string | null;
  to: string | null;
  direction: string | null;
  status: string | null;
  callStatus: string | null;
  callDuration: number | null;
  timestamp: Date | null;
  channel: string;
  kind: string;
  body: string | null;
  contactName: string | null;
  attachments: unknown;
  hasRecording: boolean;
  messageType: string | null;
};

export function parseHighLevelWebhook(payload: Record<string, unknown>) {
  const unwrapped = unwrapHighLevelWebhookBody(payload);
  const data = asRecord(unwrapped.data);
  const extras = asRecord(unwrapped.extras);
  const location =
    text(unwrapped.locationId) ||
    text(unwrapped.location_id) ||
    text(asRecord(unwrapped.location).id) ||
    text(data.locationId) ||
    text(asRecord(data.location).id) ||
    text(extras.locationId);
  return {
    type: text(unwrapped.type) || text(unwrapped.event) || "Unknown",
    webhookId: text(unwrapped.webhookId) || text(unwrapped.id) || text(unwrapped.messageId) || "",
    locationId: location,
    data: { ...unwrapped, ...data },
  };
}

/** Extract documented inbound fields when present. Does not invent missing values. */
export function normalizeHighLevelInboundEvent(payload: Record<string, unknown>): HighLevelInboundFields {
  const parsed = parseHighLevelWebhook(payload);
  const data = asRecord(parsed.data);
  const meta = asRecord(data.meta);
  const messageType = emptyToNull(text(data.messageType) || text(data.messageTypeString));
  const typeLower = parsed.type.toLowerCase();
  const from = emptyToNull(text(data.from) || text(data.fromNumber));
  const to = emptyToNull(text(data.to) || text(data.toNumber));
  const callStatus = emptyToNull(text(data.callStatus) || text(meta.callStatus));
  const callDuration = parseCallDurationSeconds(data.callDuration ?? meta.callDuration);
  const channel = messageType
    ? normalizeHighLevelChannel(messageType)
    : typeLower.includes("call") || typeLower.includes("voicemail") || callStatus || callDuration != null
      ? typeLower.includes("voicemail")
        ? "VOICEMAIL"
        : "CALL"
      : normalizeHighLevelChannel(text(data.type) || parsed.type);
  const direction =
    emptyToNull(text(data.direction)) ||
    (typeLower.includes("outbound") ? "outbound" : typeLower.includes("inbound") ? "inbound" : null);
  const timestamp =
    parseHighLevelDate(data.dateAdded) ?? parseHighLevelDate(data.timestamp) ?? parseHighLevelDate(data.dateCreated) ?? null;
  const recording = extractHighLevelRecordingHint(data.attachments, emptyToNull(text(data.recordingUrl) || text(meta.recordingUrl)));
  return {
    type: parsed.type,
    webhookId: parsed.webhookId,
    locationId: parsed.locationId,
    contactId: emptyToNull(text(data.contactId)),
    conversationId: emptyToNull(text(data.conversationId) || text(data.conversation_id)),
    messageId: emptyToNull(text(data.messageId) || (text(data.id) !== parsed.locationId ? text(data.id) : "") || parsed.webhookId),
    from,
    to,
    direction,
    status: emptyToNull(text(data.status)),
    callStatus,
    callDuration,
    timestamp,
    channel,
    kind: channel || "SMS",
    body: emptyToNull(text(data.body) || text(data.message)),
    contactName: emptyToNull(text(data.full_name) || text(data.contactName) || text(data.name)),
    attachments: data.attachments,
    hasRecording: recording.hasRecording,
    messageType,
  };
}

export function isHighLevelConversationEvent(fields: HighLevelInboundFields) {
  const type = fields.type.toLowerCase();
  if (type.includes("contact") || type.includes("opportunity")) return false;
  return (
    type.includes("message") ||
    type.includes("conversation") ||
    type.includes("inbound") ||
    type.includes("outbound") ||
    type.includes("call") ||
    type.includes("voicemail") ||
    fields.channel === "CALL" ||
    fields.channel === "VOICEMAIL" ||
    fields.channel === "SMS"
  );
}

/** Owner IntegrationConnection only. ProviderTestGrant rows are never webhook targets. */
export async function resolveHighLevelConnectionByLocation(prisma: PrismaClient, locationId: string) {
  if (!locationId) return null;
  return prisma.integrationConnection.findFirst({
    where: {
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      externalAccountId: locationId,
      status: { in: ["CONNECTED", "SYNCING"] },
    },
  });
}

export type HighLevelWebhookProcessResult = {
  processed: boolean;
  duplicate: boolean;
  type: string;
  locationId: string;
  conversationId?: string | null;
  messageId?: string | null;
  contactId?: string | null;
  channel?: string | null;
  direction?: string | null;
  from?: string | null;
  to?: string | null;
  trackingSource?: string | null;
  customerMatched?: boolean;
  leadCreated?: boolean;
  callRecordCreated?: boolean;
  callRecordUpdated?: boolean;
  threadId?: string | null;
  hasRecording?: boolean;
};

export async function processHighLevelWebhook(
  prisma: PrismaClient,
  input: { companyId: string; connectionId: string; payload: Record<string, unknown> }
): Promise<HighLevelWebhookProcessResult> {
  const fields = normalizeHighLevelInboundEvent(input.payload);
  const parsed = parseHighLevelWebhook(input.payload);
  const externalId = fields.webhookId || fields.messageId || `${fields.type}:${JSON.stringify(parsed.data).slice(0, 80)}`;
  const stored = await prisma.integrationEvent.upsert({
    where: {
      companyId_connectionId_externalId: {
        companyId: input.companyId,
        connectionId: input.connectionId,
        externalId,
      },
    },
    create: {
      companyId: input.companyId,
      connectionId: input.connectionId,
      externalId,
      eventType: fields.type,
      payload: input.payload as Prisma.InputJsonValue,
    },
    update: {},
  });
  if (stored.processedAt) {
    return {
      processed: false,
      duplicate: true,
      type: fields.type,
      locationId: fields.locationId,
      conversationId: fields.conversationId,
      messageId: fields.messageId,
      contactId: fields.contactId,
      channel: fields.channel,
      direction: fields.direction,
      from: fields.from,
      to: fields.to,
      hasRecording: fields.hasRecording,
    };
  }

  const data = asRecord(parsed.data);
  const type = fields.type.toLowerCase();
  let comms: Awaited<ReturnType<typeof upsertConversationMessage>> | null = null;

  if (type.includes("contact")) {
    const contactId = fields.contactId || emptyToNull(text(data.id));
    const match = await matchHighLevelContact(prisma, {
      companyId: input.companyId,
      contactId,
      email: emptyToNull(text(data.email)),
      phone: emptyToNull(text(data.phone) || fields.from || ""),
      name: fields.contactName,
    });
    if (match.customerId && contactId) {
      await mapContactToCustomer(prisma, {
        companyId: input.companyId,
        customerId: match.customerId,
        contactId,
      });
    } else if (contactId && (type.includes("create") || type.includes("contactcreate"))) {
      await ingestHighLevelLead(prisma, {
        companyId: input.companyId,
        externalId: contactId,
        firstName: emptyToNull(text(data.firstName) || text(data.first_name)),
        lastName: emptyToNull(text(data.lastName) || text(data.last_name)),
        email: emptyToNull(text(data.email)),
        phone: emptyToNull(text(data.phone)),
        source: emptyToNull(text(data.source) || text(data.contact_source)),
        contactId,
      });
    }
  } else if (type.includes("opportunity")) {
    await ingestHighLevelLead(prisma, {
      companyId: input.companyId,
      role: "opportunity",
      externalId: emptyToNull(text(data.id) || text(data.opportunityId)) || externalId,
      firstName: emptyToNull(text(data.firstName) || text(data.first_name)) || emptyToNull(text(data.contactName).split(" ")[0]),
      lastName: emptyToNull(text(data.lastName) || text(data.last_name)),
      email: emptyToNull(text(data.email)),
      phone: emptyToNull(text(data.phone)),
      source: emptyToNull(text(data.source) || text(data.opportunity_source)),
      campaignName: emptyToNull(text(asRecord(data.campaign).name)),
      message: emptyToNull(text(data.opportunity_name) || text(data.name)),
      contactId: fields.contactId,
    });
  } else if (isHighLevelConversationEvent(fields)) {
    const direction = fields.direction || "inbound";
    let fromNumber = fields.from;
    let toNumber = fields.to;
    if (direction.toLowerCase() === "outbound") {
      const { phonesMatch } = await import("@/lib/phone");
      const { resolveApprovedSenderNumber } = await import("@/lib/highlevel/phone-numbers");
      const approved = await resolveApprovedSenderNumber(prisma, input.companyId);
      if (fromNumber && toNumber && phonesMatch(fromNumber, toNumber) && approved) {
        fromNumber = approved.phoneNumber;
      }
    }
    comms = await upsertConversationMessage(prisma, {
      companyId: input.companyId,
      conversationId: fields.conversationId || externalId,
      messageId: fields.messageId || externalId,
      contactId: fields.contactId,
      contactName: fields.contactName,
      phone: (direction.toLowerCase() === "outbound" ? toNumber : fromNumber) || emptyToNull(text(data.phone)),
      fromNumber,
      toNumber,
      body: fields.body,
      channel: fields.channel,
      direction: fields.direction || "inbound",
      kind: fields.kind,
      occurredAt: fields.timestamp ?? new Date(),
      status: fields.status || fields.callStatus,
      callDuration: fields.callDuration,
      callStatus: fields.callStatus,
      attachments: fields.attachments,
      recordingUrl: fields.hasRecording ? "available" : null,
      locationId: fields.locationId || null,
    });
    if (comms?.thread.id && comms.message && (fields.direction || "inbound").toLowerCase() === "inbound") {
      try {
        const { contractorYouMayAutoreply, loadCustomerConversationOwner } = await import(
          "@/lib/comms/conversation-owner"
        );
        const conversationOwner = await loadCustomerConversationOwner(prisma, input.companyId);
        const inbound = {
          companyId: input.companyId,
          threadId: comms.thread.id,
          customerId: comms.customerId,
          messageId: fields.messageId || comms.message.id,
          body: fields.body,
          direction: comms.message.direction,
          channel: comms.message.channel,
          phone: fields.from || emptyToNull(text(data.phone)),
        };
        const { processSchedulingSessionInbound } = await import("@/lib/agent-tools/scheduling-session");
        const session = await processSchedulingSessionInbound({
          companyId: inbound.companyId,
          threadId: inbound.threadId,
          messageId: inbound.messageId,
          phone: inbound.phone,
          contactId: fields.contactId,
          body: inbound.body,
        });
        if (session.handled) {
          // ContractorYou owns operational scheduling replies while a session is active.
        } else if (contractorYouMayAutoreply(conversationOwner)) {
          const { loadReceptionistSettings, receptionistShouldHandleInbound } = await import(
            "@/lib/intelligence/receptionist/settings"
          );
          const { parseReceptionistV2Mode } = await import("@/lib/intelligence/receptionist/v2/types");
          const receptionist = await loadReceptionistSettings(input.companyId);
          const v2Mode = parseReceptionistV2Mode(receptionist.mode);
          if (v2Mode === "CONTRACTORYOU_AI" || v2Mode === "OFFICE_ONLY") {
            // V2 live or office-only: do not also run V1 / deterministic auto-reply.
          } else if (receptionistShouldHandleInbound(receptionist)) {
            const { processInboundReceptionist } = await import("@/lib/intelligence/receptionist/inbound");
            await processInboundReceptionist(inbound);
          } else {
            const { processInboundScheduling } = await import("@/lib/scheduling/conversation");
            await processInboundScheduling(inbound);
          }
        }
        try {
          const { maybeRunReceptionistV2 } = await import("@/lib/intelligence/receptionist/v2/inbound");
          await maybeRunReceptionistV2({
            companyId: inbound.companyId,
            threadId: inbound.threadId,
            customerId: inbound.customerId,
            messageId: inbound.messageId,
            body: inbound.body,
            phone: inbound.phone,
            contactId: fields.contactId,
            skipLiveSend: session.handled,
          });
        } catch (error) {
          console.error("[receptionist-v2] observe failed", error);
        }
      } catch (error) {
        console.error("[scheduling] inbound conversation handler failed", error);
      }
    } else if (comms?.thread.id && comms.message && (fields.direction || comms.message.direction || "").toLowerCase() === "outbound") {
      try {
        const { attachOutboundToLatestShadowTurn } = await import("@/lib/intelligence/receptionist/v2/inbound");
        await attachOutboundToLatestShadowTurn({
          companyId: input.companyId,
          threadId: comms.thread.id,
          body: fields.body,
        });
      } catch (error) {
        console.error("[receptionist-v2] attach outbound failed", error);
      }
    }
  }

  await prisma.integrationEvent.update({
    where: { id: stored.id },
    data: { processedAt: new Date() },
  });
  await prisma.integrationConnection.update({
    where: { id: input.connectionId },
    data: { lastHealthAt: new Date(), healthMessage: `Last webhook: ${fields.type}` },
  });
  return {
    processed: true,
    duplicate: false,
    type: fields.type,
    locationId: fields.locationId,
    conversationId: fields.conversationId,
    messageId: fields.messageId,
    contactId: fields.contactId,
    channel: fields.channel,
    direction: fields.direction,
    from: fields.from,
    to: fields.to,
    trackingSource: comms?.trackingSource ?? null,
    customerMatched: Boolean(comms?.customerId),
    leadCreated: Boolean(comms?.leadCreated),
    callRecordCreated: Boolean(comms?.callRecordCreated),
    callRecordUpdated: Boolean(comms?.callRecordUpdated),
    threadId: comms?.thread.id ?? null,
    hasRecording: fields.hasRecording,
  };
}
