import { extractCustomerConcern } from "@/lib/scheduling/conversation-identity";
import type { ReceptionistV2Action, ReceptionistV2Intent } from "@/lib/intelligence/receptionist/v2/types";

export const CONVERSATION_SUBJECTS = [
  "hvac_system",
  "heating",
  "cooling",
  "thermostat",
  "indoor_unit",
  "outdoor_unit",
  "fan_blower",
  "maintenance",
  "appointment",
  "invoice",
  "estimate",
  "membership",
] as const;

export type ConversationSubject = (typeof CONVERSATION_SUBJECTS)[number];

export type ConversationNextAction =
  | "ANSWER_FROM_KNOWLEDGE"
  | "OFFER_SCHEDULING"
  | "START_SCHEDULING"
  | "CONTINUE_SCHEDULING"
  | "HANDOFF"
  | "none";

export type ReceptionistConversationState = {
  currentSubject: ConversationSubject | null;
  currentSubjectLabel: string | null;
  currentServiceConcern: string | null;
  serviceConcernActive: boolean;
  outstandingQuestion: string | null;
  outstandingSchedulingOffer: boolean;
  lastRelevantIntent: string | null;
  acceptedSchedulingOffer: boolean;
  declinedSchedulingOffer: boolean;
  isInformationalQuestion: boolean;
  isServiceProblem: boolean;
  isTroubleshootingAsk: boolean;
  mentionsExistingAppointment: boolean;
  isContinuation: boolean;
  nextAction: ConversationNextAction;
};

const SUBJECT_PATTERNS: Array<{ subject: ConversationSubject; label: string; re: RegExp }> = [
  { subject: "cooling", label: "cooling", re: /\b(ac|a\/c|air ?cond(?:itioner|itioning)?|cool(?:ing|s)?|not cool(?:ing)?)\b/i },
  { subject: "heating", label: "heating", re: /\b(heat(?:ing|er)?|furnace|no heat)\b/i },
  { subject: "thermostat", label: "thermostat", re: /\bthermostat\b/i },
  { subject: "outdoor_unit", label: "outdoor unit", re: /\b(outdoor|outside) (unit|condenser|fan)\b/i },
  { subject: "indoor_unit", label: "indoor unit", re: /\b(indoor unit|air handler)\b/i },
  { subject: "fan_blower", label: "fan/blower", re: /\b((?:fan|blower)(?: motor)?)\b/i },
  {
    subject: "hvac_system",
    label: "HVAC system",
    re: /\b(hvac|the (?:unit|system)|my (?:unit|system)|the equipment|trane|carrier|lennox|goodman|rheem|york|american standard)\b/i,
  },
  { subject: "maintenance", label: "maintenance", re: /\b(maintenance|tune[- ]?up)\b/i },
  { subject: "appointment", label: "appointment", re: /\b(appointment|tech(?:nician)? coming|someone coming)\b/i },
  { subject: "invoice", label: "invoice", re: /\b(invoice|balance|bill|what do i owe)\b/i },
  { subject: "estimate", label: "estimate", re: /\b(estimate|quote|proposal)\b/i },
  { subject: "membership", label: "membership", re: /\b(membership|maintenance plan|service plan)\b/i },
];

const SERVICE_PROBLEM =
  /\b(won'?t (?:shut|turn|cut) off|keeps? running|running (?:nonstop|constantly|all (?:the )?time|and won'?t)|won'?t stop|not (?:cooling|heating|working)|isn'?t (?:cooling|heating|working)|broken|grinding|noise|leaking|frozen|ice|humming|won'?t spin|making (?:a )?(?:noise|sound)|no (?:heat|cooling|ac)|not shutting off)\b/i;

