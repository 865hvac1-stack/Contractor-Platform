import { sanitizeCustomerSms } from "@/lib/intelligence/receptionist/sanitize";
import {
  responseInventedRepairGuidance,
  responseInventedUnmentionedAppliance,
} from "@/lib/intelligence/receptionist/v2/conversation-state";
import type { ReceptionistV2Classification, VerifiedFacts } from "@/lib/intelligence/receptionist/v2/types";

const SAFE_NO_TROUBLESHOOT =
  "I don't want to walk you through anything that could be unsafe. I can help get someone out to take a look.";
const SERVICE_OFFER = "That's something we can take a look at. Want me to check our openings?";
const CONCERN_REASK = /going on with the system/i;

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
  const ask = skipKnownConcernAsk(input.facts.nextWorkflowAsk, input.facts);
  const casual = Boolean(input.classification.extractedContext.casualAck);
  const question = input.classification.extractedContext.interruptingQuestion;
  const concern = input.facts.currentServiceConcern || input.classification.extractedContext.concern;
  const offerScheduling = Boolean(input.facts.offerScheduling) && !input.facts.hasActiveAppointment && !input.facts.activeSchedulingSession;

  if (input.classification.shouldHandoff || input.classification.intent === "EMERGENCY" || input.classification.intent === "COMPLAINT") {
    return sanitizeCustomerSms(
      "I don't want to give you the wrong information on that. Let me get the office to take a look."
    );
  }

  if (input.facts.bookingConfirmed && input.facts.appointmentDisplay) {
    const where = input.facts.serviceAddress ? ` at ${input.facts.serviceAddress}` : "";
    return sanitizeCustomerSms(`Perfect — you're all set for ${input.facts.appointmentDisplay}${where}.`);
  }

  if (question && input.facts.knowledgeAnswers?.length && !input.facts.serviceConcernActive) {
    const answer = input.facts.knowledgeAnswers[0]!;
    return sanitizeCustomerSms(ask ? `${answer} ${ask}` : answer);
  }
  if (question && !input.facts.knowledgeAnswers?.length && !input.facts.serviceConcernActive) {
    const unsure = "I don't want to guess on that. I can have the office confirm.";
    return sanitizeCustomerSms(ask ? `${unsure} ${ask}` : unsure);
  }

  if (input.facts.invoiceBalance) {
    return sanitizeCustomerSms(`${hey}I show ${input.facts.invoiceBalance} on the open invoice.`);
  }
  if (input.facts.estimateStatus) {
    return sanitizeCustomerSms(`${hey}${input.facts.estimateStatus}`);
  }
  if (input.facts.opportunityOffer && input.facts.hasActiveMembership === false && !input.facts.serviceConcernActive) {
    return sanitizeCustomerSms(input.facts.opportunityOffer);
  }
  if (input.facts.membershipStatus && !input.facts.serviceConcernActive) {
    return sanitizeCustomerSms(`${hey}${input.facts.membershipStatus}`);
  }
  if (input.facts.waitingStatus) {
    return sanitizeCustomerSms(`${hey}${input.facts.waitingStatus}`);
  }
  if (input.facts.jobStatus && !input.facts.serviceConcernActive) {
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

  if (
    input.facts.hasActiveAppointment &&
    (input.facts.serviceConcernActive ||
      input.classification.intent === "SCHEDULING" ||
      input.classification.extractedContext.acceptedSchedulingOffer)
  ) {
    if (input.facts.appointmentDisplay) {
      return sanitizeCustomerSms(
        `I show you already have ${input.facts.appointmentDisplay}. I don't want to book another visit on top of that. I'll make sure the office knows about the extra concern.`
      );
    }
    return sanitizeCustomerSms(
      "I hear you already have someone coming. I don't want to book another visit on top of that. I'll have the office note the extra concern."
    );
  }

  if (input.classification.extractedContext.acceptedSchedulingOffer || input.facts.acceptedSchedulingOffer) {
    if (ask) return sanitizeCustomerSms(casual ? `Of course! ${ask}` : ask.startsWith("Absolutely") || ask.startsWith("Got it") ? ask : `Got it. ${ask}`);
    return sanitizeCustomerSms("Got it. I'll get that service visit started.");
  }

  if (input.facts.serviceConcernActive && (input.classification.extractedContext.nextAction === "OFFER_SCHEDULING" || offerScheduling)) {
    if (/\bhow (do|can) i (stop|fix|shut)|stop it running|make it stop\b/i.test(input.text)) {
      const safe = input.facts.knowledgeAnswers?.[0] || input.facts.safeGuidance || SAFE_NO_TROUBLESHOOT;
      return sanitizeCustomerSms(offerScheduling ? `${safe} ${input.facts.opportunityOffer || SERVICE_OFFER}` : safe);
    }
    return sanitizeCustomerSms(input.facts.opportunityOffer || SERVICE_OFFER);
  }

  if (ask) {
    if (casual) return sanitizeCustomerSms(`Of course! ${ask}`);
    return sanitizeCustomerSms(ask.startsWith("Absolutely") || ask.startsWith("Got it") ? ask : `Absolutely. ${ask}`);
  }

  if (input.classification.intent === "GREETING") {
    return sanitizeCustomerSms("Hey — what can I help you with today?");
  }
  if (input.classification.intent === "SCHEDULING") {
    if (concern) return sanitizeCustomerSms("Got it. I'll get that service visit started.");
    return sanitizeCustomerSms("Absolutely. What's going on with the system?");
  }
  if (input.classification.intent === "SERVICE_CONCERN") {
    return sanitizeCustomerSms(offerScheduling ? SERVICE_OFFER : "Got it. I can help with that.");
  }
  return sanitizeCustomerSms("I can help with that. What do you need?");
}

function skipKnownConcernAsk(ask: string | null | undefined, facts: VerifiedFacts) {
  if (!ask) return null;
  if (CONCERN_REASK.test(ask) && (facts.currentServiceConcern || facts.serviceConcernActive)) return null;
  return ask;
}

function shouldUseName(text: string) {
  return !/^(hi|hey|hello|thanks|ok|okay|yes|yeah|yep|sure|please|no)\b/i.test(text.trim());
}

export function assertResponseUsesOnlyVerifiedFacts(input: {
  responseText: string;
  facts: VerifiedFacts;
  conversationText?: string;
}) {
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
    input.facts.currentServiceConcern,
    input.facts.currentSubject,
    input.facts.safeGuidance,
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
  const conversationText = input.conversationText || input.facts.conversationText || "";
  if (responseInventedUnmentionedAppliance({ responseText: input.responseText, conversationText })) {
    return { ok: false as const, reason: "invented_subject" };
  }
  if (responseInventedRepairGuidance({ responseText: input.responseText, knowledgeAnswers: input.facts.knowledgeAnswers })) {
    return { ok: false as const, reason: "invented_repair" };
  }
  if (/^hi\s+\w+!/i.test(input.responseText.trim()) && conversationText.length > 0) {
    return { ok: false as const, reason: "restarted_greeting" };
  }
  if (
    input.facts.canScheduleService &&
    /\b(can'?t|cannot|unable to|not able to) (schedule|book)\b|\bdon'?t schedule\b|\bschedule (a service call )?directly\b/i.test(
      input.responseText
    )
  ) {
    return { ok: false as const, reason: "denied_enabled_capability" };
  }
  return { ok: true as const };
}
