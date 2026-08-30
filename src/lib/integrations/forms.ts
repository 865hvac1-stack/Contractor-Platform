import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { matchCustomerForLead } from "@/lib/leads/matching";
import { upsertConnection } from "@/lib/integrations/store";

export type FormFieldDef = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "date";
  required: boolean;
};

export const DEFAULT_FORM_FIELDS: FormFieldDef[] = [
  { key: "firstName", label: "First name", type: "text", required: true },
  { key: "lastName", label: "Last name", type: "text", required: true },
  { key: "phone", label: "Phone", type: "phone", required: true },
  { key: "email", label: "Email", type: "email", required: false },
  { key: "address", label: "Address", type: "text", required: false },
  { key: "service", label: "Service requested", type: "text", required: false },
  { key: "preferredAt", label: "Preferred date / time", type: "text", required: false },
  { key: "message", label: "Message", type: "textarea", required: false },
];

export function parseFields(value: unknown): FormFieldDef[] {
  if (!Array.isArray(value)) return DEFAULT_FORM_FIELDS;
  return value.filter((field): field is FormFieldDef => {
    return Boolean(field && typeof field === "object" && "key" in field && "label" in field);
  });
}

export async function markWebsiteProductsLive(companyId: string) {
  await upsertConnection({
    companyId,
    providerKey: "website_forms",
    status: "CONNECTED",
    healthMessage: "Website forms are live.",
    accountLabel: "ContractorYou forms",
  });
  await upsertConnection({
    companyId,
    providerKey: "utm_tracking",
    status: "CONNECTED",
    healthMessage: "UTM capture is on every hosted and embedded form.",
    accountLabel: "First touch / last touch",
  });
}

export async function createLeadFromWebsiteForm(input: {
  formId: string;
  values: Record<string, string>;
  utm: {
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    referrer?: string | null;
    landingPage?: string | null;
    submissionPage?: string | null;
  };
  landingPageId?: string | null;
}) {
  const form = await prisma.websiteForm.findFirst({
    where: { id: input.formId, status: "ACTIVE" },
  });
  if (!form) return { ok: false as const, error: "This form is not accepting submissions." };

  const firstName = (input.values.firstName || input.values.name || "Website").trim();
  const lastName = (input.values.lastName || "Lead").trim();
  const phone = input.values.phone?.trim() || null;
  const email = input.values.email?.trim() || null;
  const match = await matchCustomerForLead(form.companyId, { email, phone });
  const customerId = match?.customer.id ?? null;
  const firstTouch = input.utm.utmSource || input.utm.referrer || "website";
  const lastTouch = input.utm.utmCampaign || input.utm.utmSource || firstTouch;

  const lead = await prisma.lead.create({
    data: {
      companyId: form.companyId,
      customerId,
      source: "WEBSITE",
      sourceDetail: form.name,
      provider: "website_forms",
      firstName,
      lastName,
      phone,
      email,
      message: input.values.message || null,
      utmSource: input.utm.utmSource ?? null,
      utmMedium: input.utm.utmMedium ?? null,
      utmCampaign: input.utm.utmCampaign ?? null,
      utmContent: input.utm.utmContent ?? null,
      utmTerm: input.utm.utmTerm ?? null,
      landingPage: input.utm.landingPage ?? null,
      referrer: input.utm.referrer ?? null,
      submissionPage: input.utm.submissionPage ?? null,
      firstTouch,
      lastTouch,
    },
  });

  await prisma.formSubmission.create({
    data: {
      companyId: form.companyId,
      websiteFormId: form.id,
      landingPageId: input.landingPageId ?? null,
      leadId: lead.id,
      customerId,
      landingPage: input.utm.landingPage ?? null,
      referrer: input.utm.referrer ?? null,
      utmSource: input.utm.utmSource ?? null,
      utmMedium: input.utm.utmMedium ?? null,
      utmCampaign: input.utm.utmCampaign ?? null,
      utmContent: input.utm.utmContent ?? null,
      utmTerm: input.utm.utmTerm ?? null,
      firstTouch,
      lastTouch,
      submissionPage: input.utm.submissionPage ?? null,
      payload: input.values as Prisma.InputJsonValue,
    },
  });

  await markWebsiteProductsLive(form.companyId);
  return { ok: true as const, leadId: lead.id, companyId: form.companyId };
}