const CONTINUATION =
  /\b(it|that|this|the unit|the system|same thing|that one|it keeps|it'?s running|yes it'?s running|still running|won'?t stop|how do i stop|stop it(?: running)?|shut(?: it)? off)\b/i;

const SHORT_FOLLOW_UP =
  /^(yes|yeah|yep|yup|no|nope|ok|okay|sure|please|thanks|thank you|got it|cool)([.!, ]*)?$/i;

const INFORMATIONAL =
  /\b(what (?:size|does|is|are)|do you (?:guys )?(?:work on|service|fix|install)|what brands?|seer|filter size|hours|financing|warranty)\b/i;

const TROUBLESHOOT =
  /\b(how (?:do|can) i (?:stop|fix|reset|unplug|shut)|what should i (?:do|check)|can i (?:reset|unplug|turn it off)|stop it running|make it stop)\b/i;

const SCHEDULING_OFFER =
  /\b(want me to (?:check(?: our)? openings|get (?:a |someone|a tech|a service)|schedule)|check(?: our)? openings|get a service visit|get someone out|service visit scheduled)\b/i;

const ACCEPT_OFFER =
  /^(yes|yeah|yep|yup|sure|please|yes please|yes,? please|that works|okay|ok|ok please|let'?s do it|go ahead|sounds good|please do|do it)([.!, ]*)?$/i;

const DECLINE_OFFER =
  /^(no|nope|nah|no thanks|no thank you|not right now|maybe later)([.!, ]*)?$/i;

const EXISTING_APPOINTMENT =
  /\b(already have (?:someone|a tech|an? appointment)|someone(?:'s| is) (?:already )?coming|i (?:already )?have (?:a |an )?(?:appointment|tech)|already scheduled|coming tuesday|have someone coming)\b/i;

const EXPLICIT_SCHEDULE =
  /\b(i need (?:someone|a tech|service|an appointment|a service call)|come out|send someone|schedule|book (?:a |an )?(?:appointment|visit)|set up (?:a |an )?(?:appointment|visit)|can (?:i|you|we) (?:get|schedule|book)|someone come out|service call scheduled)\b/i;

const INVENTED_APPLIANCES = /\b(refrigerator|fridge|freezer|dishwasher|washer|dryer|oven|stove|microwave)\b/i;

const UNSAFE_REPAIR =
  /\b(unplug it|cut the (?:power|breaker)|open the panel|replace the capacitor|jump(?:er)? the|bypass the|reset the breaker for me)\b/i;

export function conversationCorpus(history: Array<{ direction?: string; body?: string | null }>, text?: string) {
  return [...history.map((row) => row.body || ""), text || ""].join("\n");
}

export function inferSubjectFromText(text: string): { subject: ConversationSubject; label: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const row of SUBJECT_PATTERNS) {
    if (row.re.test(trimmed)) return { subject: row.subject, label: row.label };
  }
  return null;
}

export function lastOutboundBody(history: Array<{ direction: string; body: string }>) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (/out/i.test(history[i]!.direction)) return history[i]!.body;
  }
  return null;
}

export function isOutstandingSchedulingOffer(text?: string | null) {
  return Boolean(text && SCHEDULING_OFFER.test(text));
}

export function isSchedulingOfferAcceptance(text: string, outstanding: boolean) {
  if (!outstanding) return false;
  return ACCEPT_OFFER.test(text.trim());
}

export function isInformationalServiceQuestion(text: string) {
  return INFORMATIONAL.test(text) && !SERVICE_PROBLEM.test(text);
}

export function isServiceProblemText(text: string) {
  return SERVICE_PROBLEM.test(text) || Boolean(extractCustomerConcern(text));
}

export function mentionsExistingAppointment(text: string) {
  return EXISTING_APPOINTMENT.test(text);
}

export function isTroubleshootingAsk(text: string) {
  return TROUBLESHOOT.test(text);
}

export function responseInventedUnmentionedAppliance(input: { responseText: string; conversationText: string }) {
  const mentioned = INVENTED_APPLIANCES.test(input.conversationText);
  return !mentioned && INVENTED_APPLIANCES.test(input.responseText);
}

export function responseInventedRepairGuidance(input: { responseText: string; knowledgeAnswers?: string[] }) {
  if (!UNSAFE_REPAIR.test(input.responseText)) return false;
  const allowed = (input.knowledgeAnswers || []).join(" ");
  return !UNSAFE_REPAIR.test(allowed);
}

export function inferConversationState(input: {
  text: string;
  history?: Array<{ direction: string; body: string }>;
  hasActiveScheduling?: boolean;
  hasActiveAppointment?: boolean;
  lastIntent?: string | null;
  lastOutbound?: string | null;
  lastConcern?: string | null;
  lastSubject?: ConversationSubject | null;
  schedulingConcern?: string | null;
}): ReceptionistConversationState {
  const text = input.text.trim();
  const history = input.history || [];
  const outbound = input.lastOutbound || lastOutboundBody(history);
  const outstandingSchedulingOffer = isOutstandingSchedulingOffer(outbound);
  const acceptedSchedulingOffer = isSchedulingOfferAcceptance(text, outstandingSchedulingOffer);
  const declinedSchedulingOffer = outstandingSchedulingOffer && DECLINE_OFFER.test(text);
  const informational = isInformationalServiceQuestion(text);
  const troubleshooting = isTroubleshootingAsk(text);
  const existingApptMention = mentionsExistingAppointment(text);
  const currentProblem = isServiceProblemText(text);

  let inferred: { subject: ConversationSubject; label: string } | null = inferSubjectFromText(text);
  let concern = extractCustomerConcern(text) || (currentProblem ? text.slice(0, 400) : null);

  if (!inferred || !concern) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (!/in/i.test(history[i]!.direction)) continue;
      const body = history[i]!.body;
      if (!inferred) inferred = inferSubjectFromText(body);
      if (!concern) {
        const prior = extractCustomerConcern(body) || (isServiceProblemText(body) ? body.slice(0, 400) : null);
        if (prior) concern = prior;
      }
      if (inferred && concern) break;
    }
  }

  if (!inferred && input.lastSubject) {
    inferred = { subject: input.lastSubject, label: subjectLabel(input.lastSubject) };
  }
  if (!concern) concern = input.lastConcern || input.schedulingConcern || null;
  if (!inferred && (concern || input.schedulingConcern)) {
    inferred = inferSubjectFromText(concern || input.schedulingConcern || "");
  }

  const priorServiceContext = Boolean(
    concern ||
      input.lastConcern ||
      input.schedulingConcern ||
      (inferred && inferred.subject !== "invoice" && inferred.subject !== "estimate" && inferred.subject !== "membership")
  );
  const continuation = Boolean(priorServiceContext && (CONTINUATION.test(text) || SHORT_FOLLOW_UP.test(text) || troubleshooting));
  const serviceConcernActive = Boolean(currentProblem || (continuation && priorServiceContext));

  const nextAction = resolveConversationNextAction({
    hasActiveScheduling: Boolean(input.hasActiveScheduling),
    hasActiveAppointment: Boolean(input.hasActiveAppointment) || existingApptMention,
    acceptedSchedulingOffer,
    declinedSchedulingOffer,
    informational,
    serviceConcernActive,
    explicitSchedule: EXPLICIT_SCHEDULE.test(text),
    troubleshooting,
  });

  return {
    currentSubject: inferred?.subject ?? null,
    currentSubjectLabel: inferred?.label ?? null,
    currentServiceConcern: concern,
    serviceConcernActive,
    outstandingQuestion: outstandingSchedulingOffer ? outbound : null,
    outstandingSchedulingOffer,
    lastRelevantIntent: input.lastIntent ?? null,
    acceptedSchedulingOffer,
    declinedSchedulingOffer,
    isInformationalQuestion: informational && !serviceConcernActive,
    isServiceProblem: currentProblem || serviceConcernActive,
    isTroubleshootingAsk: troubleshooting,
    mentionsExistingAppointment: existingApptMention,
    isContinuation: continuation,
    nextAction,
  };
}

