import type { ReceptionistV2Intent, VerifiedFacts } from "@/lib/intelligence/receptionist/v2/types";

export const TRAINING_KNOWLEDGE_LIMIT = 3;
export const TRAINING_RULE_LIMIT = 8;
export const TRAINING_EXAMPLE_LIMIT = 2;

export const STARTER_CONVERSATION_RULES = [
  "Greet once, not every message.",
  "Do not start every response with the customer's name.",
  "Use the customer's first name naturally and occasionally.",
  "Keep SMS replies concise.",
  "Sound like a great local office person, not a chatbot.",
  "Do not restart an active conversation.",
  "Do not repeatedly say \"How can I assist you today?\"",
  "Answer casual conversation naturally.",
  "If the customer says thanks, ok, sounds good, or awesome, acknowledge it and stay on the active workflow.",
  "If the customer asks a side question during a workflow, answer it and then return to the outstanding task.",
  "Never diagnose HVAC problems.",
  "Never invent pricing, benefits, discounts, or plan terms.",
  "Never invent availability.",
  "Never claim an action succeeded without verified ContractorYou success.",
  "Never say a customer is booked, canceled, rescheduled, paid, enrolled, or updated unless ContractorYou verifies it.",
];

export const STARTER_MAINTENANCE_OPPORTUNITY = {
  type: "MAINTENANCE",
  title: "Maintenance plan",
  triggerText: "Customer asks about maintenance or membership",
  verifiedRequirement: "Verified ContractorYou membership status is none or inactive",
  suggestedBehavior: "Answer the verified status clearly, then offer plan information naturally. Do not invent price, benefits, or terms. Do not enroll them.",
  cta: "We do offer one though — want me to send you the details?",
};

export type TrainingKnowledge = {
  id: string;
  question: string;
  answer: string;
  category: string;
  active: boolean;
};

export type TrainingRule = {
  id: string;
  body: string;
  active: boolean;
  priority: number;
};

export type TrainingOpportunityRule = {
  id: string;
  type: string;
  title: string;
  triggerText: string;
  verifiedRequirement: string;
  suggestedBehavior: string;
  cta: string | null;
  active: boolean;
  priority: number;
};

export type TrainingExample = {
  id: string;
  customerMessage: string;
  preferredResponse: string;
  intent: string;
  active: boolean;
};

export type TrainingSources = {
  knowledgeIds: string[];
  ruleIds: string[];
  opportunityRuleId: string | null;
  exampleIds: string[];
};

const MAINTENANCE_ASK = /\b(maintenance|membership|service plan|maintenance (plan|agreement))\b/i;
const DECLINE = /\b(no thanks|no thank you|not interested|don't want|do not want|nah|nope)\b/i;

export function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
}

export function scoreOverlap(query: string, document: string) {
  const q = new Set(tokenize(query));
  if (!q.size) return 0;
  const words = tokenize(document);
  let hits = 0;
  for (const word of words) if (q.has(word)) hits += 1;
  return hits / q.size;
}

