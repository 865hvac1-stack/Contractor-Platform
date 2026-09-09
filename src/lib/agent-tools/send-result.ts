import { sendCompanyCommunication } from "@/lib/comms/provider";

export async function sendActionResultSms(input: {
  companyId: string;
  phone?: string | null;
  customerId?: string | null;
  body: string;
  send: boolean;
}) {
  if (!input.body.trim()) return { sent: false as const, skipReason: "empty_body" };
  if (!input.phone) return { sent: false as const, skipReason: "missing_phone" };
  if (!input.send) return { sent: false as const, skipReason: "send_to_customer_false" };
  const result = await sendCompanyCommunication({
    companyId: input.companyId,
    channel: "SMS",
    to: input.phone,
    body: input.body,
    customerId: input.customerId,
    origin: "CONTRACTORYOU_ACTION_RESULT",
  });
  if (!result.ok) {
    return { sent: false as const, skipReason: result.error || "send_failed" };
  }
  return { sent: true as const, skipReason: null, outboundId: result.provider };
}
