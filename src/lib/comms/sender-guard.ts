import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";

export function outboundPhonesAreDistinct(from?: string | null, to?: string | null) {
  const sender = canonicalizeUsPhone(from);
  const recipient = canonicalizeUsPhone(to);
  if (!sender || !recipient) return true;
  return sender !== recipient;
}

export function blockSelfAddressedSms(input: {
  from?: string | null;
  to?: string | null;
  customerPhone?: string | null;
  approvedSender?: string | null;
}) {
  if (!outboundPhonesAreDistinct(input.from, input.to)) {
    return {
      ok: false as const,
      reason: "sender_equals_recipient",
      error: "SMS sender and recipient resolved to the same number. Message was not sent.",
    };
  }
  if (
    input.from &&
    input.customerPhone &&
    phonesMatch(input.from, input.customerPhone) &&
    input.approvedSender &&
    !phonesMatch(input.from, input.approvedSender)
  ) {
    return {
      ok: false as const,
      reason: "sender_is_customer_phone",
      error: "SMS sender resolved to the customer phone, which is not the approved company number. Message was not sent.",
    };
  }
  return { ok: true as const };
}
