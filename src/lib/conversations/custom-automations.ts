import { z } from "zod";
import { getAIProvider, wrapUntrustedData } from "@/lib/intelligence/provider";

export const SUPPORTED_TRIGGERS = [
  "LEAD_CREATED", "MISSED_CALL", "JOB_BOOKED", "JOB_RESCHEDULED", "JOB_COMPLETED",
  "TECHNICIAN_ON_MY_WAY", "ESTIMATE_SENT", "ESTIMATE_OPEN", "PAYMENT_DUE",
  "PAYMENT_RECEIVED", "MAINTENANCE_DUE", "MEMBERSHIP_EXPIRING", "CUSTOMER_INACTIVE",
] as const;

export const SUPPORTED_GOALS = [
  "BOOK_MAINTENANCE", "CONFIRM_APPOINTMENT", "RECOVER_MISSED_CALL", "QUALIFY_NEW_LEAD",
  "FOLLOW_UP_ESTIMATE", "COLLECT_PAYMENT", "GET_REVIEW", "RENEW_MEMBERSHIP",
  "REACTIVATE_CUSTOMER", "PROMOTE_SEASONAL_OFFER", "ANSWER_PRE_ARRIVAL_QUESTIONS",
  "FOLLOW_UP_COMPLETED_JOB", "CREATE_TASK", "NOTIFY_OFFICE",
] as const;

export const ACTION_LABELS: Record<string, string> = {
  READ_CUSTOMER: "Read customer details",
  READ_PROPERTY: "Read property details",
  READ_JOB: "Read the connected job",
  READ_ESTIMATE: "Read the confirmed estimate",
  READ_INVOICE: "Read the confirmed invoice balance",
  READ_MEMBERSHIP: "Read membership status",
  CHECK_AVAILABILITY: "Check availability",
  BOOK_APPOINTMENT: "Offer appointment times and book",
  RESCHEDULE_APPOINTMENT: "Reschedule appointment",
  CANCEL_APPOINTMENT: "Cancel appointment according to rules",
  ADD_CUSTOMER_REQUEST_NOTE: "Add customer request to job",
  CREATE_FOLLOW_UP: "Create office task",
  SEND_ESTIMATE_LINK: "Send estimate link",
  SEND_PAYMENT_LINK: "Send secure payment link",
  SEND_REVIEW_LINK: "Send review link",
  REQUEST_HUMAN_HANDOFF: "Escalate to human",
};

export const REGINA_NEVER = [
  "Change pricing or totals",
  "Create unauthorized discounts",
  "Issue refunds",
  "Promise warranty coverage",
  "Override dispatch or scheduling rules",
  "Promise unavailable appointment times",
];

