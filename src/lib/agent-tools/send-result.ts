import { sendCompanyCommunication } from "@/lib/comms/provider";

export async function sendActionResultSms(input: {
  companyId: string;
  phone?: string | null;
  customerId?: string | null;
  body: string;
  send: boolean;
}) {
  if (!input.send || !input.phone || !input.body.trim()) return { sent: false as const };
  const result = await sendCompanyCommunication({
    companyId: input.companyId,
    channel: "SMS",
    to: input.phone,
    body: input.body,
    customerId: input.customerId,
    origin: "CONTRACTORYOU_ACTION_RESULT",
  });
  return { sent: Boolean(result.ok), outboundId: "ok" in result && result.ok ? result.provider : null };
}
