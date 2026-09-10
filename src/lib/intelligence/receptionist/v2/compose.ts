import { sanitizeCustomerSms } from "@/lib/intelligence/receptionist/sanitize";
import type { ReceptionistV2Classification, VerifiedFacts } from "@/lib/intelligence/receptionist/v2/types";

export function composeVerifiedReceptionistSms(input: {
  text: string;
  classification: ReceptionistV2Classification;
  facts: VerifiedFacts;
  personality: {
    assistantName: string;
    tone: string;
    responseLength: string;
    useCustomerFirstName: boolean;
  };
}) {
  const first = input.personality.useCustomerFirstName ? input.facts.customerFirstName : null;
  const name = first && shouldUseName(input.text) ? first : null;
  const hey = name ? `${name}, ` : "";
  const ask = input.facts.nextWorkflowAsk;
  const casual = Boolean(input.classification.extractedContext.casualAck);
  const question = input.classification.extractedContext.interruptingQuestion;

  if (input.classification.shouldHandoff || input.classification.intent === "EMERGENCY" || input.classification.intent === "COMPLAINT") {
    return sanitizeCustomerSms(
      "I don't want to give you the wrong information on that. Let me get the office to take a look."
    );
  }

  if (input.facts.bookingConfirmed && input.facts.appointmentDisplay) {
    const where = input.facts.serviceAddress ? ` at ${input.facts.serviceAddress}` : "";
    return sanitizeCustomerSms(`Perfect — you're all set for ${input.facts.appointmentDisplay}${where}.`);
  }

  if (question && input.facts.knowledgeAnswers?.length) {
    const answer = input.facts.knowledgeAnswers[0]!;
    return sanitizeCustomerSms(ask ? `${answer} ${ask}` : answer);
  }
  if (question && !input.facts.knowledgeAnswers?.length) {
    const unsure = "I don't want to guess on that. I can have the office confirm.";
    return sanitizeCustomerSms(ask ? `${unsure} ${ask}` : unsure);
  }

  if (input.facts.invoiceBalance) {
    return sanitizeCustomerSms(`${hey}I show ${input.facts.invoiceBalance} on the open invoice.`);
  }
  if (input.facts.estimateStatus) {
    return sanitizeCustomerSms(`${hey}${input.facts.estimateStatus}`);
  }
  if (input.facts.opportunityOffer && input.facts.hasActiveMembership === false) {
    return sanitizeCustomerSms(input.facts.opportunityOffer);
  }
  if (input.facts.membershipStatus) {
    return sanitizeCustomerSms(`${hey}${input.facts.membershipStatus}`);
  }
  if (input.facts.waitingStatus) {
    return sanitizeCustomerSms(`${hey}${input.facts.waitingStatus}`);
  }
  if (input.facts.jobStatus) {
    return sanitizeCustomerSms(`${hey}${input.facts.jobStatus}`);
  }

  if (input.facts.offeredSlots?.length) {
    return sanitizeCustomerSms(
      `I've got a few openings. ${input.facts.offeredSlots.join("; ")}. Which of these works best for you?`
    );
  }

  if (
    input.facts.properties?.length === 1 &&
    (input.facts.schedulingPhase === "NEED_PROPERTY" || ask?.toLowerCase().includes("property") || ask?.toLowerCase().includes("address"))
  ) {
    return sanitizeCustomerSms(
      `I have ${input.facts.properties[0]!.address} on your account. Is that where you're needing us?`
    );
  }

  if (ask) {
    if (casual) return sanitizeCustomerSms(`Of course! ${ask}`);
    return sanitizeCustomerSms(ask.startsWith("Absolutely") || ask.startsWith("Got it") ? ask : `Absolutely. ${ask}`);
  }

  if (input.classification.intent === "GREETING") {
    return sanitizeCustomerSms("Hey — what can I help you with today?");
  }
  if (input.classification.intent === "SCHEDULING") {
    return sanitizeCustomerSms("Got it. What's going on with the system?");
  }
  return sanitizeCustomerSms("I can help with that. What do you need?");
}

function shouldUseName(text: string) {
  return !/^(hi|hey|hello|thanks|ok|okay)\b/i.test(text.trim());
}

export function assertResponseUsesOnlyVerifiedFacts(input: { responseText: string; facts: VerifiedFacts }) {
  const text = input.responseText.toLowerCase();
  const allowed = [
    ...(input.facts.offeredSlots || []),
    input.facts.appointmentDisplay,
    input.facts.serviceAddress,
    input.facts.invoiceBalance,
    input.facts.estimateStatus,
    input.facts.membershipStatus,
    input.facts.opportunityOffer,
    input.facts.waitingStatus,
    input.facts.jobStatus,
    ...(input.facts.properties || []).map((row) => row.address),
    ...(input.facts.knowledgeAnswers || []),
    input.facts.customerFirstName,
    input.facts.companyName,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  const money = text.match(/\$[\d,]+(?:\.\d{2})?/);
  if (money && !allowed.some((value) => value.includes(money[0]!.replace("$", "")))) {
    return { ok: false as const, reason: "unverified_money" };
  }
  if (/\b(save \d+%|off this (month|week)|limited time|premium membership today)\b/i.test(input.responseText)) {
    return { ok: false as const, reason: "unverified_promotion" };
  }
  if (
    /\b(you're booked|you are booked|you're scheduled|you are scheduled|appointment is confirmed|you're all set|you are all set|all set for)\b/.test(
      text
    ) &&
    !input.facts.bookingConfirmed
  ) {
    return { ok: false as const, reason: "unverified_booking" };
  }
  return { ok: true as const };
}
