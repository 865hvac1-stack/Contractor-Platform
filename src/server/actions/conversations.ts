"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/server/actions/auth";
import { automationReadiness } from "@/lib/conversations/readiness";
import { GOAL_ACTIONS } from "@/lib/conversations/custom-automations";

const automationEditorSchema = z.object({
  automationId: z.string().cuid(),
  mode: z.enum(["SEND_MESSAGE", "START_CONVERSATION"]),
  goal: z.string().max(100).optional(),
  channel: z.literal("SMS"),
  firstMessage: z.string().min(1).max(1500),
  promotionId: z.string().cuid().optional().or(z.literal("")),
  quietHoursStart: z.coerce.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).optional(),
  audience: z.enum(["EVENT_CUSTOMER", "RESIDENTIAL", "COMMERCIAL", "MAINTENANCE_MEMBERS", "NON_MEMBERS"]).optional(),
  delayMinutes: z.coerce.number().int().min(0).max(525_600).optional(),
  followUpDelayMinutes: z.coerce.number().int().min(15).max(43_200).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(3).optional(),
  allowedActions: z.array(z.string()).max(12),
  stopConditions: z.array(z.string()).min(1).max(12),
  isCompanyTemplate: z.boolean().optional(),
  conditions: z.array(z.enum(["CUSTOMER_NOT_OPTED_OUT", "SOURCE_STILL_ACTIVE", "CUSTOMER_HAS_NOT_BOOKED", "PROMOTION_ACTIVE"])).max(6),
});

const promotionSchema = z
  .object({
    promotionId: z.string().cuid().optional().or(z.literal("")),
    name: z.string().min(1).max(160),
    internalDescription: z.string().max(1000).optional().or(z.literal("")),
    headline: z.string().min(1).max(240),
    customerCopy: z.string().max(2000).optional().or(z.literal("")),
    offer: z.string().min(1).max(240),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    audience: z.enum(["ALL_CUSTOMERS", "RESIDENTIAL", "COMMERCIAL", "MAINTENANCE_DUE", "PAST_CUSTOMERS", "UNSOLD_ESTIMATES"]),
    eligibleServices: z.string().max(1000).optional().or(z.literal("")),
    promoCode: z.string().max(80).optional().or(z.literal("")),
    terms: z.string().max(3000).optional().or(z.literal("")),
    status: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"]),
  })
  .refine((data) => new Date(data.endsAt) > new Date(data.startsAt), {
    message: "End date must be after the start date.",
  });

