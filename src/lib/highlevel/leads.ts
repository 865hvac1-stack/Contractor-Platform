import type { LeadSource, PrismaClient } from "@prisma/client";
import { upsertExternalLead } from "@/lib/integrations/ingest";
import { upsertIdentityMap } from "@/lib/highlevel/identity";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { mapContactToCustomer, matchHighLevelContact } from "@/lib/highlevel/contacts";

export function highlevelLeadSource(raw?: string | null): LeadSource {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("facebook") || value.includes("fb")) return "FACEBOOK";
  if (value.includes("instagram")) return "INSTAGRAM";
  if (value.includes("google") && value.includes("lsa")) return "GOOGLE_LSA";
  if (value.includes("google") && value.includes("ads")) return "GOOGLE_ADS";
  if (value.includes("google")) return "ORGANIC_SEARCH";
  if (value.includes("tiktok")) return "TIKTOK";
  if (value.includes("linkedin")) return "LINKEDIN";
  if (value.includes("sms") || value.includes("text")) return "SMS";
  if (value.includes("call") || value.includes("phone")) return "PHONE";
  if (value.includes("email")) return "EMAIL";
  if (value.includes("chat") || value.includes("web") || value.includes("form")) return "WEBSITE";
  if (value.includes("referral")) return "REFERRAL";
  return "OTHER";
}

export async function ingestHighLevelLead(
  prisma: PrismaClient,
  input: {
    companyId: string;
    externalId: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    source?: string | null;
    message?: string | null;
    campaignName?: string | null;
    contactId?: string | null;
    receivedAt?: Date;
  }
) {
  const match = await matchHighLevelContact(prisma, {
    companyId: input.companyId,
    contactId: input.contactId,
    email: input.email,
    phone: input.phone,
    name: `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim(),
  });
  if (match.customerId && input.contactId) {
    await mapContactToCustomer(prisma, {
      companyId: input.companyId,
      customerId: match.customerId,
      contactId: input.contactId,
    });
  }

  const result = await upsertExternalLead({
    companyId: input.companyId,
    provider: HIGHLEVEL_PROVIDER_KEY,
    externalLeadId: input.externalId,
    source: highlevelLeadSource(input.source),
    firstName: input.firstName || "Unknown",
    lastName: input.lastName || "Lead",
    phone: input.phone,
    email: input.email,
    sourceDetail: input.source ?? "HighLevel",
    campaignName: input.campaignName,
    message: input.message,
    receivedAt: input.receivedAt,
  });

  await upsertIdentityMap(prisma, {
    companyId: input.companyId,
    entityType: "LEAD",
    internalId: result.lead.id,
    externalId: input.externalId,
  });
  if (input.contactId && result.lead.id) {
    await upsertIdentityMap(prisma, {
      companyId: input.companyId,
      entityType: "LEAD",
      internalId: `${result.lead.id}:contact`,
      externalId: input.contactId,
    }).catch(() => undefined);
  }
  return { ...result, customerId: match.customerId, matchKind: match.kind };
}
