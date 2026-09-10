import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ReceptionistSettings } from "@/lib/intelligence/receptionist/types";

export const DEFAULT_RECEPTIONIST_SETTINGS: ReceptionistSettings = {
  enabled: false,
  assistantName: "Regina",
  autoReplyInboundSms: true,
  autoBookServiceCalls: true,
  allowSameDayBooking: true,
  humanHandoffFallback: true,
  businessHoursBehavior: "ALWAYS",
  mode: "HIGHLEVEL_REGINA",
  tone: "warm",
  responseLength: "short",
  companyDescription: "Friendly virtual office receptionist for a local HVAC company.",
  businessHoursText: null,
  afterHoursBehavior: "OFFER_CALLBACK",
  serviceAreaNote: null,
  servicesOffered: null,
  emergencyGuidance: "If you smell gas or have a carbon monoxide alarm, leave the home and call emergency services.",
  handoffRules: "Hand off for billing disputes, emergencies outside guidance, angry customers, or unclear identity.",
  useCustomerFirstName: true,
  allowScheduling: true,
  allowRescheduling: true,
  allowCancellations: true,
  allowJobStatus: true,
  allowInvoiceQuestions: true,
  allowEstimateQuestions: true,
  allowMembershipQuestions: true,
  allowWaitingQuestions: true,
  knowledgeJson: null,
};

const DEFAULTS = DEFAULT_RECEPTIONIST_SETTINGS;

export async function loadReceptionistSettings(
  companyId: string,
  db: PrismaClient | typeof prisma = prisma
): Promise<ReceptionistSettings> {
  const row = await db.companyAiReceptionistSetting.findUnique({
    where: { companyId },
  });
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled,
    assistantName: row.assistantName || "Regina",
    autoReplyInboundSms: row.autoReplyInboundSms,
    autoBookServiceCalls: row.autoBookServiceCalls,
    allowSameDayBooking: row.allowSameDayBooking,
    humanHandoffFallback: row.humanHandoffFallback,
    businessHoursBehavior: row.businessHoursBehavior || "ALWAYS",
    mode: row.mode || "HIGHLEVEL_REGINA",
    tone: row.tone || "warm",
    responseLength: row.responseLength || "short",
    companyDescription: row.companyDescription ?? DEFAULTS.companyDescription,
    businessHoursText: row.businessHoursText ?? null,
    afterHoursBehavior: row.afterHoursBehavior || "OFFER_CALLBACK",
    serviceAreaNote: row.serviceAreaNote ?? null,
    servicesOffered: row.servicesOffered ?? null,
    emergencyGuidance: row.emergencyGuidance ?? DEFAULTS.emergencyGuidance,
    handoffRules: row.handoffRules ?? DEFAULTS.handoffRules,
    useCustomerFirstName: row.useCustomerFirstName,
    allowScheduling: row.allowScheduling,
    allowRescheduling: row.allowRescheduling,
    allowCancellations: row.allowCancellations,
    allowJobStatus: row.allowJobStatus,
    allowInvoiceQuestions: row.allowInvoiceQuestions,
    allowEstimateQuestions: row.allowEstimateQuestions,
    allowMembershipQuestions: row.allowMembershipQuestions,
    allowWaitingQuestions: row.allowWaitingQuestions,
    knowledgeJson: row.knowledgeJson ?? null,
  };
}

export function receptionistShouldHandleInbound(settings: ReceptionistSettings) {
  return settings.enabled && settings.autoReplyInboundSms;
}
