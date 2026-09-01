import type { Prisma, PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { mapContactToCustomer, resolveHighLevelParticipant } from "@/lib/highlevel/contacts";
import { upsertIdentityMap } from "@/lib/highlevel/identity";

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
      lastPreview: (input.body ?? "").slice(0, 240) || kind,
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
      lastPreview: (input.body ?? "").slice(0, 240) || kind,
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
      metadata: {
        contactId: input.contactId,
        callDuration: input.callDuration,
        callStatus: input.callStatus,
        recordingUrl: input.recordingUrl ?? null,
      } as Prisma.InputJsonValue,
    },
    update: {
      body: input.body ?? undefined,
      status: input.status ?? undefined,
    },
  });

  if (kind === "CALL" || kind === "VOICEMAIL") {
    const missed = /missed|voicemail|no-answer|no_answer/i.test(`${input.callStatus ?? ""} ${input.status ?? ""}`);
    const existingCall = await prisma.callRecord.findFirst({
      where: {
        companyId: input.companyId,
        source: "highlevel",
        recordingRef: input.messageId,
      },
    });
    if (!existingCall) {
      await prisma.callRecord.create({
        data: {
          companyId: input.companyId,
          direction: (input.direction || "inbound").toLowerCase(),
          caller: input.phone ?? input.contactName ?? null,
          customerId: match.customerId,
          startedAt: occurredAt,
          durationSeconds: input.callDuration ?? null,
          answered: !missed,
          missed,
          recordingRef: input.recordingUrl || input.messageId,
          source: "highlevel",
        },
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

  return { thread, message, customerId: match.customerId, leadId: match.leadId, bucket: match.bucket };
}