// Foundation for onboarding recommendations. Selecting a pack must only create
// drafts; activation always uses the normal readiness gate.
export const INDUSTRY_STARTER_PACKS: Record<string, string[]> = {
  HVAC: ["MISSED_CALL_TEXT_BACK", "BOOKING_CONFIRMATION", "APPOINTMENT_REMINDER", "TECHNICIAN_ON_THE_WAY", "MAINTENANCE_DUE", "UNSOLD_ESTIMATE_FOLLOW_UP", "REVIEW_REQUEST", "MEMBERSHIP_RENEWAL"],
  PLUMBING: ["MISSED_CALL_TEXT_BACK", "NEW_LEAD_CONVERSATION", "BOOKING_CONFIRMATION", "TECHNICIAN_ON_THE_WAY", "UNSOLD_ESTIMATE_FOLLOW_UP", "REVIEW_REQUEST"],
  ELECTRICAL: ["MISSED_CALL_TEXT_BACK", "NEW_LEAD_CONVERSATION", "BOOKING_CONFIRMATION", "TECHNICIAN_ON_THE_WAY", "UNSOLD_ESTIMATE_FOLLOW_UP", "REVIEW_REQUEST"],
  ROOFING: ["NEW_LEAD_CONVERSATION", "BOOKING_CONFIRMATION", "UNSOLD_ESTIMATE_FOLLOW_UP", "JOB_COMPLETE_FOLLOW_UP", "REVIEW_REQUEST"],
  POOL_SERVICE: ["NEW_LEAD_CONVERSATION", "APPOINTMENT_REMINDER", "MAINTENANCE_DUE", "PAST_CUSTOMER_REACTIVATION", "REVIEW_REQUEST"],
  PEST_CONTROL: ["MISSED_CALL_TEXT_BACK", "BOOKING_CONFIRMATION", "APPOINTMENT_REMINDER", "PAST_CUSTOMER_REACTIVATION", "REVIEW_REQUEST"],
  GARAGE_DOOR: ["MISSED_CALL_TEXT_BACK", "NEW_LEAD_CONVERSATION", "BOOKING_CONFIRMATION", "TECHNICIAN_ON_THE_WAY", "REVIEW_REQUEST"],
  LANDSCAPING: ["NEW_LEAD_CONVERSATION", "UNSOLD_ESTIMATE_FOLLOW_UP", "APPOINTMENT_REMINDER", "PAST_CUSTOMER_REACTIVATION", "REVIEW_REQUEST"],
  CLEANING: ["NEW_LEAD_CONVERSATION", "BOOKING_CONFIRMATION", "APPOINTMENT_REMINDER", "PAST_CUSTOMER_REACTIVATION", "REVIEW_REQUEST"],
  RESTORATION: ["MISSED_CALL_TEXT_BACK", "NEW_LEAD_CONVERSATION", "BOOKING_CONFIRMATION", "JOB_COMPLETE_FOLLOW_UP"],
  OTHER: ["MISSED_CALL_TEXT_BACK", "NEW_LEAD_CONVERSATION", "BOOKING_CONFIRMATION", "JOB_COMPLETE_FOLLOW_UP", "REVIEW_REQUEST"],
};

const COMMON = ["REQUEST_HUMAN_HANDOFF"];
export const GOAL_ACTIONS: Record<string, string[]> = {
  BOOK_MAINTENANCE: ["READ_CUSTOMER", "READ_PROPERTY", "CHECK_AVAILABILITY", "BOOK_APPOINTMENT", "CREATE_FOLLOW_UP", ...COMMON],
  CONFIRM_APPOINTMENT: ["READ_JOB", "READ_PROPERTY", "CHECK_AVAILABILITY", "RESCHEDULE_APPOINTMENT", "CANCEL_APPOINTMENT", "ADD_CUSTOMER_REQUEST_NOTE", ...COMMON],
  RECOVER_MISSED_CALL: ["READ_CUSTOMER", "READ_PROPERTY", "CHECK_AVAILABILITY", "BOOK_APPOINTMENT", "CREATE_FOLLOW_UP", ...COMMON],
  QUALIFY_NEW_LEAD: ["READ_CUSTOMER", "READ_PROPERTY", "CHECK_AVAILABILITY", "BOOK_APPOINTMENT", "CREATE_FOLLOW_UP", ...COMMON],
  FOLLOW_UP_ESTIMATE: ["READ_ESTIMATE", "SEND_ESTIMATE_LINK", "CREATE_FOLLOW_UP", ...COMMON],
  COLLECT_PAYMENT: ["READ_INVOICE", "SEND_PAYMENT_LINK", "CREATE_FOLLOW_UP", ...COMMON],
  GET_REVIEW: ["SEND_REVIEW_LINK", ...COMMON],
  RENEW_MEMBERSHIP: ["READ_MEMBERSHIP", "CREATE_FOLLOW_UP", ...COMMON],
  REACTIVATE_CUSTOMER: ["READ_CUSTOMER", "READ_PROPERTY", "CHECK_AVAILABILITY", "BOOK_APPOINTMENT", ...COMMON],
  PROMOTE_SEASONAL_OFFER: ["READ_CUSTOMER", "READ_PROPERTY", "CHECK_AVAILABILITY", "BOOK_APPOINTMENT", ...COMMON],
  ANSWER_PRE_ARRIVAL_QUESTIONS: ["READ_JOB", "READ_PROPERTY", "ADD_CUSTOMER_REQUEST_NOTE", ...COMMON],
  FOLLOW_UP_COMPLETED_JOB: ["READ_JOB", "CREATE_FOLLOW_UP", ...COMMON],
  CREATE_TASK: ["CREATE_FOLLOW_UP", ...COMMON],
  NOTIFY_OFFICE: ["CREATE_FOLLOW_UP", ...COMMON],
};

