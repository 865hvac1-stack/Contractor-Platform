import { createVerify, verify as cryptoVerify } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { HIGHLEVEL_ED25519_PUBLIC_KEY, HIGHLEVEL_PROVIDER_KEY, HIGHLEVEL_RSA_PUBLIC_KEY } from "@/lib/highlevel/config";
import { ingestHighLevelLead } from "@/lib/highlevel/leads";
import { matchHighLevelContact, mapContactToCustomer } from "@/lib/highlevel/contacts";
import { upsertConversationMessage } from "@/lib/highlevel/conversations";

export function verifyHighLevelWebhookSignature(input: {
  rawBody: string;
  ghlSignature?: string | null;
  legacySignature?: string | null;
}) {
  if (input.ghlSignature && input.ghlSignature !== "N/A") {
    try {
      const payloadBuffer = Buffer.from(input.rawBody, "utf8");
      const signatureBuffer = Buffer.from(input.ghlSignature, "base64");
      return cryptoVerify(null, payloadBuffer, HIGHLEVEL_ED25519_PUBLIC_KEY, signatureBuffer);
    } catch {
      return false;
    }
  }
  if (input.legacySignature && input.legacySignature !== "N/A") {
    try {
      const verifier = createVerify("SHA256");
      verifier.update(input.rawBody);
      return verifier.verify(HIGHLEVEL_RSA_PUBLIC_KEY, input.legacySignature, "base64");
    } catch {
      return false;
    }
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function parseHighLevelWebhook(payload: Record<string, unknown>) {
  const data = asRecord(payload.data);
  const location =
    text(payload.locationId) ||
    text(asRecord(payload.location).id) ||
    text(data.locationId) ||
    text(asRecord(data.location).id);
  return {
    type: text(payload.type) || text(payload.event) || "Unknown",
    webhookId: text(payload.webhookId) || text(payload.id) || text(payload.messageId) || "",
    locationId: location,
    data: { ...payload, ...data },
  };
}

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

export async function processHighLevelWebhook(
  prisma: PrismaClient,
  input: { companyId: string; connectionId: string; payload: Record<string, unknown> }
) {
  const parsed = parseHighLevelWebhook(input.payload);
  const externalId = parsed.webhookId || `${parsed.type}:${JSON.stringify(parsed.data).slice(0, 80)}`;
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
      eventType: parsed.type,
      payload: input.payload as Prisma.InputJsonValue,
    },
    update: {},
  });
  if (stored.processedAt) {
    return { processed: false, duplicate: true, type: parsed.type };
  }

  const data = asRecord(parsed.data);
  const type = parsed.type.toLowerCase();

  if (type.includes("contact")) {
    const contactId = text(data.id) || text(data.contactId);
    const match = await matchHighLevelContact(prisma, {
      companyId: input.companyId,
      contactId,
      email: text(data.email) || null,
      phone: text(data.phone) || null,
      name: text(data.name) || `${text(data.firstName)} ${text(data.lastName)}`.trim(),
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
        firstName: text(data.firstName) || text(data.first_name),
        lastName: text(data.lastName) || text(data.last_name),
        email: text(data.email) || null,
        phone: text(data.phone) || null,
        source: text(data.source) || text(data.contact_source),
        contactId,
      });
    }
  } else if (type.includes("opportunity")) {
    await ingestHighLevelLead(prisma, {
      companyId: input.companyId,
      externalId: text(data.id) || text(data.opportunityId) || externalId,
      firstName: text(data.firstName) || text(data.first_name) || text(data.contactName).split(" ")[0],
      lastName: text(data.lastName) || text(data.last_name),
      email: text(data.email) || null,
      phone: text(data.phone) || null,
      source: text(data.source) || text(data.opportunity_source),
      campaignName: text(asRecord(data.campaign).name) || null,
      message: text(data.opportunity_name) || text(data.name),
      contactId: text(data.contactId) || null,
    });
  } else if (type.includes("message") || type.includes("conversation") || type.includes("inbound") || type.includes("outbound")) {
    await upsertConversationMessage(prisma, {
      companyId: input.companyId,
      conversationId: text(data.conversationId) || text(data.conversation_id) || externalId,
      messageId: text(data.messageId) || text(data.id) || externalId,
      contactId: text(data.contactId) || null,
      contactName: text(data.full_name) || text(data.contactName) || null,
      phone: text(data.from) || text(data.phone) || null,
      body: text(data.body) || text(data.message) || null,
      channel: text(data.messageType) || text(data.type) || "SMS",
      direction: type.includes("outbound") ? "outbound" : text(data.direction) || "inbound",
      kind: text(data.messageType) || "SMS",
      occurredAt: text(data.dateAdded) ? new Date(text(data.dateAdded)) : new Date(),
      status: text(data.status) || text(data.callStatus) || null,
      callDuration: typeof data.callDuration === "number" ? data.callDuration : null,
      callStatus: text(data.callStatus) || null,
    });
  }

  await prisma.integrationEvent.update({
    where: { id: stored.id },
    data: { processedAt: new Date() },
  });
  await prisma.integrationConnection.update({
    where: { id: input.connectionId },
    data: { lastHealthAt: new Date(), healthMessage: `Last webhook: ${parsed.type}` },
  });
  return { processed: true, duplicate: false, type: parsed.type };
}
