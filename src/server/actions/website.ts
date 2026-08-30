"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { DEFAULT_FORM_FIELDS, markWebsiteProductsLive } from "@/lib/integrations/forms";
import { upsertConnection } from "@/lib/integrations/store";
import type { ActionResult } from "@/server/actions/auth";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || `form-${Date.now()}`;
}

export async function createWebsiteFormAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Give the form a name." };
    await prisma.websiteForm.create({
      data: {
        companyId: ctx.company.id,
        name,
        slug: slugify(name),
        fields: DEFAULT_FORM_FIELDS,
        status: "ACTIVE",
      },
    });
    await markWebsiteProductsLive(ctx.company.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "website_form.created",
      entityType: "WebsiteForm",
      metadata: { name },
    });
    revalidatePath("/marketing/forms");
    revalidatePath("/marketing/channels");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createLandingPageAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const name = String(formData.get("name") || "").trim();
    const headline = String(formData.get("headline") || "").trim();
    const body = String(formData.get("body") || "").trim();
    const formId = String(formData.get("formId") || "") || null;
    if (!name || !headline) return { ok: false, error: "Name and headline are required." };
    await prisma.landingPage.create({
      data: {
        companyId: ctx.company.id,
        formId,
        name,
        slug: slugify(name),
        headline,
        body: body || "Tell us what you need. We will call you back.",
        ctaLabel: String(formData.get("ctaLabel") || "Request service"),
        status: "PUBLISHED",
      },
    });
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: "landing_pages",
      status: "CONNECTED",
      healthMessage: "Landing pages are live.",
      accountLabel: name,
    });
    revalidatePath("/marketing/forms");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createTrackingNumberAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const phoneNumber = String(formData.get("phoneNumber") || "").trim();
    const source = String(formData.get("source") || "WEBSITE").trim();
    if (!phoneNumber) return { ok: false, error: "Enter a number to map." };
    await prisma.trackingNumber.create({
      data: {
        companyId: ctx.company.id,
        phoneNumber,
        source,
        campaign: String(formData.get("campaign") || "") || null,
        channel: String(formData.get("channel") || "") || null,
        provider: "manual",
        status: "ACTIVE",
      },
    });
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: "tracking_numbers",
      status: "CONNECTED",
      accountLabel: phoneNumber,
      healthMessage: "Number mapped to a source. Incoming calls inherit this attribution when telephony is connected.",
    });
    revalidatePath("/marketing/forms");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
