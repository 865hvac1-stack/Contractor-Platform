import { interpretSchedulingIntent } from "@/lib/scheduling/intent";
import { extractCustomerConcern, parsePersonName, parseServiceAddress } from "@/lib/scheduling/conversation-identity";
import type { ReceptionistV2Classification, ReceptionistV2Intent } from "@/lib/intelligence/receptionist/v2/types";

const GREETING = /^(hi|hey|hello|good (morning|afternoon|evening)|howdy)\b/i;
const THANKS = /\b(thanks|thank you|thx|appreciate you|awesome|ok thanks|okay thanks)\b/i;
const HUMAN = /\b(human|person|office|someone from the office|talk to (a )?person|speak to (a )?(human|person|rep)|representative|real person)\b/i;
const COMPLAINT = /\b(this is ridiculous|unacceptable|scam| rip.?off|worst|lawsuit|attorney|never coming back|angry|furious)\b/i;
const EMERGENCY = /\b(gas leak|smell gas|carbon monoxide|co detector|sparking|on fire|smoke|flooding|no heat and (it'?s|its) (freezing|below)|can'?t breathe)\b/i;
const JOB_STATUS = /\b(on (my|the) way|eta|where('?s| is) (my )?(tech|technician)|job status|are they coming)\b/i;
const WAITING = /\b(part|parts|waiting|backorder|order(ed)? that part|did you (order|get) the part)\b/i;
const ESTIMATE = /\b(estimate|quote|proposal)\b/i;
const INVOICE = /\b(invoice|balance|owe|what do i owe|bill|payment due)\b/i;
const PAYMENT = /\b(pay(ment)?|credit card|can i pay)\b/i;
const MEMBERSHIP = /\b(membership|maintenance plan|service plan)\b/i;
const MAINTENANCE = /\b(maintenance|tune[- ]?up|membership visit)\b/i;
const SERVICE_Q = /\b(do you (guys )?(work on|service|fix|install)|what (brands?|areas?)|hours|financing|warranty)\b/i;
const CASUAL = /^(ok|okay|cool|sounds good|got it|yep|yes|no problem|man it'?s been hot|lol|👍+|ok thanks|thanks!?)$/i;

export function fallbackClassifyReceptionistV2(input: {
  text: string;
  history?: Array<{ direction: string; body: string }>;
  hasActiveScheduling: boolean;
  assistantName?: string;
  timeZone?: string;
}): ReceptionistV2Classification {
  const text = input.text.trim();
  const extracted = {
    concern: extractCustomerConcern(text),
    customerName: parsePersonName(text) ? `${parsePersonName(text)!.firstName} ${parsePersonName(text)!.lastName}`.trim() : null,
    serviceAddress: parseServiceAddress(text)?.street ?? null,
    slotHint: null as string | null,
    casualAck: CASUAL.test(text) || THANKS.test(text),
    interruptingQuestion: SERVICE_Q.test(text) ? text : null,
  };

  if (EMERGENCY.test(text)) {
    return pack("EMERGENCY", 0.97, extracted, true, "emergency");
  }
  if (HUMAN.test(text)) {
    return pack("HUMAN_REQUEST", 0.98, extracted, true, "human_requested");
  }
  if (COMPLAINT.test(text)) {
    return pack("COMPLAINT", 0.9, extracted, true, "complaint");
  }

  const scheduling = interpretSchedulingIntent({
    text,
    timeZone: input.timeZone || "America/New_York",
  });
  if (scheduling.cancelIntent) return pack("CANCEL_APPOINTMENT", 0.9, extracted, false);
  if (scheduling.rescheduleIntent) return pack("RESCHEDULE", 0.9, extracted, false);

  if (INVOICE.test(text) && !PAYMENT.test(text)) return pack("INVOICE_BALANCE", 0.88, extracted, false);
  if (PAYMENT.test(text)) return pack("PAYMENT_QUESTION", 0.86, extracted, false);
  if (ESTIMATE.test(text)) return pack("ESTIMATE_STATUS", 0.86, extracted, false);
  if (MEMBERSHIP.test(text)) return pack("MEMBERSHIP", 0.84, extracted, false);
  if (WAITING.test(text)) return pack("WAITING_PART_STATUS", 0.84, extracted, false);
  if (JOB_STATUS.test(text)) return pack("JOB_STATUS", 0.84, extracted, false);
  if (MAINTENANCE.test(text) && !scheduling.serviceIntent) return pack("MAINTENANCE", 0.8, extracted, false);
  if (SERVICE_Q.test(text)) return pack("SERVICE_QUESTION", 0.82, extracted, false);
  if (GREETING.test(text) && text.split(/\s+/).length <= 4) return pack("GREETING", 0.8, extracted, false);

  if (input.hasActiveScheduling) {
    if (scheduling.requestedDate || scheduling.requestedDaypart || scheduling.requestedWindowId) {
      return pack("SCHEDULING", 0.93, { ...extracted, slotHint: text }, false);
    }
    if (extracted.casualAck && !extracted.interruptingQuestion) {
      return pack("SCHEDULING", 0.7, extracted, false);
    }
    if (extracted.interruptingQuestion) {
      return pack("SERVICE_QUESTION", 0.78, extracted, false);
    }
    return pack("SCHEDULING", 0.75, extracted, false);
  }

  if (scheduling.serviceIntent || scheduling.availabilityAsk || scheduling.requestedDate || extracted.concern) {
    return pack("SCHEDULING", scheduling.confidence === "high" ? 0.94 : 0.8, extracted, false);
  }
  if (THANKS.test(text) || CASUAL.test(text)) return pack("GREETING", 0.6, extracted, false);
  return pack("UNKNOWN", 0.35, extracted, false);
}

function pack(
  intent: ReceptionistV2Intent,
  confidence: number,
  extractedContext: ReceptionistV2Classification["extractedContext"],
  shouldHandoff: boolean,
  handoffReason?: string
): ReceptionistV2Classification {
  return { intent, confidence, extractedContext, shouldHandoff, handoffReason: handoffReason ?? null };
}

export function capabilityAllowsIntent(input: {
  intent: ReceptionistV2Intent;
  allowScheduling: boolean;
  allowRescheduling: boolean;
  allowCancellations: boolean;
  allowJobStatus: boolean;
  allowInvoiceQuestions: boolean;
  allowEstimateQuestions: boolean;
  allowMembershipQuestions: boolean;
  allowWaitingQuestions: boolean;
}) {
  if (input.intent === "SCHEDULING" || input.intent === "MAINTENANCE") return input.allowScheduling;
  if (input.intent === "RESCHEDULE") return input.allowRescheduling;
  if (input.intent === "CANCEL_APPOINTMENT") return input.allowCancellations;
  if (input.intent === "JOB_STATUS") return input.allowJobStatus;
  if (input.intent === "INVOICE_BALANCE" || input.intent === "PAYMENT_QUESTION") return input.allowInvoiceQuestions;
  if (input.intent === "ESTIMATE_STATUS") return input.allowEstimateQuestions;
  if (input.intent === "MEMBERSHIP") return input.allowMembershipQuestions;
  if (input.intent === "WAITING_PART_STATUS") return input.allowWaitingQuestions;
  return true;
}
