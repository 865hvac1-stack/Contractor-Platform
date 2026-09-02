import type { Prisma, PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { mapContactToCustomer, resolveHighLevelParticipant } from "@/lib/highlevel/contacts";
import { upsertIdentityMap } from "@/lib/highlevel/identity";
import { extractHighLevelRecordingHint } from "@/lib/highlevel/attachments";
import { findTrackingNumberByPhone } from "@/lib/highlevel/phone-numbers";
import { ingestHighLevelLead } from "@/lib/highlevel/leads";
import { recordAttribution } from "@/lib/attribution/engine";

export async function upsertConversationThread(
  prisma: PrismaClient,
  input: {
    companyId: string;
    conversationId: string;
    channel?: string | null;
    contactId?: string | null;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    lastPreview?: string | null;
    lastActivityAt?: Date;
    unread?: boolean;
  }
) {
  const match = await resolveHighLevelParticipant(prisma, {
    companyId: input.companyId,
    contactId: input.contactId,
    email: input.email,
    phone: input.phone,
    name: input.contactName,
  });
  if (match.customerId && input.contactId) {
    await mapContactToCustomer(prisma, {
      companyId: input.companyId,
      customerId: match.customerId,
      contactId: input.contactId,
    });
  }
  const thread = await prisma.communicationThread.upsert({
    where: {
      companyId_provider_externalId: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        externalId: input.conversationId,
      },
    },
    create: {
      companyId: input.companyId,
      provider: HIGHLEVEL_PROVIDER_KEY,
      externalId: input.conversationId,
      channel: (input.channel || "SMS").toUpperCase(),
      customerId: match.customerId,
      leadId: match.leadId,
      externalContactId: input.contactId ?? null,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      lastPreview: (input.lastPreview ?? "").slice(0, 240) || null,
      lastActivityAt: input.lastActivityAt ?? new Date(),
      unread: input.unread ?? false,
    },
    update: {
      customerId: match.customerId ?? undefined,
      leadId: match.leadId ?? undefined,
      externalContactId: input.contactId ?? undefined,
      contactName: input.contactName ?? undefined,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      lastPreview: input.lastPreview ? input.lastPreview.slice(0, 240) : undefined,
      lastActivityAt: input.lastActivityAt ?? undefined,
      unread: input.unread,
    },
  });
  if (input.contactId) {
    await upsertIdentityMap(prisma, {
      companyId: input.companyId,
      entityType: "CONTACT",
      internalId: thread.id,
      externalId: input.contactId,
    });
  }
  return { thread, customerId: match.customerId, leadId: match.leadId, bucket: match.bucket, kind: match.kind };
}

