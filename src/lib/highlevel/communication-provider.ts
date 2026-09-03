import { prisma } from "@/lib/db";
import type { SmsSendResult } from "@/lib/communications/sms";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { assertHighLevelLocationToken } from "@/lib/highlevel/location-token";
import { getIdentityMap, upsertIdentityMap } from "@/lib/highlevel/identity";
import { sendHighLevelSms, upsertHighLevelContact } from "@/lib/highlevel/client";
import { resolveApprovedSenderNumber } from "@/lib/highlevel/phone-numbers";

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
    const sender = await resolveApprovedSenderNumber(prisma, input.companyId);
    if (!sender) {
      return {
        ok: false,
        configured: true,
        error: "Set an approved HighLevel sender number in Marketing → Channels → Tracking Numbers before sending SMS.",
      };
    }
    const sent = await sendHighLevelSms({
      accessToken: access.accessToken,
      contactId,
      body: input.body,
      fromNumber: sender.phoneNumber,
      toNumber: input.to,
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
