"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LeadSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { leadSchema, leadStatusSchema } from "@/lib/validators";
import { findDuplicateLead, matchCustomerForLead } from "@/lib/leads/matching";
import { recordAttribution } from "@/lib/attribution/engine";
import { dollarsToCents } from "@/lib/money";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";
import type { ActionResult } from "@/server/actions/auth";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

export async function createLeadAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("leads:manage");
    const parsed = leadSchema.safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      phone: formData.get("phone") || "",
      email: formData.get("email") || "",
      message: formData.get("message") || "",
      source: formData.get("source") || "MANUAL",
      sourceDetail: formData.get("sourceDetail") || "",
      campaignName: formData.get("campaignName") || "",
      medium: formData.get("medium") || "",
      assignedUserId: formData.get("assignedUserId") || "",
      estimatedOpportunityCents: formData.get("estimatedOpportunity") || "",
      nextAction: formData.get("nextAction") || "",
      utmSource: formData.get("utmSource") || "",
      utmMedium: formData.get("utmMedium") || "",
      utmCampaign: formData.get("utmCampaign") || "",
      utmContent: formData.get("utmContent") || "",
      utmTerm: formData.get("utmTerm") || "",
      landingPage: formData.get("landingPage") || "",
      referrer: formData.get("referrer") || "",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid lead." };
    }

    const d = parsed.data;
    const match = await matchCustomerForLead(ctx.company.id, {
      email: d.email,
      phone: d.phone,
    });
    const duplicate = await findDuplicateLead(ctx.company.id, {
      email: d.email,
      phone: d.phone,
    });

    const opportunityRaw = emptyToNull(d.estimatedOpportunityCents);
    const estimatedOpportunityCents = opportunityRaw ? dollarsToCents(opportunityRaw) : null;

    const lead = await prisma.lead.create({
      data: {
        companyId: ctx.company.id,
        customerId: match?.customer.id ?? null,
        firstName: d.firstName,
        lastName: d.lastName,
        phone: emptyToNull(d.phone),
        email: emptyToNull(d.email),
        message: emptyToNull(d.message),
        source: d.source as LeadSource,
        sourceDetail: emptyToNull(d.sourceDetail),
        campaignName: emptyToNull(d.campaignName),
        medium: emptyToNull(d.medium),
        firstTouch: emptyToNull(d.utmSource) ?? d.source,
        lastTouch: emptyToNull(d.utmSource) ?? d.source,
        assignedUserId: emptyToNull(d.assignedUserId),
        estimatedOpportunityCents,
        nextAction: emptyToNull(d.nextAction),
        utmSource: emptyToNull(d.utmSource),
        utmMedium: emptyToNull(d.utmMedium),
        utmCampaign: emptyToNull(d.utmCampaign),
        utmContent: emptyToNull(d.utmContent),
        utmTerm: emptyToNull(d.utmTerm),
        landingPage: emptyToNull(d.landingPage),
        referrer: emptyToNull(d.referrer),
        submissionPage: emptyToNull(d.landingPage),
        activities: {
          create: {
            companyId: ctx.company.id,
            actorId: ctx.user.id,
            kind: "SYSTEM",
            body: duplicate
              ? `Lead recorded. Possible duplicate of an existing lead.`
              : match
                ? `Matched existing customer on ${match.matchedOn}.`
                : "Lead recorded.",
          },
        },
      },
    });

    if (d.source === "WEBSITE" || d.utmSource || d.landingPage) {
      await prisma.formSubmission.create({
        data: {
          companyId: ctx.company.id,
          leadId: lead.id,
          customerId: match?.customer.id ?? null,
          landingPage: emptyToNull(d.landingPage),
          referrer: emptyToNull(d.referrer),
          utmSource: emptyToNull(d.utmSource),
          utmMedium: emptyToNull(d.utmMedium),
          utmCampaign: emptyToNull(d.utmCampaign),
          utmContent: emptyToNull(d.utmContent),
          utmTerm: emptyToNull(d.utmTerm),
          firstTouch: emptyToNull(d.utmSource) ?? d.source,
          lastTouch: emptyToNull(d.utmSource) ?? d.source,
          submissionPage: emptyToNull(d.landingPage),
        },
      });
    }

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "lead.created",
      entityType: "Lead",
      entityId: lead.id,
      metadata: { source: d.source, matchedCustomer: Boolean(match) },
    });

    revalidatePath("/marketing");
    revalidatePath("/marketing/leads");
    redirect(`/marketing/leads/${lead.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateLeadStatusAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("leads:manage");
    const parsed = leadStatusSchema.safeParse({
      leadId: formData.get("leadId"),
      status: formData.get("status"),
      lostReason: formData.get("lostReason") || "",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid status." };
    }

    const existing = await prisma.lead.findFirst({
      where: scopedCompanyWhere(ctx.company.id, { id: parsed.data.leadId }),
    });
    if (!existing) return { ok: false, error: "Lead not found." };

    const now = new Date();
    const firstRespondedAt =
      existing.firstRespondedAt ??
      (parsed.data.status === "NEW" ? null : now);

    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        lostReason: parsed.data.status === "LOST" ? emptyToNull(parsed.data.lostReason) : existing.lostReason,
        firstRespondedAt,
        lastContactAt: parsed.data.status === "NEW" ? existing.lastContactAt : now,
        convertedAt: parsed.data.status === "WON" ? now : existing.convertedAt,
      },
    });

    await prisma.leadActivity.create({
      data: {
        companyId: ctx.company.id,
        leadId: existing.id,
        actorId: ctx.user.id,
        kind: "STATUS",
        body: `Status changed to ${parsed.data.status.replaceAll("_", " ")}.`,
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "lead.status_changed",
      entityType: "Lead",
      entityId: existing.id,
      metadata: { from: existing.status, to: parsed.data.status },
    });

    revalidatePath("/marketing");
    revalidatePath("/marketing/leads");
    revalidatePath(`/marketing/leads/${existing.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function convertLeadToCustomerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("leads:manage");
    const leadId = String(formData.get("leadId") || "");
    const lead = await prisma.lead.findFirst({
      where: scopedCompanyWhere(ctx.company.id, { id: leadId }),
    });
    if (!lead) return { ok: false, error: "Lead not found." };

    let customerId = lead.customerId;
    if (!customerId) {
      const match = await matchCustomerForLead(ctx.company.id, {
        email: lead.email,
        phone: lead.phone,
      });
      if (match) {
        customerId = match.customer.id;
      } else {
        const customer = await prisma.customer.create({
          data: {
            companyId: ctx.company.id,
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            phone: lead.phone,
            status: "LEAD",
            source: lead.source,
          },
        });
        customerId = customer.id;
        await writeAudit({
          companyId: ctx.company.id,
          actorId: ctx.user.id,
          action: "customer.created",
          entityType: "Customer",
          entityId: customer.id,
          metadata: { fromLeadId: lead.id },
        });
      }
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { customerId },
    });

    await recordAttribution({
      companyId: ctx.company.id,
      leadId: lead.id,
      customerId,
      model: "PRIMARY_SOURCE",
      source: lead.source,
      campaignId: lead.campaignId,
      note: "Lead linked to customer.",
    });

    await prisma.leadActivity.create({
      data: {
        companyId: ctx.company.id,
        leadId: lead.id,
        actorId: ctx.user.id,
        kind: "SYSTEM",
        body: "Linked to a customer record.",
      },
    });

    revalidatePath("/customers");
    revalidatePath("/marketing/leads");
    revalidatePath(`/marketing/leads/${lead.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function addLeadNoteAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("leads:manage");
    const leadId = String(formData.get("leadId") || "");
    const body = String(formData.get("body") || "").trim();
    if (!body) return { ok: false, error: "Note is required." };

    const lead = await prisma.lead.findFirst({
      where: scopedCompanyWhere(ctx.company.id, { id: leadId }),
    });
    if (!lead) return { ok: false, error: "Lead not found." };

    await prisma.leadActivity.create({
      data: {
        companyId: ctx.company.id,
        leadId: lead.id,
        actorId: ctx.user.id,
        kind: "NOTE",
        body,
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastContactAt: new Date(),
        firstRespondedAt: lead.firstRespondedAt ?? new Date(),
      },
    });

    revalidatePath(`/marketing/leads/${lead.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