export function retrieveRelevantKnowledge(input: {
  items: TrainingKnowledge[];
  text: string;
  intent: string;
  limit?: number;
}) {
  const active = input.items.filter((item) => item.active);
  const scored = active
    .map((item) => ({
      item,
      score:
        scoreOverlap(input.text, `${item.question} ${item.answer} ${item.category}`) +
        (item.category.toLowerCase() === input.intent.toLowerCase() ? 0.2 : 0),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? TRAINING_KNOWLEDGE_LIMIT);
  return scored.map((row) => row.item);
}

export function retrieveRelevantExamples(input: {
  examples: TrainingExample[];
  text: string;
  intent: string;
  facts: Pick<VerifiedFacts, "hasActiveMembership" | "invoiceBalance" | "estimateStatus">;
  limit?: number;
}) {
  const active = input.examples.filter((item) => item.active);
  const scored = active
    .map((item) => {
      const conflictsVerifiedMembership =
        input.facts.hasActiveMembership === true &&
        /\b(don't see|do not see|no active|not (on|set up)|aren't on)\b/i.test(item.preferredResponse);
      if (conflictsVerifiedMembership) return { item, score: -1 };
      const score =
        scoreOverlap(input.text, `${item.customerMessage} ${item.preferredResponse}`) +
        (item.intent === input.intent ? 0.35 : 0);
      return { item, score };
    })
    .filter((row) => row.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? TRAINING_EXAMPLE_LIMIT);
  return scored.map((row) => row.item);
}

export function conversationRulesForPrompt(rules: TrainingRule[]) {
  return [...rules]
    .filter((rule) => rule.active)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, TRAINING_RULE_LIMIT);
}

export function customerDeclinedOpportunity(text: string) {
  return DECLINE.test(text);
}

export function qualifiesMaintenanceAsk(input: { text: string; intent: string }) {
  return input.intent === "MEMBERSHIP" || input.intent === "MAINTENANCE" || MAINTENANCE_ASK.test(input.text);
}

export function qualifyOpportunity(input: {
  rules: TrainingOpportunityRule[];
  text: string;
  intent: string;
  facts: Pick<VerifiedFacts, "hasActiveMembership" | "membershipStatus" | "invoiceBalance" | "estimateStatus" | "waitingStatus" | "jobStatus">;
  declinedTypes: string[];
  offeredTypes: string[];
}): TrainingOpportunityRule | null {
  if (customerDeclinedOpportunity(input.text)) return null;
  const active = [...input.rules].filter((rule) => rule.active).sort((a, b) => a.priority - b.priority);
  for (const rule of active) {
    if (input.declinedTypes.includes(rule.type) || input.offeredTypes.includes(rule.type)) continue;
    if (rule.type === "MAINTENANCE" || rule.type === "MEMBERSHIP") {
      if (!qualifiesMaintenanceAsk(input)) continue;
      if (input.facts.hasActiveMembership !== false) continue;
      return rule;
    }
    if (rule.type === "ESTIMATE_FOLLOW_UP") {
      if (input.intent !== "ESTIMATE_STATUS" || !input.facts.estimateStatus) continue;
      if (!/\b(sent|viewed|draft|open)\b/i.test(input.facts.estimateStatus)) continue;
      return rule;
    }
    if (rule.type === "PAYMENT") {
      if ((input.intent !== "INVOICE_BALANCE" && input.intent !== "PAYMENT_QUESTION") || !input.facts.invoiceBalance) continue;
      return rule;
    }
    if (rule.type === "WAITING_ON_PART") {
      if (input.intent !== "WAITING_PART_STATUS" || !input.facts.waitingStatus) continue;
      return rule;
    }
    if (rule.type === "SECOND_PROPERTY") {
      if (!/\b(other|another) (house|home|property|address|location)\b/i.test(input.text)) continue;
      return rule;
    }
    if (rule.type === "MAINTENANCE_DUE" || rule.type === "POST_SERVICE_REVIEW" || rule.type === "REPLACEMENT") {
      continue;
    }
  }
  return null;
}

export function opportunityLine(rule: TrainingOpportunityRule, facts: Pick<VerifiedFacts, "hasActiveMembership" | "membershipStatus">) {
  if ((rule.type === "MAINTENANCE" || rule.type === "MEMBERSHIP") && facts.hasActiveMembership !== false) {
    return null;
  }
  if ((rule.type === "MAINTENANCE" || rule.type === "MEMBERSHIP") && facts.hasActiveMembership === false) {
    return `${facts.membershipStatus || "I don't see an active maintenance plan on your account right now."} ${rule.cta || "We do offer one though — want me to send you the details?"}`;
  }
  return rule.cta;
}

export function buildTrainingContext(input: {
  text: string;
  intent: ReceptionistV2Intent | string;
  facts: VerifiedFacts;
  knowledge: TrainingKnowledge[];
  rules: TrainingRule[];
  opportunities: TrainingOpportunityRule[];
  examples: TrainingExample[];
  declinedTypes: string[];
  offeredTypes: string[];
}) {
  const knowledge = retrieveRelevantKnowledge({
    items: input.knowledge,
    text: input.text,
    intent: input.intent,
  });
  const rules = conversationRulesForPrompt(input.rules);
  const opportunity = qualifyOpportunity({
    rules: input.opportunities,
    text: input.text,
    intent: input.intent,
    facts: input.facts,
    declinedTypes: input.declinedTypes,
    offeredTypes: input.offeredTypes,
  });
  const examples = retrieveRelevantExamples({
    examples: input.examples,
    text: input.text,
    intent: input.intent,
    facts: input.facts,
  });
  const sources: TrainingSources = {
    knowledgeIds: knowledge.map((row) => row.id),
    ruleIds: rules.map((row) => row.id),
    opportunityRuleId: opportunity?.id ?? null,
    exampleIds: examples.map((row) => row.id),
  };
  return {
    knowledge,
    rules,
    opportunity,
    examples,
    sources,
    knowledgeAnswers: knowledge.map((row) => row.answer),
    opportunityText: opportunity ? opportunityLine(opportunity, input.facts) : null,
  };
}

export function trainingContextIsBounded(input: {
  knowledge: unknown[];
  rules: unknown[];
  examples: unknown[];
}) {
  return (
    input.knowledge.length <= TRAINING_KNOWLEDGE_LIMIT &&
    input.rules.length <= TRAINING_RULE_LIMIT &&
    input.examples.length <= TRAINING_EXAMPLE_LIMIT
  );
}

export function exampleConflictsVerifiedData(input: {
  preferredResponse: string;
  facts: Pick<VerifiedFacts, "hasActiveMembership">;
}) {
  return (
    input.facts.hasActiveMembership === true &&
    /\b(don't see|do not see|no active)\b/i.test(input.preferredResponse)
  );
}
