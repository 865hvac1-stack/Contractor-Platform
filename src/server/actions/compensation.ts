"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import type { ActionResult } from "@/server/actions/auth";
import type { CompensationRuleType, CompensationStatus, CompensationTrigger, Prisma } from "@prisma/client";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

async function snapshotRule(companyId: string, ruleId: string, snapshot: Prisma.InputJsonValue) {
  return prisma.compensationRuleVersion.create({
    data: { companyId, ruleId, snapshot },
  });
}

export async function createCompensationRuleAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("compensation:manage");
    const name = String(formData.get("name") || "").trim();
    const type = String(formData.get("type") || "FLAT_AMOUNT") as CompensationRuleType;
    const trigger = String(formData.get("trigger") || "MEMBERSHIP_SOLD") as CompensationTrigger;
    if (!name) return { ok: false, error: "Rule name is required." };
    const rule = await prisma.compensationRule.create({
      data: {
        companyId: ctx.company.id,
        name,
        type,
        trigger,
        amountCents: String(formData.get("amount") || "")
          ? dollarsToCents(String(formData.get("amount")))
          : null,
        percentBps: String(formData.get("percent") || "")
          ? Math.round(Number(formData.get("percent")) * 100)
          : null,
        minAmountCents: String(formData.get("minAmount") || "")
          ? dollarsToCents(String(formData.get("minAmount")))
          : null,
        jobType: emptyToNull(String(formData.get("jobType") || "")),
        pricebookItemId: emptyToNull(String(formData.get("pricebookItemId") || "")),
        membershipPlanId: emptyToNull(String(formData.get("membershipPlanId") || "")),
      },
    });
    await snapshotRule(ctx.company.id, rule.id, {
      name: rule.name,
      type: rule.type,
      trigger: rule.trigger,
      amountCents: rule.amountCents,
      percentBps: rule.percentBps,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "compensation.rule_created",
      entityType: "CompensationRule",
      entityId: rule.id,
      metadata: { name, type, trigger },
    });
    revalidatePath("/team/compensation");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateCompensationRuleAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("compensation:manage");
    const id = String(formData.get("id") || "");
    const rule = await prisma.compensationRule.findFirst({
      where: { id, companyId: ctx.company.id },
    });
    if (!rule) return { ok: false, error: "Rule not found." };
    const updated = await prisma.compensationRule.update({
      where: { id },
      data: {
        name: String(formData.get("name") || rule.name).trim() || rule.name,
        amountCents: String(formData.get("amount") || "")
          ? dollarsToCents(String(formData.get("amount")))
          : rule.amountCents,
        percentBps: String(formData.get("percent") || "")
          ? Math.round(Number(formData.get("percent")) * 100)
          : rule.percentBps,
        minAmountCents: String(formData.get("minAmount") || "")
          ? dollarsToCents(String(formData.get("minAmount")))
          : rule.minAmountCents,
        active: String(formData.get("active") || "true") !== "false",
      },
    });
    await snapshotRule(ctx.company.id, updated.id, {
      name: updated.name,
      type: updated.type,
      trigger: updated.trigger,
      amountCents: updated.amountCents,
      percentBps: updated.percentBps,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "compensation.rule_updated",
      entityType: "CompensationRule",
      entityId: id,
    });
    revalidatePath("/team/compensation");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function setCompensationStatusAction(input: {
  eventIds: string[];
  status: CompensationStatus;
}): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("compensation:manage");
    const events = await prisma.compensationEvent.findMany({
      where: { id: { in: input.eventIds }, companyId: ctx.company.id },
    });
    if (events.length === 0) return { ok: false, error: "No compensation items found." };
    const now = new Date();
    await prisma.compensationEvent.updateMany({
      where: { id: { in: events.map((event) => event.id) } },
      data: {
        status: input.status,
        approvedAt: input.status === "APPROVED" || input.status === "PAID" ? now : undefined,
        paidAt: input.status === "PAID" ? now : undefined,
        approvedById: ctx.user.id,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action:
        input.status === "PAID"
          ? "compensation.marked_paid"
          : input.status === "VOIDED"
            ? "compensation.voided"
            : "compensation.approved",
      entityType: "CompensationEvent",
      metadata: { ids: events.map((event) => event.id), status: input.status },
    });
    revalidatePath("/team/compensation");
    revalidatePath("/me/performance");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function bulkApproveCompensationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ids = formData.getAll("eventId").map(String).filter(Boolean);
  const status = String(formData.get("status") || "APPROVED") as CompensationStatus;
  return setCompensationStatusAction({ eventIds: ids, status });
}

export async function savePerformanceGoalAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("compensation:manage");
    const metricKey = String(formData.get("metricKey") || "").trim();
    const target = Number(formData.get("target") || 0);
    const period = String(formData.get("period") || "WEEK");
    const userId = emptyToNull(String(formData.get("userId") || ""));
    if (!metricKey || !Number.isFinite(target)) return { ok: false, error: "Goal metric and target are required." };
    await prisma.performanceGoal.create({
      data: {
        companyId: ctx.company.id,
        userId,
        metricKey,
        target: Math.round(target),
        period,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "performance.goal_created",
      entityType: "PerformanceGoal",
      metadata: { metricKey, target, userId },
    });
    revalidatePath("/team/performance");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
