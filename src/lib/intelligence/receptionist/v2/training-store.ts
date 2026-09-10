import { prisma } from "@/lib/db";
import {
  STARTER_CONVERSATION_RULES,
  STARTER_MAINTENANCE_OPPORTUNITY,
  type TrainingExample,
  type TrainingKnowledge,
  type TrainingOpportunityRule,
  type TrainingRule,
} from "@/lib/intelligence/receptionist/v2/training";

export async function loadCompanyTraining(companyId: string) {
  const [knowledge, rules, opportunities, examples, events] = await Promise.all([
    prisma.receptionistKnowledgeItem.findMany({
      where: { companyId, active: true },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.receptionistConversationRule.findMany({
      where: { companyId, active: true },
      orderBy: { priority: "asc" },
    }),
    prisma.receptionistOpportunityRule.findMany({
      where: { companyId, active: true },
      orderBy: { priority: "asc" },
    }),
    prisma.receptionistApprovedExample.findMany({
      where: { companyId, active: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.receptionistOpportunityEvent.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);
  return {
    knowledge: knowledge as TrainingKnowledge[],
    rules: rules as TrainingRule[],
    opportunities: opportunities as TrainingOpportunityRule[],
    examples: examples as TrainingExample[],
    events,
  };
}

export function threadOpportunityTypes(events: Array<{ threadId: string; status: string; ruleId: string }>, threadId: string, rules: TrainingOpportunityRule[]) {
  const byId = new Map(rules.map((rule) => [rule.id, rule.type]));
  const offered: string[] = [];
  const declined: string[] = [];
  for (const event of events) {
    if (event.threadId !== threadId) continue;
    const type = byId.get(event.ruleId);
    if (!type) continue;
    if (event.status === "DECLINED" && !declined.includes(type)) declined.push(type);
    if (event.status === "OFFERED" && !offered.includes(type)) offered.push(type);
  }
  return { offeredTypes: offered, declinedTypes: declined };
}

export async function recordOpportunityEvent(input: {
  companyId: string;
  threadId: string;
  ruleId: string;
  status: "OFFERED" | "DECLINED" | "ACCEPTED";
}) {
  await prisma.receptionistOpportunityEvent.create({
    data: {
      companyId: input.companyId,
      threadId: input.threadId,
      ruleId: input.ruleId,
      status: input.status,
    },
  });
}

export async function ensureReceptionistTrainingStarter(companyId: string) {
  const existing = await prisma.receptionistConversationRule.count({ where: { companyId } });
  if (existing > 0) return { created: false };
  await prisma.receptionistConversationRule.createMany({
    data: STARTER_CONVERSATION_RULES.map((body, index) => ({
      companyId,
      body,
      active: true,
      priority: (index + 1) * 10,
    })),
  });
  const opportunity = await prisma.receptionistOpportunityRule.count({
    where: { companyId, type: "MAINTENANCE" },
  });
  if (opportunity === 0) {
    await prisma.receptionistOpportunityRule.create({
      data: {
        companyId,
        ...STARTER_MAINTENANCE_OPPORTUNITY,
        active: true,
        priority: 10,
      },
    });
  }
  return { created: true };
}

export async function loadTrainingDashboard(companyId: string) {
  const [knowledge, rules, opportunities, examples, needsReview] = await Promise.all([
    prisma.receptionistKnowledgeItem.count({ where: { companyId, active: true } }),
    prisma.receptionistConversationRule.count({ where: { companyId, active: true } }),
    prisma.receptionistOpportunityRule.count({ where: { companyId, active: true } }),
    prisma.receptionistApprovedExample.count({ where: { companyId, active: true } }),
    prisma.receptionistTurn.count({
      where: {
        companyId,
        proposedResponse: { not: null },
        OR: [{ reviewStatus: null }, { reviewStatus: "PENDING" }],
      },
    }),
  ]);
  return { knowledge, rules, opportunities, examples, needsReview };
}
