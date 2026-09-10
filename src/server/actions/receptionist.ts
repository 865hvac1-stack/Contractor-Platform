"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/server/actions/auth";
import { parseReceptionistV2Mode } from "@/lib/intelligence/receptionist/v2/types";
import { faqsFromFormText } from "@/lib/intelligence/receptionist/v2/knowledge";

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
    const mode = parseReceptionistV2Mode(formData.get("mode"));
    const tone = String(formData.get("tone") || "warm").trim() || "warm";
    const responseLength = String(formData.get("responseLength") || "short").trim() || "short";
    const companyDescription = emptyToNull(formData.get("companyDescription"));
    const businessHoursText = emptyToNull(formData.get("businessHoursText"));
    const afterHoursBehavior = String(formData.get("afterHoursBehavior") || "OFFER_CALLBACK");
    const serviceAreaNote = emptyToNull(formData.get("serviceAreaNote"));
    const servicesOffered = emptyToNull(formData.get("servicesOffered"));
    const emergencyGuidance = emptyToNull(formData.get("emergencyGuidance"));
    const handoffRules = emptyToNull(formData.get("handoffRules"));
    const useCustomerFirstName = formData.get("useCustomerFirstName") === "on";
    const allowScheduling = formData.get("allowScheduling") === "on";
    const allowRescheduling = formData.get("allowRescheduling") === "on";
    const allowCancellations = formData.get("allowCancellations") === "on";
    const allowJobStatus = formData.get("allowJobStatus") === "on";
    const allowInvoiceQuestions = formData.get("allowInvoiceQuestions") === "on";
    const allowEstimateQuestions = formData.get("allowEstimateQuestions") === "on";
    const allowMembershipQuestions = formData.get("allowMembershipQuestions") === "on";
    const allowWaitingQuestions = formData.get("allowWaitingQuestions") === "on";
    const knowledgeJson = { faqs: faqsFromFormText(String(formData.get("knowledgeFaqs") || "")) };
    const data = {
      enabled,
      assistantName,
      autoReplyInboundSms,
      autoBookServiceCalls,
      allowSameDayBooking,
      humanHandoffFallback,
      businessHoursBehavior,
      mode,
      tone,
      responseLength,
      companyDescription,
      businessHoursText,
      afterHoursBehavior,
      serviceAreaNote,
      servicesOffered,
      emergencyGuidance,
      handoffRules,
      useCustomerFirstName,
      allowScheduling,
      allowRescheduling,
      allowCancellations,
      allowJobStatus,
      allowInvoiceQuestions,
      allowEstimateQuestions,
      allowMembershipQuestions,
      allowWaitingQuestions,
      knowledgeJson,
    };
    await prisma.companyAiReceptionistSetting.upsert({
      where: { companyId: ctx.company.id },
      create: { companyId: ctx.company.id, ...data },
      update: data,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receptionist.settings_updated",
      entityType: "CompanyAiReceptionistSetting",
      entityId: ctx.company.id,
      metadata: { enabled, assistantName, mode, autoReplyInboundSms },
    });
    revalidatePath("/settings/highlevel");
    return {
      ok: true,
      message:
        mode === "CONTRACTORYOU_SHADOW"
          ? `${assistantName} will propose replies in shadow mode. HighLevel Regina still owns customer SMS.`
          : mode === "CONTRACTORYOU_AI"
            ? `${assistantName} is set to ContractorYou AI. Live send still requires ContractorYou conversation ownership.`
            : mode === "OFFICE_ONLY"
              ? "ContractorYou AI receptionist will not reply."
              : "HighLevel Regina remains the customer conversation owner unless you change that separately.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not save receptionist settings." };
  }
}

function emptyToNull(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text || null;
}
