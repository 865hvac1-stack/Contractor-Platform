import type { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { getIdentityMap, normalizeEmailValue, normalizePhoneDigits, upsertIdentityMap } from "@/lib/highlevel/identity";

export type ContactMatchKind = "external_id" | "email" | "phone" | "none" | "name_only_ignored";
export type ParticipantMatchKind = ContactMatchKind | "lead_external_id" | "lead_email" | "lead_phone";
export type ConversationBucket = "mapped" | "provider_only" | "unmatched";

export type ContactMatch = {
  customerId: string | null;
  kind: ContactMatchKind;
};

export type ParticipantMatch = {
  customerId: string | null;
  leadId: string | null;
  kind: ParticipantMatchKind;
  bucket: ConversationBucket;
};

/**
 * Conservative identity match. Name-only never auto-merges.
 */
export async function matchHighLevelContact(
  prisma: PrismaClient,
  input: { companyId: string; contactId?: string | null; email?: string | null; phone?: string | null; name?: string | null }
): Promise<ContactMatch> {
  if (input.contactId) {
    const mapped = await getIdentityMap(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      externalId: input.contactId,
    });
    if (mapped) return { customerId: mapped.internalId, kind: "external_id" };
  }

  const email = normalizeEmailValue(input.email);
  if (email) {
    const byEmail = await prisma.customer.findFirst({
      where: { companyId: input.companyId, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (byEmail) return { customerId: byEmail.id, kind: "email" };
  }

  const phone = normalizePhoneDigits(input.phone);
  if (phone) {
    const candidates = await prisma.customer.findMany({
      where: { companyId: input.companyId, status: { not: "ARCHIVED" }, OR: [{ phone: { not: null } }, { secondaryPhone: { not: null } }] },
      select: { id: true, phone: true, secondaryPhone: true },
      take: 2000,
    });
    const hit = candidates.find(
      (row) => normalizePhoneDigits(row.phone) === phone || normalizePhoneDigits(row.secondaryPhone) === phone
    );
    if (hit) return { customerId: hit.id, kind: "phone" };
  }

  if (input.name?.trim()) return { customerId: null, kind: "name_only_ignored" };
  return { customerId: null, kind: "none" };
}

function leadIdFromMap(internalId: string) {
  return internalId.split(":")[0] || internalId;
}

export async function resolveHighLevelParticipant(
  prisma: PrismaClient,
  input: { companyId: string; contactId?: string | null; email?: string | null; phone?: string | null; name?: string | null }
): Promise<ParticipantMatch> {
  const customer = await matchHighLevelContact(prisma, input);
  if (customer.customerId) {
    return { customerId: customer.customerId, leadId: null, kind: customer.kind, bucket: "mapped" };
  }

  if (input.contactId) {
    const byContact = await prisma.providerIdentityMap.findMany({
      where: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "LEAD",
        externalId: input.contactId,
      },
    });
    const preferred = byContact.find((row) => !row.internalId.includes(":")) ?? byContact[0];
    if (preferred) {
      return {
        customerId: null,
        leadId: leadIdFromMap(preferred.internalId),
        kind: "lead_external_id",
        bucket: "provider_only",
      };
    }
  }

  const email = normalizeEmailValue(input.email);
  if (email) {
    const byEmail = await prisma.lead.findFirst({
      where: { companyId: input.companyId, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (byEmail) return { customerId: null, leadId: byEmail.id, kind: "lead_email", bucket: "provider_only" };
  }

  const phone = normalizePhoneDigits(input.phone);
  if (phone) {
    const candidates = await prisma.lead.findMany({
      where: { companyId: input.companyId, phone: { not: null } },
      select: { id: true, phone: true },
      take: 2000,
    });
    const hit = candidates.find((row) => normalizePhoneDigits(row.phone) === phone);
    if (hit) return { customerId: null, leadId: hit.id, kind: "lead_phone", bucket: "provider_only" };
  }

  if (input.contactId) {
    return { customerId: null, leadId: null, kind: customer.kind, bucket: "provider_only" };
  }
  return { customerId: null, leadId: null, kind: customer.kind, bucket: "unmatched" };
}

export async function mapContactToCustomer(
  prisma: PrismaClient,
  input: { companyId: string; customerId: string; contactId: string }
) {
  return upsertIdentityMap(prisma, {
    companyId: input.companyId,
    entityType: "CUSTOMER",
    internalId: input.customerId,
    externalId: input.contactId,
  });
}
