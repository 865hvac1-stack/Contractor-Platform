"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/server/actions/auth";

export async function saveAiReceptionistSettingsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const enabled = formData.get("enabled") === "on";
    const assistantName = String(formData.get("assistantName") || "Regina").trim() || "Regina";
    const autoReplyInboundSms = formData.get("autoReplyInboundSms") === "on";
    const autoBookServiceCalls = formData.get("autoBookServiceCalls") === "on";
    const allowSameDayBooking = formData.get("allowSameDayBooking") === "on";
    const humanHandoffFallback = formData.get("humanHandoffFallback") === "on";
    const businessHoursBehavior = String(formData.get("businessHoursBehavior") || "ALWAYS");
    await prisma.companyAiReceptionistSetting.upsert({
      where: { companyId: ctx.company.id },
      create: {
        companyId: ctx.company.id,
        enabled,
        assistantName,
        autoReplyInboundSms,
        autoBookServiceCalls,
        allowSameDayBooking,
        humanHandoffFallback,
        businessHoursBehavior,
      },
      update: {
        enabled,
        assistantName,
        autoReplyInboundSms,
        autoBookServiceCalls,
        allowSameDayBooking,
        humanHandoffFallback,
        businessHoursBehavior,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receptionist.settings_updated",
      entityType: "CompanyAiReceptionistSetting",
      entityId: ctx.company.id,
      metadata: { enabled, assistantName, autoReplyInboundSms },
    });
    revalidatePath("/settings/highlevel");
    return { ok: true, message: enabled ? `${assistantName} will reply to inbound SMS through HighLevel.` : "AI receptionist is off." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not save receptionist settings." };
  }
}
