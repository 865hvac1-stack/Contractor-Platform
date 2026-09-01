import type { PrismaClient } from "@prisma/client";
import { getIdentityMap, normalizeEmailValue, normalizePhoneDigits, upsertIdentityMap } from "@/lib/highlevel/identity";

export type ContactMatchKind = "external_id" | "email" | "phone" | "none" | "name_only_ignored";

export type ContactMatch = {
  customerId: string | null;
  kind: ContactMatchKind;
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
