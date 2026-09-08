import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { getIdentityMap, normalizeEmailValue, upsertIdentityMap } from "@/lib/highlevel/identity";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";

export type HighLevelIdentityLinkResult =
  | { ok: true; contactId: string; reused: boolean; repaired: boolean }
  | { ok: false; error: string };

function emailsMatch(left?: string | null, right?: string | null) {
  const a = normalizeEmailValue(left);
  const b = normalizeEmailValue(right);
  return Boolean(a && b && a === b);
}

function strongMatch(input: {
  customerPhone?: string | null;
  customerEmail?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}) {
  return (
    phonesMatch(input.customerPhone, input.contactPhone) || emailsMatch(input.customerEmail, input.contactEmail)
  );
}

/**
 * Link a HighLevel contactId to one ContractorYou customer in this company.
 * Reuses the existing (companyId, provider, entityType, externalId) row.
 * Never name-only. Never inserts a colliding identity.
 */
export async function linkHighLevelCustomerContact(
  prisma: PrismaClient,
  input: {
    companyId: string;
    customerId: string;
    contactId: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    actorId?: string | null;
  }
): Promise<HighLevelIdentityLinkResult> {
  const contactId = input.contactId.trim();
  if (!contactId) return { ok: false, error: "HighLevel contact id is missing." };

  const [byCustomer, byContact] = await Promise.all([
    getIdentityMap(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      internalId: input.customerId,
    }),
    getIdentityMap(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      externalId: contactId,
    }),
  ]);

  if (byCustomer && byContact && byCustomer.id === byContact.id) {
    return { ok: true, contactId, reused: true, repaired: false };
  }

  if (byCustomer && !byContact) {
    if (byCustomer.externalId === contactId) {
      return { ok: true, contactId, reused: true, repaired: false };
    }
    const thisMatches = strongMatch(input);
    if (!thisMatches) {
      return {
        ok: false,
        error:
          "This customer is already linked to a different HighLevel contact, and the new contact does not match phone or email.",
      };
    }
    await prisma.providerIdentityMap.update({
      where: { id: byCustomer.id },
      data: { externalId: contactId },
    });
    if (input.actorId) {
      await writeAudit({
        companyId: input.companyId,
        actorId: input.actorId,
        action: "highlevel.identity_repaired",
        entityType: "ProviderIdentityMap",
        entityId: byCustomer.id,
        metadata: {
          customerId: input.customerId,
          previousExternalId: byCustomer.externalId,
          contactId,
          reason: "stale_customer_mapping",
        },
      });
    }
    return { ok: true, contactId, reused: false, repaired: true };
  }

  if (byContact && byContact.internalId !== input.customerId) {
    const other = await prisma.customer.findFirst({
      where: { id: byContact.internalId, companyId: input.companyId },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, secondaryPhone: true },
    });
    const thisMatches = strongMatch(input);
    const otherMatches = other
      ? phonesMatch(other.phone, input.contactPhone) ||
        phonesMatch(other.secondaryPhone, input.contactPhone) ||
        emailsMatch(other.email, input.contactEmail)
      : false;

    if (thisMatches && otherMatches) {
      return {
        ok: false,
        error: `This HighLevel contact is already linked to ${other?.firstName ?? "another"} ${other?.lastName ?? "customer"} in this company. Text that customer, or keep these records separate.`,
      };
    }
    if (!thisMatches) {
      return {
        ok: false,
        error:
          "This HighLevel contact is already linked to another customer and does not match this customer's phone or email.",
      };
    }

    if (byCustomer && byCustomer.id !== byContact.id) {
      return {
        ok: false,
        error: "HighLevel contact identity conflicts with an existing customer mapping. SMS was not sent.",
      };
    }

    await prisma.providerIdentityMap.update({
      where: { id: byContact.id },
      data: { internalId: input.customerId },
    });
    if (input.actorId) {
      await writeAudit({
        companyId: input.companyId,
        actorId: input.actorId,
        action: "highlevel.identity_repaired",
        entityType: "ProviderIdentityMap",
        entityId: byContact.id,
        metadata: {
          customerId: input.customerId,
          previousCustomerId: byContact.internalId,
          contactId,
          reason: "stale_external_mapping",
          provider: HIGHLEVEL_PROVIDER_KEY,
        },
      });
    }
    return { ok: true, contactId, reused: false, repaired: true };
  }

  const mapped = await upsertIdentityMap(prisma, {
    companyId: input.companyId,
    entityType: "CUSTOMER",
    internalId: input.customerId,
    externalId: contactId,
  });
  if (mapped.internalId !== input.customerId || mapped.externalId !== contactId) {
    return {
      ok: false,
      error: "HighLevel contact identity could not be linked without creating a duplicate mapping.",
    };
  }
  return { ok: true, contactId, reused: Boolean(byCustomer || byContact), repaired: false };
}

export function destinationPhoneForCustomer(input: {
  requestedTo?: string | null;
  customerPhone?: string | null;
  secondaryPhone?: string | null;
}) {
  return (
    canonicalizeUsPhone(input.requestedTo) ||
    canonicalizeUsPhone(input.customerPhone) ||
    canonicalizeUsPhone(input.secondaryPhone)
  );
}
