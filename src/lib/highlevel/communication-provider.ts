import { prisma } from "@/lib/db";
import type { SmsSendResult } from "@/lib/communications/sms";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { getIdentityMap, upsertIdentityMap } from "@/lib/highlevel/identity";
import { sendHighLevelSms, upsertHighLevelContact } from "@/lib/highlevel/client";

export async function sendViaHighLevel(input: {
  companyId: string;
  to: string;
  body: string;
  customerId?: string | null;
  leadId?: string | null;
}): Promise<SmsSendResult> {
  const access = await loadHighLevelAccess(prisma, input.companyId);
  if (!access) {
    return { ok: false, configured: false, error: "HighLevel is not connected for this company." };
  }
  if (!input.to.trim()) {
    return { ok: false, configured: true, error: "No customer phone number to text." };
  }

  try {
    let contactId: string | null = null;
    if (input.customerId) {
      const mapped = await getIdentityMap(prisma, {
        companyId: input.companyId,
        entityType: "CUSTOMER",
        internalId: input.customerId,
      });
      contactId = mapped?.externalId ?? null;
    }
    if (!contactId && input.leadId) {
      const mapped = await getIdentityMap(prisma, {
        companyId: input.companyId,
        entityType: "LEAD",
        internalId: input.leadId,
      });
      contactId = mapped?.externalId ?? null;
    }
    if (!contactId) {
      const customer = input.customerId
        ? await prisma.customer.findFirst({
            where: { id: input.customerId, companyId: input.companyId },
            select: { firstName: true, lastName: true, email: true, phone: true },
          })
        : null;
      const created = await upsertHighLevelContact({
        accessToken: access.accessToken,
        locationId: access.locationId,
        firstName: customer?.firstName,
        lastName: customer?.lastName,
        email: customer?.email ?? undefined,
        phone: input.to,
      });
      contactId = created.contact?.id ?? null;
      if (contactId && input.customerId) {
        await upsertIdentityMap(prisma, {
          companyId: input.companyId,
          entityType: "CUSTOMER",
          internalId: input.customerId,
          externalId: contactId,
        });
      }
    }
    if (!contactId) {
      return { ok: false, configured: true, error: "HighLevel did not return a contact for this phone number." };
    }
    const sent = await sendHighLevelSms({
      accessToken: access.accessToken,
      contactId,
      body: input.body,
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
