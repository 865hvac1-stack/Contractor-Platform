"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LeadSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
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
      metadata: {
        from: existing.status,
        to: parsed.data.status,
        lostReason: parsed.data.status === "LOST" ? emptyToNull(parsed.data.lostReason) : undefined,
      },
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

export type ConvertLeadResult = ActionResult & {
  matchId?: string;
  matchName?: string;
};

async function attachLeadCustomer(input: {
  companyId: string;
  actorId: string;
  leadId: string;
  customerId: string;
  source: LeadSource;
  campaignId?: string | null;
  body: string;
}) {
  await prisma.lead.update({
    where: { id: input.leadId },
    data: { customerId: input.customerId },
  });
  await recordAttribution({
    companyId: input.companyId,
    leadId: input.leadId,
    customerId: input.customerId,
    model: "PRIMARY_SOURCE",
    source: input.source,
    campaignId: input.campaignId ?? undefined,
    note: "Lead linked to customer.",
  });
  await prisma.leadActivity.create({
    data: {
      companyId: input.companyId,
      leadId: input.leadId,
      actorId: input.actorId,
      kind: "SYSTEM",
      body: input.body,
    },
  });
}

export async function linkLeadToCustomerAction(
  _prev: ConvertLeadResult | null,
  formData: FormData
): Promise<ConvertLeadResult> {
  try {
    const ctx = await requirePermission("leads:manage");
    const leadId = String(formData.get("leadId") || "");
    const customerId = String(formData.get("customerId") || "");
    const lead = await prisma.lead.findFirst({
      where: scopedCompanyWhere(ctx.company.id, { id: leadId }),
    });
    if (!lead) return { ok: false, error: "Lead not found." };
    if (lead.customerId) return { ok: false, error: "This lead is already linked to a customer." };
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.company.id, status: { not: "ARCHIVED" } },
    });
    if (!customer) return { ok: false, error: "Select an existing customer to link." };

    await attachLeadCustomer({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      leadId: lead.id,
      customerId: customer.id,
      source: lead.source,
      campaignId: lead.campaignId,
      body: `Linked to existing customer ${customer.firstName} ${customer.lastName}.`,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "lead.customer_linked",
      entityType: "Lead",
      entityId: lead.id,
      metadata: { customerId: customer.id },
    });
    revalidatePath("/customers");
    revalidatePath("/office");
    revalidatePath("/marketing/leads");
    revalidatePath(`/marketing/leads/${lead.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function convertLeadToCustomerAction(
  _prev: ConvertLeadResult | null,
  formData: FormData
): Promise<ConvertLeadResult> {
  try {
    const ctx = await requirePermission("leads:manage");
    if (!can(ctx.role, "customers:manage")) {
      return { ok: false, error: "You do not have permission to create customers." };
    }
    const leadId = String(formData.get("leadId") || "");
    const confirmCreate = String(formData.get("confirmCreate") || "") === "1";
    const lead = await prisma.lead.findFirst({
      where: scopedCompanyWhere(ctx.company.id, { id: leadId }),
    });
    if (!lead) return { ok: false, error: "Lead not found." };
    if (lead.customerId) return { ok: false, error: "This lead is already linked to a customer." };

    const firstName = emptyToNull(String(formData.get("firstName") || "")) || lead.firstName;
    const lastName = emptyToNull(String(formData.get("lastName") || "")) || lead.lastName;
    const phone = emptyToNull(String(formData.get("phone") || "")) ?? lead.phone;
    const email = emptyToNull(String(formData.get("email") || "")) ?? lead.email;
    const businessName = emptyToNull(String(formData.get("businessName") || ""));

    const match = await matchCustomerForLead(ctx.company.id, { email, phone });
    if (match && !confirmCreate) {
      return {
        ok: false,
        error: `A customer already matches this ${match.matchedOn}. Link them instead of creating a duplicate.`,
        matchId: match.customer.id,
        matchName: `${match.customer.firstName} ${match.customer.lastName}`.trim(),
      };
    }

    const customer = await prisma.customer.create({
      data: {
        companyId: ctx.company.id,
        firstName,
        lastName,
        email,
        phone,
        businessName,
        status: "LEAD",
        source: lead.source,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "customer.created",
      entityType: "Customer",
      entityId: customer.id,
      metadata: { fromLeadId: lead.id, confirmedDespiteMatch: confirmCreate && Boolean(match) },
    });

    await attachLeadCustomer({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      leadId: lead.id,
      customerId: customer.id,
      source: lead.source,
      campaignId: lead.campaignId,
      body: "Converted to a new customer record.",
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "lead.converted",
      entityType: "Lead",
      entityId: lead.id,
      metadata: { customerId: customer.id },
    });

    revalidatePath("/customers");
    revalidatePath("/office");
    revalidatePath("/marketing/leads");
    revalidatePath(`/marketing/leads/${lead.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function setLeadNextActionAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("leads:manage");
    const leadId = String(formData.get("leadId") || "");
    const nextAction = emptyToNull(String(formData.get("nextAction") || ""));
    const assignedUserId = emptyToNull(String(formData.get("assignedUserId") || ""));
    const note = emptyToNull(String(formData.get("note") || ""));
    const dueRaw = emptyToNull(String(formData.get("nextActionAt") || ""));
    const nextActionAt = dueRaw ? new Date(dueRaw) : null;
    if (nextActionAt && Number.isNaN(nextActionAt.getTime())) {
      return { ok: false, error: "Due date is not valid." };
    }

    const lead = await prisma.lead.findFirst({
      where: scopedCompanyWhere(ctx.company.id, { id: leadId }),
    });
    if (!lead) return { ok: false, error: "Lead not found." };

    if (assignedUserId) {
      const member = await prisma.membership.findFirst({
        where: { companyId: ctx.company.id, userId: assignedUserId, status: "ACTIVE" },
      });
      if (!member) return { ok: false, error: "Assigned user is not on this team." };
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        nextAction,
        nextActionAt,
        assignedUserId,
      },
    });

    await prisma.leadActivity.create({
      data: {
        companyId: ctx.company.id,
        leadId: lead.id,
        actorId: ctx.user.id,
        kind: "NEXT_ACTION",
        body: [
          nextAction ? `Next action: ${nextAction}` : "Next action cleared.",
          nextActionAt ? `Due ${nextActionAt.toISOString()}` : null,
          note,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "lead.next_action_set",
      entityType: "Lead",
      entityId: lead.id,
      metadata: { nextAction, nextActionAt, assignedUserId },
    });

    revalidatePath("/marketing/leads");
    revalidatePath(`/marketing/leads/${lead.id}`);
    revalidatePath("/attention");
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