export async function toggleAutomationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const automationId = String(formData.get("automationId") || "");
    const enable = String(formData.get("enable")) === "true";
    const automation = await prisma.automation.findFirst({
      where: { id: automationId, companyId: ctx.company.id },
    });
    if (!automation) return { ok: false, error: "Automation not found." };
    if (enable) {
      const readiness = await automationReadiness(automation);
      const blockers = readiness.checks.filter((item) => !item.ready).map((item) => item.blocker);
      if (!readiness.ready) return { ok: false, error: blockers.join(" ") };
    }
    await prisma.automation.update({
      where: { id: automation.id },
      data: { enabled: enable, status: enable ? "ACTIVE" : "PAUSED" },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: enable ? "automation.enabled" : "automation.disabled",
      entityType: "Automation",
      entityId: automation.id,
    });
    revalidatePath("/marketing/automations");
    revalidatePath(`/marketing/automations/${automation.id}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function updateConversationAutomationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const parsed = automationEditorSchema.safeParse({
      automationId: formData.get("automationId"),
      mode: formData.get("mode"),
      goal: formData.get("goal"),
      channel: formData.get("channel"),
      firstMessage: formData.get("firstMessage"),
      promotionId: formData.get("promotionId") || "",
      quietHoursStart: formData.get("quietHoursStart") || undefined,
      quietHoursEnd: formData.get("quietHoursEnd") || undefined,
      audience: formData.get("audience") || undefined,
      delayMinutes: formData.get("delayMinutes") || 0,
      followUpDelayMinutes: formData.get("followUpDelayMinutes") || undefined,
      maxAttempts: formData.get("maxAttempts") || 1,
      allowedActions: formData.getAll("allowedActions"),
      stopConditions: formData.getAll("stopConditions"),
      isCompanyTemplate: formData.get("isCompanyTemplate") === "true",
      conditions: formData.getAll("conditions"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Invalid automation." };
    const automation = await prisma.automation.findFirst({
      where: { id: parsed.data.automationId, companyId: ctx.company.id },
    });
    if (!automation) return { ok: false, error: "Automation not found." };
    if ((parsed.data.maxAttempts || 1) > 1 && !parsed.data.followUpDelayMinutes) {
      return { ok: false, error: "Choose how long Regina should wait before a follow-up." };
    }
    const goalActions = new Set(GOAL_ACTIONS[parsed.data.goal || automation.goal || ""] || []);
    const allowedActions = parsed.data.allowedActions.filter((action) => goalActions.has(action));
    if (parsed.data.mode === "START_CONVERSATION" && !allowedActions.length) {
      return { ok: false, error: "Choose at least one supported Regina action." };
    }
    if (parsed.data.promotionId) {
      const promotion = await prisma.promotion.findFirst({
        where: { id: parsed.data.promotionId, companyId: ctx.company.id },
      });
      if (!promotion) return { ok: false, error: "Promotion not found." };
    }
    await prisma.automation.update({
      where: { id: automation.id },
      data: {
        mode: parsed.data.mode,
        action: parsed.data.mode === "START_CONVERSATION" ? "START_REGINA_CONVERSATION" : "SEND_MESSAGE",
        goal: parsed.data.mode === "START_CONVERSATION" ? parsed.data.goal || automation.goal : automation.goal,
        channel: parsed.data.channel,
        firstMessage: parsed.data.firstMessage,
        promotionId: parsed.data.promotionId || null,
        quietHoursStart: parsed.data.quietHoursStart,
        quietHoursEnd: parsed.data.quietHoursEnd,
        audience: parsed.data.audience,
        delayMinutes: parsed.data.delayMinutes,
        followUpDelayMinutes: parsed.data.maxAttempts && parsed.data.maxAttempts > 1 ? parsed.data.followUpDelayMinutes : null,
        maxAttempts: parsed.data.maxAttempts,
        allowedActions,
        stopConditions: parsed.data.stopConditions,
        isCompanyTemplate: parsed.data.isCompanyTemplate,
        conditions: { onlyIf: parsed.data.conditions },
        version: automation.enabled ? { increment: 1 } : undefined,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "automation.updated",
      entityType: "Automation",
      entityId: automation.id,
      metadata: { mode: parsed.data.mode, promotionId: parsed.data.promotionId || null, version: automation.enabled ? automation.version + 1 : automation.version, allowedActions },
    });
    revalidatePath("/marketing/automations");
    revalidatePath(`/marketing/automations/${automation.id}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function savePromotionAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const parsed = promotionSchema.safeParse({
      promotionId: formData.get("promotionId") || "",
      name: formData.get("name"),
      internalDescription: formData.get("internalDescription") || "",
      headline: formData.get("headline"),
      customerCopy: formData.get("customerCopy") || "",
      offer: formData.get("offer"),
      startsAt: formData.get("startsAt"),
      endsAt: formData.get("endsAt"),
      audience: formData.get("audience"),
      eligibleServices: formData.get("eligibleServices") || "",
      promoCode: formData.get("promoCode") || "",
      terms: formData.get("terms") || "",
      status: formData.get("status"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Invalid promotion." };
    const data = {
      name: parsed.data.name,
      internalDescription: parsed.data.internalDescription || null,
      headline: parsed.data.headline,
      customerCopy: parsed.data.customerCopy || null,
      offer: parsed.data.offer,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
      audience: parsed.data.audience,
      eligibleServices: (parsed.data.eligibleServices || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      promoCode: parsed.data.promoCode || null,
      terms: parsed.data.terms || null,
      status: parsed.data.status,
    };
    const promotion = parsed.data.promotionId
      ? await prisma.promotion.updateMany({
          where: { id: parsed.data.promotionId, companyId: ctx.company.id },
          data,
        })
      : await prisma.promotion.create({ data: { companyId: ctx.company.id, ...data } });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: parsed.data.promotionId ? "promotion.updated" : "promotion.created",
      entityType: "Promotion",
      entityId: "id" in promotion ? promotion.id : parsed.data.promotionId,
    });
    revalidatePath("/marketing/promotions");
    revalidatePath("/marketing/automations");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function setConversationOwnerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const threadId = String(formData.get("threadId") || "");
    const mode = String(formData.get("mode") || "");
    const thread = await prisma.communicationThread.findFirst({
      where: { id: threadId, companyId: ctx.company.id },
    });
    if (!thread) return { ok: false, error: "Conversation not found." };
    if (mode === "TAKE_OVER") {
      await prisma.$transaction(async (tx) => {
        await tx.communicationThread.update({
          where: { id: thread.id },
          data: {
            handlingState: "HUMAN_ACTIVE",
            handledByUserId: ctx.user.id,
            reginaPausedAt: new Date(),
            needsHumanAt: null,
          },
        });
        await tx.conversationGoalSession.updateMany({
          where: { companyId: ctx.company.id, threadId: thread.id, completedAt: null },
          data: { state: "HUMAN_TAKEOVER", humanTakeoverById: ctx.user.id },
        });
        await tx.conversationAuditEvent.create({
          data: {
            companyId: ctx.company.id,
            threadId: thread.id,
            event: "HUMAN_TAKEOVER",
            decision: "REGINA_PAUSED",
            details: { userId: ctx.user.id },
          },
        });
      });
    } else if (mode === "RETURN_TO_REGINA") {
      const optedOut = thread.customerId
        ? await prisma.customer.findFirst({
            where: { id: thread.customerId, companyId: ctx.company.id },
            select: { smsMarketingOptedOutAt: true },
          })
        : null;
      if (optedOut?.smsMarketingOptedOutAt) return { ok: false, error: "This customer is opted out. Regina cannot resume promotional SMS." };
      await prisma.$transaction(async (tx) => {
        await tx.communicationThread.update({
          where: { id: thread.id },
          data: { handlingState: "REGINA_ACTIVE", handledByUserId: null, reginaPausedAt: null, needsHumanAt: null },
        });
        await tx.conversationGoalSession.updateMany({
          where: { companyId: ctx.company.id, threadId: thread.id, state: "HUMAN_TAKEOVER", completedAt: null },
          data: { state: "WAITING_FOR_CUSTOMER", humanTakeoverById: null },
        });
        await tx.conversationAuditEvent.create({
          data: {
            companyId: ctx.company.id,
            threadId: thread.id,
            event: "RETURNED_TO_REGINA",
            decision: "REGINA_ACTIVE",
            details: { userId: ctx.user.id },
          },
        });
      });
    } else {
      return { ok: false, error: "Invalid conversation ownership action." };
    }
    revalidatePath("/marketing/communications");
    revalidatePath(`/marketing/communications/${thread.id}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}