const schema = z.object({
  name: z.string().min(1).max(160),
  trigger: z.enum(SUPPORTED_TRIGGERS),
  goal: z.enum(SUPPORTED_GOALS),
  audience: z.enum(["EVENT_CUSTOMER", "RESIDENTIAL", "COMMERCIAL", "MAINTENANCE_MEMBERS", "NON_MEMBERS"]),
  delayMinutes: z.number().int().min(0).max(525_600),
  conditions: z.array(z.enum(["CUSTOMER_NOT_OPTED_OUT", "SOURCE_STILL_ACTIVE", "CUSTOMER_HAS_NOT_BOOKED", "PROMOTION_ACTIVE"])).max(6),
  allowedActions: z.array(z.string()).max(10),
  stopConditions: z.array(z.string()).min(1).max(10),
  firstMessage: z.string().min(1).max(1500),
  summary: z.string().min(1).max(1000),
});

export type StructuredAutomation = z.infer<typeof schema>;

export async function interpretAutomationRequest(request: string, companyName: string): Promise<StructuredAutomation> {
  const fallback = deterministicInterpretation(request, companyName);
  const provider = getAIProvider();
  if (!provider) return fallback;
  try {
    const response = await provider.complete({
      tools: false,
      messages: [
        {
          role: "system",
          content: [
            "Convert a contractor owner's request into a safe structured automation. Return JSON only.",
            `Triggers: ${SUPPORTED_TRIGGERS.join(", ")}.`,
            `Goals: ${SUPPORTED_GOALS.join(", ")}.`,
            "Use only allowedActions supplied by the goal's known minimum permissions. Never grant discounts, refunds, pricing changes, invoice edits, estimate edits, schedule overrides, or accounting actions.",
            "delayMinutes must be 0..525600. Use event customer as audience unless explicitly residential, commercial, members, or non-members.",
            'JSON fields: name, trigger, goal, audience, delayMinutes, conditions, firstMessage, summary.',
            "First message may use only {{customer.firstName}}, {{company.name}}, {{assistant.name}}, {{property.address}}, {{job.appointmentWindow}}, {{technician.firstName}}, {{promotion.offer}}.",
          ].join(" "),
        },
        { role: "user", content: wrapUntrustedData("owner_automation_request", { request, companyName }) },
      ],
    });
    const raw = JSON.parse(response.text) as Record<string, unknown>;
    const goal = String(raw.goal || fallback.goal);
    const candidate = {
      ...fallback,
      ...raw,
      goal,
      allowedActions: minimumActions(goal),
      stopConditions: defaultStops(goal),
    };
    const parsed = schema.safeParse(candidate);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function deterministicInterpretation(request: string, companyName: string): StructuredAutomation {
  const text = request.toLowerCase();
  const trigger = text.includes("miss") && text.includes("call") ? "MISSED_CALL"
    : text.includes("estimate") ? "ESTIMATE_OPEN"
      : text.includes("invoice") || text.includes("payment") ? "PAYMENT_DUE"
        : text.includes("maintenance") ? "JOB_COMPLETED"
          : text.includes("on my way") || text.includes("on the way") ? "TECHNICIAN_ON_MY_WAY"
            : text.includes("inactive") || text.includes("haven't had service") ? "CUSTOMER_INACTIVE"
              : text.includes("lead") ? "LEAD_CREATED" : "JOB_COMPLETED";
  const goal = text.includes("estimate") ? "FOLLOW_UP_ESTIMATE"
    : text.includes("invoice") || text.includes("payment") ? "COLLECT_PAYMENT"
      : text.includes("miss") && text.includes("call") ? "RECOVER_MISSED_CALL"
        : text.includes("review") ? "GET_REVIEW"
          : text.includes("maintenance") ? "BOOK_MAINTENANCE"
            : text.includes("inactive") || text.includes("scheduled again") ? "REACTIVATE_CUSTOMER"
              : "FOLLOW_UP_COMPLETED_JOB";
  const delayMinutes = parseDelayMinutes(text);
  const label = friendly(goal);
  return schema.parse({
    name: `${delayMinutes ? friendlyDelay(delayMinutes) + " " : ""}${label}`,
    trigger,
    goal,
    audience: text.includes("commercial") ? "COMMERCIAL" : text.includes("residential") ? "RESIDENTIAL" : "EVENT_CUSTOMER",
    delayMinutes,
    conditions: ["CUSTOMER_NOT_OPTED_OUT", "SOURCE_STILL_ACTIVE", ...(goal.includes("BOOK") ? ["CUSTOMER_HAS_NOT_BOOKED" as const] : [])],
    allowedActions: minimumActions(goal),
    stopConditions: defaultStops(goal),
    firstMessage: defaultFirstMessage(goal, companyName),
    summary: `${delayMinutes ? friendlyDelay(delayMinutes) + " after" : "When"} ${friendly(trigger).toLowerCase()}, Regina will contact the connected customer and work toward ${friendly(goal).toLowerCase()}.`,
  });
}

export function minimumActions(goal: string) {
  const actions = GOAL_ACTIONS[goal] || ["CREATE_FOLLOW_UP", "REQUEST_HUMAN_HANDOFF"];
  return actions.filter((action) => action !== "CANCEL_APPOINTMENT");
}

export function defaultStops(goal: string) {
  return ["GOAL_COMPLETED", "CUSTOMER_DECLINED", "CUSTOMER_OPTED_OUT", "HUMAN_TAKEOVER", "SOURCE_CANCELLED", "MAXIMUM_ATTEMPTS_REACHED", ...(goal === "COLLECT_PAYMENT" ? ["INVOICE_PAID"] : [])];
}

export function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function friendlyDelay(minutes: number) {
  if (minutes % 43_200 === 0) return `${minutes / 43_200} month${minutes === 43_200 ? "" : "s"}`;
  if (minutes % 10_080 === 0) return `${minutes / 10_080} week${minutes === 10_080 ? "" : "s"}`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} day${minutes === 1_440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

function parseDelayMinutes(text: string) {
  const match = text.match(/(\d+|one|two|three|six|twelve)\s*(minute|hour|day|week|month)s?/);
  if (!match) return text.includes("immediate") ? 0 : text.includes("six month") ? 259_200 : 0;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, six: 6, twelve: 12 };
  const value = Number(match[1]) || words[match[1]] || 0;
  const factor: Record<string, number> = { minute: 1, hour: 60, day: 1_440, week: 10_080, month: 43_200 };
  return value * factor[match[2]];
}

function defaultFirstMessage(goal: string, _companyName: string) {
  const base: Record<string, string> = {
    BOOK_MAINTENANCE: "Hey {{customer.firstName}}! This is {{assistant.name}} with {{company.name}}. It may be time for maintenance. Want me to check what we have available?",
    FOLLOW_UP_ESTIMATE: "Hey {{customer.firstName}}, {{assistant.name}} with {{company.name}} here. I wanted to make sure you received your estimate. What questions can I help with?",
    COLLECT_PAYMENT: "Hey {{customer.firstName}}, this is {{assistant.name}} with {{company.name}}. There is still a confirmed balance on your service visit. Would you like the secure payment link?",
    RECOVER_MISSED_CALL: "Hey {{customer.firstName}}, this is {{assistant.name}} with {{company.name}}. Sorry we missed your call! What can I help you with?",
    REACTIVATE_CUSTOMER: "Hey {{customer.firstName}}, it's {{assistant.name}} with {{company.name}}. It's been a little while since we've been out. Would you like me to check available times?",
  };
  return base[goal] || "Hey {{customer.firstName}}, this is {{assistant.name}} with {{company.name}}. I wanted to follow up. How can I help?";
}
