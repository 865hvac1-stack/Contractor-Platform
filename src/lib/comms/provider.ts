import { prisma } from "@/lib/db";
import { demoOutboundBlock } from "@/lib/demo/guard";
import { isHighLevelConnected } from "@/lib/highlevel/connection";
import { sendViaHighLevel } from "@/lib/highlevel/communication-provider";
import { sendCompanySms, smsProviderConfigured, type SmsSendResult } from "@/lib/communications/sms";

export type CommunicationChannel = "SMS";

export async function resolveCommunicationProvider(companyId: string): Promise<"highlevel" | "twilio" | "none"> {
  if (await isHighLevelConnected(prisma, companyId)) return "highlevel";
  if (smsProviderConfigured()) return "twilio";
  return "none";
}

export async function sendCompanyCommunication(input: {
  companyId: string;
  channel: CommunicationChannel;
  to: string;
  body: string;
  customerId?: string | null;
  leadId?: string | null;
  confirmExternalSend?: boolean;
}): Promise<SmsSendResult & { provider: "highlevel" | "twilio" | "none" | "demo" }> {
  const blocked = await demoOutboundBlock(input.companyId);
  const provider = await resolveCommunicationProvider(input.companyId);
  if (blocked.blocked && !(input.confirmExternalSend && provider === "highlevel")) {
    return { ok: false, configured: true, provider: "demo", error: blocked.message };
  }
  if (provider === "highlevel") {
    const result = await sendViaHighLevel({
      companyId: input.companyId,
      to: input.to,
      body: input.body,
      customerId: input.customerId,
      leadId: input.leadId,
      confirmExternalSend: input.confirmExternalSend,
    });
    return { ...result, provider };
  }
  if (provider === "twilio") {
    const result = await sendCompanySms({ to: input.to, body: input.body });
    return { ...result, provider };
  }
  return {
    ok: false,
    configured: false,
    provider: "none",
    error: "No communications provider is connected. Connect HighLevel or configure Twilio.",
  };
}