export async function upsertConversationMessage(
  prisma: PrismaClient,
  input: {
    companyId: string;
    conversationId: string;
    messageId: string;
    contactId?: string | null;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    body?: string | null;
    channel?: string | null;
    direction?: string | null;
    kind?: string | null;
    occurredAt?: Date;
    status?: string | null;
    unread?: boolean;
    callDuration?: number | null;
    callStatus?: string | null;
    recordingUrl?: string | null;
    attachments?: unknown;
    toNumber?: string | null;
    fromNumber?: string | null;
    locationId?: string | null;
  }
) {
  const match = await resolveHighLevelParticipant(prisma, {
    companyId: input.companyId,
    contactId: input.contactId,
    email: input.email,
    phone: input.phone,
    name: input.contactName,
  });
  if (match.customerId && input.contactId) {
    await mapContactToCustomer(prisma, {
      companyId: input.companyId,
      customerId: match.customerId,
      contactId: input.contactId,
    });
  }

  const channel = (input.channel || input.kind || "SMS").toUpperCase();
  const kind = (input.kind || channel).toUpperCase();
  const occurredAt = input.occurredAt ?? new Date();
  const isCall = kind === "CALL" || kind === "VOICEMAIL";
  const tracking = isCall ? await findTrackingNumberByPhone(prisma, input.companyId, input.toNumber) : null;
  const hasRecording = extractHighLevelRecordingHint(input.attachments, input.recordingUrl).hasRecording;
  const messageMetadata = {
    provider: HIGHLEVEL_PROVIDER_KEY,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId,
    messageId: input.messageId,
    locationId: input.locationId ?? null,
    callDuration: input.callDuration ?? null,
    callStatus: input.callStatus ?? null,
    hasRecording,
    toNumber: input.toNumber ?? null,
    fromNumber: input.fromNumber ?? input.phone ?? null,
    trackingSource: tracking?.source ?? null,
    trackingNumber: tracking?.phoneNumber ?? input.toNumber ?? null,
  };
  const thread = await prisma.communicationThread.upsert({
    where: {
      companyId_provider_externalId: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        externalId: input.conversationId,
      },
    },
    create: {
      companyId: input.companyId,
      provider: HIGHLEVEL_PROVIDER_KEY,
      externalId: input.conversationId,
      channel,
      customerId: match.customerId,
      leadId: match.leadId,
      externalContactId: input.contactId ?? null,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      lastPreview: (input.body ?? "").slice(0, 240) || (isCall ? "Inbound Call" : kind),
      lastActivityAt: occurredAt,
      unread: input.unread ?? input.direction === "inbound",
    },
    update: {
      channel,
      customerId: match.customerId ?? undefined,
      leadId: match.leadId ?? undefined,
      externalContactId: input.contactId ?? undefined,
      contactName: input.contactName ?? undefined,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      lastPreview: (input.body ?? "").slice(0, 240) || (isCall ? "Inbound Call" : kind),
      lastActivityAt: occurredAt,
      unread: input.unread ?? input.direction === "inbound",
    },
  });
  if (input.contactId) {
    await upsertIdentityMap(prisma, {
      companyId: input.companyId,
      entityType: "CONTACT",
      internalId: thread.id,
      externalId: input.contactId,
    });
  }

  const message = await prisma.communicationMessage.upsert({
    where: {
      companyId_provider_externalId: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        externalId: input.messageId,
      },
    },
    create: {
      companyId: input.companyId,
      threadId: thread.id,
      provider: HIGHLEVEL_PROVIDER_KEY,
      externalId: input.messageId,
      direction: (input.direction || "inbound").toUpperCase(),
      channel,
      kind,
      body: input.body ?? null,
      occurredAt,
      status: input.status ?? null,
      metadata: messageMetadata as Prisma.InputJsonValue,
    },
    update: {
      body: input.body ?? undefined,
      status: input.status ?? undefined,
      metadata: messageMetadata as Prisma.InputJsonValue,
    },
  });

  let leadId = match.leadId;
  let leadCreated = false;
  let callRecordCreated = false;
  let callRecordUpdated = false;

  if (isCall) {
    const missed = /missed|voicemail|no-answer|no_answer/i.test(`${input.callStatus ?? ""} ${input.status ?? ""}`);
    const existingCall = await prisma.callRecord.findFirst({
      where: {
        companyId: input.companyId,
        recordingRef: input.messageId,
      },
    });
    if (existingCall) {
      await prisma.callRecord.update({
        where: { id: existingCall.id },
        data: {
          durationSeconds: input.callDuration ?? existingCall.durationSeconds,
          answered: input.callStatus || input.status ? !missed : existingCall.answered,
          missed: input.callStatus || input.status ? missed : existingCall.missed,
          source: tracking?.source ?? existingCall.source,
          campaign: tracking?.campaign ?? existingCall.campaign,
          trackingNumber: tracking?.phoneNumber ?? existingCall.trackingNumber ?? input.toNumber ?? null,
          caller: input.fromNumber ?? input.phone ?? existingCall.caller,
          customerId: match.customerId ?? existingCall.customerId,
          leadId: leadId ?? existingCall.leadId,
        },
      });
      callRecordUpdated = true;
    } else {
      if (!match.customerId && !leadId && (input.direction || "inbound").toLowerCase() === "inbound") {
        const ingested = await ingestHighLevelLead(prisma, {
          companyId: input.companyId,
          externalId: input.contactId || input.messageId,
          firstName: input.contactName?.split(" ")[0] || "Unknown",
          lastName: input.contactName?.split(" ").slice(1).join(" ") || "Caller",
          phone: input.fromNumber || input.phone || null,
          source: tracking?.source && tracking.source !== "HIGHLEVEL" ? tracking.source : "Missed call",
          campaignName: tracking?.campaign,
          contactId: input.contactId,
          receivedAt: occurredAt,
          message: `Inbound ${kind.toLowerCase()} to ${input.toNumber || "HighLevel number"}`,
        });
        leadId = ingested.lead.id;
        leadCreated = ingested.created;
      }
      await prisma.callRecord.create({
        data: {
          companyId: input.companyId,
          direction: (input.direction || "inbound").toLowerCase(),
          trackingNumber: tracking?.phoneNumber ?? input.toNumber ?? null,
          source: tracking?.source ?? "highlevel",
          campaign: tracking?.campaign ?? null,
          caller: input.fromNumber ?? input.phone ?? input.contactName ?? null,
          customerId: match.customerId,
          leadId,
          startedAt: occurredAt,
          durationSeconds: input.callDuration ?? null,
          answered: !missed,
          missed,
          recordingRef: input.messageId,
        },
      });
      callRecordCreated = true;
      if (tracking && (match.customerId || leadId)) {
        await recordAttribution({
          companyId: input.companyId,
          leadId,
          customerId: match.customerId,
          model: "PRIMARY_SOURCE",
          source: tracking.source,
          campaignId: tracking.campaign,
          note: `Inbound ${kind.toLowerCase()} to tracking number ${tracking.phoneNumber}. Revenue is recorded later when a job is sold.`,
        });
      }
    }
    if (leadId && !thread.leadId) {
      await prisma.communicationThread.update({
        where: { id: thread.id },
        data: { leadId },
      });
    }
  }

  if (input.contactId && match.customerId) {
    await upsertIdentityMap(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      internalId: match.customerId,
      externalId: input.contactId,
    });
  }

  return {
    thread,
    message,
    customerId: match.customerId,
    leadId,
    bucket: match.bucket,
    trackingSource: tracking?.source ?? null,
    leadCreated,
    callRecordCreated,
    callRecordUpdated,
  };
}
