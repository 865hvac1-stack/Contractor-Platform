import { prisma } from "@/lib/db";
import {
  contractorYouMayAutoreply,
  loadCustomerConversationOwner,
  type OutboundCommunicationOrigin,
} from "@/lib/comms/conversation-owner";
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

export async function sendCustomerMessage(input: {
  companyId: string;
  channel: CommunicationChannel;
  to: string;
  body: string;
  customerId?: string | null;
  leadId?: string | null;
  confirmExternalSend?: boolean;
}) {
  return sendCompanyCommunication(input);
}

export async function sendCompanyCommunication(input: {
  companyId: string;
  channel: CommunicationChannel;
  to: string;
  body: string;
  customerId?: string | null;
  leadId?: string | null;
  confirmExternalSend?: boolean;
  origin?: OutboundCommunicationOrigin;
}): Promise<SmsSendResult & { provider: "highlevel" | "twilio" | "none" | "demo" }> {
  if (input.origin === "CONTRACTORYOU_AUTOMATION" || input.origin === "CONTRACTORYOU_ACTION_RESULT") {
    const owner = await loadCustomerConversationOwner(prisma, input.companyId);
    if (input.origin === "CONTRACTORYOU_AUTOMATION" && !contractorYouMayAutoreply(owner)) {
      return {
        ok: false,
        configured: true,
        provider: "none",
        error: "ContractorYou is not the customer conversation owner, so automated scheduling texts are blocked.",
      };
    }
    if (input.origin === "CONTRACTORYOU_ACTION_RESULT" && owner === "MANUAL") {
      return {
        ok: false,
        configured: true,
        provider: "none",
        error: "Office-only conversations do not accept automated action-result texts.",
      };
    }
  }
  const blocked = await demoOutboundBlock(input.companyId);
  const provider = await resolveCommunicationProvider(input.companyId);
  if (blocked.blocked && !(input.confirmExternalSend && provider === "highlevel")) {
    return { ok: false, configured: true, provider: "demo", error: blocked.message };
  }
  if (provider === "highlevel") {
    const { resolveApprovedSenderNumber } = await import("@/lib/highlevel/phone-numbers");
    const { blockSelfAddressedSms } = await import("@/lib/comms/sender-guard");
    const sender = await resolveApprovedSenderNumber(prisma, input.companyId);
    const routing = blockSelfAddressedSms({
      from: sender?.phoneNumber,
      to: input.to,
      customerPhone: input.to,
      approvedSender: sender?.phoneNumber,
    });
    if (!sender) {
      return {
        ok: false,
        configured: true,
        provider,
        error: "Set an approved HighLevel sender number in Marketing → Channels → Tracking Numbers before sending SMS.",
      };
    }
    if (!routing.ok) {
      return { ok: false, configured: true, provider, error: routing.error };
    }
    const result = await sendViaHighLevel({
      companyId: input.companyId,
      to: input.to,
      body: input.body,
      customerId: input.customerId,
      leadId: input.leadId,
      confirmExternalSend: input.confirmExternalSend,
    });
    if (result.ok) {
      const { recordCanonicalOutboundSms } = await import("@/lib/comms/outbound");
      await recordCanonicalOutboundSms({
        companyId: input.companyId,
        provider,
        to: input.to,
        from: sender.phoneNumber,
        body: input.body,
        providerId: result.providerId,
        customerId: input.customerId,
        leadId: input.leadId,
      });
    }
    return { ...result, provider };
  }
  if (provider === "twilio") {
    const { twilioFromNumber } = await import("@/lib/communications/sms");
    const { blockSelfAddressedSms } = await import("@/lib/comms/sender-guard");
    const from = twilioFromNumber();
    const routing = blockSelfAddressedSms({ from, to: input.to, customerPhone: input.to, approvedSender: from });
    if (!routing.ok) {
      return { ok: false, configured: true, provider, error: routing.error };
    }
    const result = await sendCompanySms({ to: input.to, body: input.body });
    if (result.ok) {
      const { recordCanonicalOutboundSms } = await import("@/lib/comms/outbound");
      await recordCanonicalOutboundSms({
        companyId: input.companyId,
        provider,
        to: input.to,
        from,
        body: input.body,
        providerId: result.providerId,
        customerId: input.customerId,
        leadId: input.leadId,
      });
    }
    return { ...result, provider };
  }
  return {
    ok: false,
    configured: false,
    provider: "none",
    error: "No communications provider is connected. Connect HighLevel or configure Twilio.",
  };
}
