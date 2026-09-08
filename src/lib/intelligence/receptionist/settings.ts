import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ReceptionistSettings } from "@/lib/intelligence/receptionist/types";

const DEFAULTS: ReceptionistSettings = {
  enabled: false,
  assistantName: "Regina",
  autoReplyInboundSms: true,
  autoBookServiceCalls: true,
  allowSameDayBooking: true,
  humanHandoffFallback: true,
  businessHoursBehavior: "ALWAYS",
};

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
  };
}

export function receptionistShouldHandleInbound(settings: ReceptionistSettings) {
  return settings.enabled && settings.autoReplyInboundSms;
}