export function resolveConversationNextAction(input: {
  hasActiveScheduling: boolean;
  hasActiveAppointment: boolean;
  acceptedSchedulingOffer: boolean;
  declinedSchedulingOffer?: boolean;
  informational: boolean;
  serviceConcernActive: boolean;
  explicitSchedule: boolean;
  troubleshooting?: boolean;
}): ConversationNextAction {
  if (input.hasActiveScheduling) return "CONTINUE_SCHEDULING";
  if (input.hasActiveAppointment && !input.explicitSchedule) {
    if (input.informational) return "ANSWER_FROM_KNOWLEDGE";
    return "none";
  }
  if (input.acceptedSchedulingOffer) return "START_SCHEDULING";
  if (input.explicitSchedule) return "START_SCHEDULING";
  if (input.informational && !input.serviceConcernActive) return "ANSWER_FROM_KNOWLEDGE";
  if (input.serviceConcernActive || input.troubleshooting) return "OFFER_SCHEDULING";
  return "none";
}

export function actionFromConversationState(input: {
  intent: ReceptionistV2Intent | string;
  nextAction: ConversationNextAction;
  defaultAction: ReceptionistV2Action;
}): ReceptionistV2Action {
  if (input.nextAction === "HANDOFF") return "requestHumanHandoff";
  if (input.nextAction === "START_SCHEDULING") return "startScheduling";
  if (input.nextAction === "CONTINUE_SCHEDULING") return "continue_workflow";
  if (input.nextAction === "ANSWER_FROM_KNOWLEDGE") return "answer_from_knowledge";
  if (input.nextAction === "OFFER_SCHEDULING") return "continue_workflow";
  if (input.intent === "SCHEDULING" || input.intent === "RESCHEDULE") return input.defaultAction;
  return input.defaultAction;
}

function subjectLabel(subject: ConversationSubject) {
  return SUBJECT_PATTERNS.find((row) => row.subject === subject)?.label ?? subject.replaceAll("_", " ");
}
