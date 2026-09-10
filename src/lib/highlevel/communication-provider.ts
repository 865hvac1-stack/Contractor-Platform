import { prisma } from "@/lib/db";
import type { SmsSendResult } from "@/lib/communications/sms";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { assertHighLevelLocationToken } from "@/lib/highlevel/location-token";
import { getIdentityMap, normalizeEmailValue } from "@/lib/highlevel/identity";
import { destinationPhoneForCustomer, linkHighLevelCustomerContact } from "@/lib/highlevel/identity-link";
import { getHighLevelContact, sendHighLevelSms, upsertHighLevelContact } from "@/lib/highlevel/client";
import { resolveApprovedSenderNumber } from "@/lib/highlevel/phone-numbers";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";
import { blockSelfAddressedSms } from "@/lib/comms/sender-guard";

function contactPhone(contact: { phone?: string | null } | null | undefined) {
  return canonicalizeUsPhone(contact?.phone);
}

export async function sendViaHighLevel(input: {
  companyId: string;
  to: string;
  body: string;
  customerId?: string | null;
  leadId?: string | null;
  confirmExternalSend?: boolean;
}): Promise<SmsSendResult> {
  const { demoOutboundBlock } = await import("@/lib/demo/guard");
  const blocked = await demoOutboundBlock(input.companyId);
  if (blocked.blocked && !input.confirmExternalSend) {
    return { ok: false, configured: true, error: blocked.message };
  }
  const access = await loadHighLevelAccess(prisma, input.companyId);
  if (!access) {
    return { ok: false, configured: false, error: "HighLevel is not connected for this company." };
  }
  try {
    assertHighLevelLocationToken(access);
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : "Company token cannot be used for HighLevel Sub-Account APIs.",
    };
  }

  const customer = input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId, companyId: input.companyId },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, secondaryPhone: true },
      })
    : null;
  const destination = destinationPhoneForCustomer({
    requestedTo: input.to,
    customerPhone: customer?.phone,
    secondaryPhone: customer?.secondaryPhone,
  });
  if (!destination) {
    return { ok: false, configured: true, error: "Enter a valid US phone number. Example: 8658514300." };
  }

  try {
    let contactId: string | null = null;
    if (customer) {
      const mapped = await getIdentityMap(prisma, {
        companyId: input.companyId,
        entityType: "CUSTOMER",
        internalId: customer.id,
      });
      if (mapped?.externalId) {
        const existing = await getHighLevelContact({
          accessToken: access.accessToken,
          contactId: mapped.externalId,
        }).catch(() => null);
        if (
          existing?.id &&
          (phonesMatch(existing.phone, destination) ||
            phonesMatch(existing.phone, customer.phone) ||
            normalizeEmailValue(existing.email) === normalizeEmailValue(customer.email))
        ) {
          contactId = existing.id;
        }
      }
    } else if (input.leadId) {
      const mapped = await getIdentityMap(prisma, {
        companyId: input.companyId,
        entityType: "LEAD",
        internalId: input.leadId,
      });
      contactId = mapped?.externalId ?? null;
    }

    if (!contactId) {
      const created = await upsertHighLevelContact({
        accessToken: access.accessToken,
        locationId: access.locationId,
        firstName: customer?.firstName,
        lastName: customer?.lastName,
        email: customer?.email ?? undefined,
        phone: destination,
      });
      contactId = created.contact?.id ?? null;
      const createdPhone = contactPhone(created.contact);
      if (
        contactId &&
        created.contact &&
        !phonesMatch(createdPhone, destination) &&
        !(customer?.email && normalizeEmailValue(created.contact.email) === normalizeEmailValue(customer.email))
      ) {
        return {
          ok: false,
          configured: true,
          error: "HighLevel returned a contact that does not match this customer's phone or email. SMS was not sent.",
        };
      }
    }
    if (!contactId) {
      return { ok: false, configured: true, error: "HighLevel did not return a contact for this phone number." };
    }

    if (customer) {
      const inspected = await getHighLevelContact({
        accessToken: access.accessToken,
        contactId,
      }).catch(() => null);
      const linked = await linkHighLevelCustomerContact(prisma, {
        companyId: input.companyId,
        customerId: customer.id,
        contactId,
        customerPhone: destination,
        customerEmail: customer.email,
        contactPhone: inspected?.phone ?? destination,
        contactEmail: inspected?.email ?? customer.email,
      });
      if (!linked.ok) {
        return { ok: false, configured: true, error: linked.error };
      }
      contactId = linked.contactId;
    }

    const sender = await resolveApprovedSenderNumber(prisma, input.companyId);
    if (!sender) {
      return {
        ok: false,
        configured: true,
        error: "Set an approved HighLevel sender number in Marketing → Channels → Tracking Numbers before sending SMS.",
      };
    }
    const routing = blockSelfAddressedSms({
      from: sender.phoneNumber,
      to: destination,
      customerPhone: customer?.phone ?? destination,
      approvedSender: sender.phoneNumber,
    });
    if (!routing.ok) {
      return { ok: false, configured: true, error: routing.error };
    }
    const sent = await sendHighLevelSms({
      accessToken: access.accessToken,
      contactId,
      body: input.body,
      fromNumber: sender.phoneNumber,
      toNumber: destination,
    });
    return { ok: true, providerId: sent.messageId ?? sent.id ?? sent.conversationId ?? null };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : "HighLevel rejected the SMS.",
    };
  }
}
