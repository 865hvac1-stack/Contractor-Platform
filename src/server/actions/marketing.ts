"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { campaignDraftSchema, automationDraftSchema, socialDraftSchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";

export async function createCampaignDraftAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const parsed = campaignDraftSchema.safeParse({
      name: formData.get("name"),
      type: formData.get("type"),
      notes: formData.get("notes") || "",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid campaign." };
    }

    await prisma.campaign.create({
      data: {
        companyId: ctx.company.id,
        name: parsed.data.name,
        type: parsed.data.type,
        status: "DRAFT",
        notes: parsed.data.notes || null,
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "campaign.draft_created",
      entityType: "Campaign",
    });

    revalidatePath("/marketing/campaigns");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createAutomationDraftAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const parsed = automationDraftSchema.safeParse({
      name: formData.get("name"),
      trigger: formData.get("trigger"),
      action: formData.get("action"),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid automation." };
    }

    await prisma.automation.create({
      data: {
        companyId: ctx.company.id,
        name: parsed.data.name,
        trigger: parsed.data.trigger,
        action: parsed.data.action,
        enabled: false,
        status: "DRAFT",
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "automation.draft_created",
      entityType: "Automation",
    });

    revalidatePath("/marketing/automations");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createSocialDraftAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const parsed = socialDraftSchema.safeParse({
      channel: formData.get("channel"),
      body: formData.get("body"),
      linkUrl: formData.get("linkUrl") || "",
      mediaUrl: formData.get("mediaUrl") || "",
      ctaLabel: formData.get("ctaLabel") || "",
      scheduledAt: formData.get("scheduledAt") || "",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid draft." };
    }
    const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      return { ok: false, error: "Scheduled time is not valid." };
    }

    await prisma.socialPost.create({
      data: {
        companyId: ctx.company.id,
        channel: parsed.data.channel,
        body: parsed.data.body,
        linkUrl: parsed.data.linkUrl || null,
        mediaUrl: parsed.data.mediaUrl || null,
        ctaLabel: parsed.data.ctaLabel || null,
        scheduledAt,
        status: scheduledAt ? "SCHEDULED" : "DRAFT",
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "social.draft_created",
      entityType: "SocialPost",
    });

    revalidatePath("/marketing/social");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
