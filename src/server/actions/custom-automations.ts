"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { interpretAutomationRequest, minimumActions, defaultStops, SUPPORTED_GOALS, SUPPORTED_TRIGGERS } from "@/lib/conversations/custom-automations";
import type { ActionResult } from "@/server/actions/auth";

const manualSchema = z.object({
  name: z.string().min(1).max(160),
  trigger: z.enum(SUPPORTED_TRIGGERS),
  goal: z.enum(SUPPORTED_GOALS),
  audience: z.enum(["EVENT_CUSTOMER", "RESIDENTIAL", "COMMERCIAL", "MAINTENANCE_MEMBERS", "NON_MEMBERS"]),
  delayMinutes: z.coerce.number().int().min(0).max(525_600),
  firstMessage: z.string().min(1).max(1500),
});

export async function createAutomationFromDescriptionAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requirePermission("marketing:manage");
  const request = String(formData.get("request") || "").trim();
  if (request.length < 20 || request.length > 4000) {
    return { ok: false, error: "Describe what you want handled in at least 20 characters." };
  }
  const interpretation = await interpretAutomationRequest(request, ctx.company.businessName);
  const overlap = await overlappingAutomation(ctx.company.id, interpretation.trigger, interpretation.goal);
  if (overlap && formData.get("continueAnyway") !== "true") {
    return {
      ok: false,
      error: `You already have an active automation for ${friendly(interpretation.trigger)} → ${friendly(interpretation.goal)} (${overlap.name}). Review it first, or choose Continue anyway.`,
    };
  }
  const automation = await prisma.automation.create({
    data: {
      companyId: ctx.company.id,
      createdById: ctx.user.id,
      sourceType: "PLAIN_ENGLISH",
      sourceRequest: request,
      interpretation: interpretation as unknown as Prisma.InputJsonValue,
      name: interpretation.name,
      trigger: interpretation.trigger,
      action: "START_REGINA_CONVERSATION",
      mode: "START_CONVERSATION",
      goal: interpretation.goal,
      audience: interpretation.audience,
      delayMinutes: interpretation.delayMinutes,
      conditions: { onlyIf: interpretation.conditions },
      firstMessage: interpretation.firstMessage,
      allowedActions: interpretation.allowedActions,
      escalationRules: defaultEscalations,
      stopConditions: interpretation.stopConditions,
      quietHoursStart: 20,
      quietHoursEnd: 8,
      maxAttempts: 1,
      status: "DRAFT",
      enabled: false,
    },
  });
  await auditCreated(ctx.company.id, ctx.user.id, automation.id, "PLAIN_ENGLISH", request, interpretation);
  redirect(`/marketing/automations/${automation.id}?created=1`);
}

export async function createManualAutomationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requirePermission("marketing:manage");
  const parsed = manualSchema.safeParse({
    name: formData.get("name"),
    trigger: formData.get("trigger"),
    goal: formData.get("goal"),
    audience: formData.get("audience"),
    delayMinutes: formData.get("delayMinutes") || 0,
    firstMessage: formData.get("firstMessage"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Check the automation setup." };
  const overlap = await overlappingAutomation(ctx.company.id, parsed.data.trigger, parsed.data.goal);
  if (overlap && formData.get("continueAnyway") !== "true") {
    return { ok: false, error: `An active ${friendly(parsed.data.trigger)} → ${friendly(parsed.data.goal)} automation already exists (${overlap.name}).` };
  }
  const structured = {
    ...parsed.data,
    conditions: ["CUSTOMER_NOT_OPTED_OUT", "SOURCE_STILL_ACTIVE"],
    allowedActions: minimumActions(parsed.data.goal),
    stopConditions: defaultStops(parsed.data.goal),
  };
  const automation = await prisma.automation.create({
    data: {
      companyId: ctx.company.id,
      createdById: ctx.user.id,
      sourceType: "MANUAL",
      interpretation: structured as Prisma.InputJsonValue,
      name: parsed.data.name,
      trigger: parsed.data.trigger,
      action: "START_REGINA_CONVERSATION",
      mode: "START_CONVERSATION",
      goal: parsed.data.goal,
      audience: parsed.data.audience,
      delayMinutes: parsed.data.delayMinutes,
      conditions: { onlyIf: structured.conditions },
      firstMessage: parsed.data.firstMessage,
      allowedActions: structured.allowedActions,
      escalationRules: defaultEscalations,
      stopConditions: structured.stopConditions,
      quietHoursStart: 20,
      quietHoursEnd: 8,
      status: "DRAFT",
    },
  });
  await auditCreated(ctx.company.id, ctx.user.id, automation.id, "MANUAL", null, structured);
  redirect(`/marketing/automations/${automation.id}?created=1`);
}

export async function duplicateAutomationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requirePermission("marketing:manage");
  const source = await prisma.automation.findFirst({
    where: { id: String(formData.get("automationId") || ""), companyId: ctx.company.id },
  });
  if (!source) return { ok: false, error: "Automation not found." };
  const copy = await prisma.automation.create({
    data: {
      companyId: ctx.company.id,
      createdById: ctx.user.id,
      sourceType: "DUPLICATED",
      sourceRequest: source.sourceRequest,
      interpretation: source.interpretation ?? undefined,
      name: `${source.name} Copy`,
      trigger: source.trigger,
      conditions: source.conditions ?? undefined,
      action: source.action,
      mode: source.mode,
      goal: source.goal,
      channel: source.channel,
      firstMessage: source.firstMessage,
      audience: source.audience,
      delayMinutes: source.delayMinutes,
      allowedActions: source.allowedActions,
      escalationRules: source.escalationRules,
      stopConditions: source.stopConditions,
      quietHoursStart: source.quietHoursStart,
      quietHoursEnd: source.quietHoursEnd,
      promotionId: source.promotionId,
      followUpDelayMinutes: source.followUpDelayMinutes,
      maxAttempts: source.maxAttempts,
      status: "DRAFT",
      enabled: false,
    },
  });
  await writeAudit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "automation.duplicated", entityType: "Automation", entityId: copy.id, metadata: { sourceAutomationId: source.id } });
  redirect(`/marketing/automations/${copy.id}?created=1`);
}

async function overlappingAutomation(companyId: string, trigger: string, goal: string) {
  return prisma.automation.findFirst({ where: { companyId, trigger, goal, enabled: true }, select: { id: true, name: true } });
}

async function auditCreated(companyId: string, actorId: string, id: string, sourceType: string, sourceRequest: string | null, interpretation: unknown) {
  await writeAudit({
    companyId, actorId, action: "automation.created", entityType: "Automation", entityId: id,
    metadata: { sourceType, sourceRequest, interpretation } as Prisma.InputJsonValue,
  });
}

function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

const defaultEscalations = [
  "PRICING_NEGOTIATION", "ANGRY_CUSTOMER", "MANAGER_REQUEST", "REFUND_REQUEST",
  "LEGAL_OR_SAFETY_CONCERN", "IDENTITY_UNCERTAIN", "UNSUPPORTED_ACTION",
];
