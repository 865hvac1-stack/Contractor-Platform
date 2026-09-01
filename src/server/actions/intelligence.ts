"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { askContractorYou } from "@/lib/intelligence/service";
import { refreshCompanyInsights } from "@/lib/intelligence/generate";
import type { ActionResult } from "@/server/actions/auth";

import type { AskKind, PublicActionRequest } from "@/lib/actions/types";

export type AskState = ActionResult & {
  answer?: string;
  conversationId?: string;
  kind?: AskKind;
  actionRequest?: PublicActionRequest | null;
  grounding?: { sources: string[]; lastUpdated?: string; model?: string; kind?: string };
  providerConfigured?: boolean;
};

export async function askContractorYouAction(
  _prev: AskState | null,
  formData: FormData
): Promise<AskState> {
  try {
    const ctx = await requirePermission("intelligence:view");
    const question = String(formData.get("question") || "");
    const conversationId = String(formData.get("conversationId") || "") || null;
    const jobId = String(formData.get("jobId") || "") || null;
    const result = await askContractorYou({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      role: ctx.role,
      question,
      conversationId,
      jobId,
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/intelligence");
    revalidatePath("/dashboard");
    return {
      ok: true,
      answer: result.answer,
      conversationId: result.conversationId,
      kind: result.kind,
      actionRequest: result.actionRequest,
      grounding: result.grounding,
      providerConfigured: result.providerConfigured,
    };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function startNewConversationAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("intelligence:view");
    await prisma.aIConversation.updateMany({
      where: { companyId: ctx.company.id, userId: ctx.user.id },
      data: { updatedAt: new Date() },
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function refreshInsightsAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("intelligence:view");
    await refreshCompanyInsights(ctx.company.id);
    revalidatePath("/dashboard");
    revalidatePath("/intelligence");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function recommendAutomationDraftAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const name = String(formData.get("name") || "Estimate follow-up").trim();
    const trigger = String(formData.get("trigger") || "Estimate Sent");
    const action = String(formData.get("action") || "Draft follow-up SMS after 48 hours if still open");
    const automation = await prisma.automation.create({
      data: {
        companyId: ctx.company.id,
        name,
        trigger,
        action,
        enabled: false,
        status: "DRAFT",
      },
    });
    await prisma.aIActionDraft.create({
      data: {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        actionType: "CREATE_AUTOMATION_DRAFT",
        status: "DRAFT",
        payload: { automationId: automation.id, name, trigger, action },
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "AI_RECOMMENDATION_CREATED",
      entityType: "Automation",
      entityId: automation.id,
    });
    revalidatePath("/marketing/automations");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function decideAIActionAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("intelligence:manage");
    const id = String(formData.get("actionId") || "");
    const decision = String(formData.get("decision") || "");
    if (decision !== "approve" && decision !== "reject") {
      return { ok: false, error: "Choose approve or reject." };
    }
    const draft = await prisma.aIActionDraft.findFirst({
      where: { id, companyId: ctx.company.id, status: "DRAFT" },
    });
    if (!draft) return { ok: false, error: "Draft not found." };
    if (decision === "approve" && ["SEND_SMS", "SEND_EMAIL", "PUBLISH", "REFUND"].includes(draft.actionType)) {
      return { ok: false, error: "That action cannot run automatically. Review it in the related screen." };
    }
    await prisma.aIActionDraft.update({
      where: { id: draft.id },
      data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedAt: new Date() },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: decision === "approve" ? "AI_ACTION_APPROVED" : "AI_ACTION_REJECTED",
      entityType: "AIActionDraft",
      entityId: draft.id,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function saveIntelligenceSettingsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("intelligence:manage");
    if (!can(ctx.role, "intelligence:manage")) return { ok: false, error: "Owners and admins manage Intelligence." };
    const enabled = String(formData.get("dailyBriefEnabled") || "") === "on";
    await prisma.companyIntelligenceSetting.upsert({
      where: { companyId: ctx.company.id },
      create: { companyId: ctx.company.id, dailyBriefEnabled: enabled },
      update: { dailyBriefEnabled: enabled },
    });
    revalidatePath("/settings/intelligence");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
