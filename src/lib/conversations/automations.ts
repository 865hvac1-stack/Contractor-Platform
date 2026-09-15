import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RECOMMENDED_AUTOMATIONS } from "@/lib/conversations/templates";

type Db = PrismaClient | typeof prisma;

export async function ensureRecommendedAutomations(companyId: string, db: Db = prisma) {
  await Promise.all(
    RECOMMENDED_AUTOMATIONS.map((template) =>
      db.automation.upsert({
        where: { companyId_templateKey: { companyId, templateKey: template.key } },
        create: {
          companyId,
          templateKey: template.key,
          name: template.name,
          trigger: template.trigger,
          action: template.mode === "START_CONVERSATION" ? "START_REGINA_CONVERSATION" : "SEND_MESSAGE",
          mode: template.mode,
          goal: template.goal,
          channel: template.channel,
          firstMessage: template.firstMessage,
          allowedActions: template.allowedActions,
          escalationRules: [
            "PRICING_NEGOTIATION",
            "ANGRY_CUSTOMER",
            "MANAGER_REQUEST",
            "REFUND_REQUEST",
            "LEGAL_OR_SAFETY_CONCERN",
            "IDENTITY_UNCERTAIN",
            "UNSUPPORTED_ACTION",
          ],
          stopConditions: template.stopConditions,
          status: "READY",
          enabled: false,
        },
        update: {},
      })
    )
  );
}

export async function loadAutomationDashboard(companyId: string, db: Db = prisma) {
  await ensureRecommendedAutomations(companyId, db);
  const [automations, activeConversations, engaged, booked, needsHuman] = await Promise.all([
    db.automation.findMany({
      where: { companyId },
      orderBy: [{ templateKey: "asc" }, { createdAt: "desc" }],
      include: {
        promotion: true,
        executions: {
          orderBy: { startedAt: "desc" },
          take: 250,
          select: {
            status: true,
            customerId: true,
            repliedAt: true,
            goalCompletedAt: true,
            humanTakeoverAt: true,
            startedAt: true,
            goal: true,
          },
        },
      },
    }),
    db.conversationGoalSession.count({
      where: {
        companyId,
        state: { in: ["STARTED", "WAITING_FOR_CUSTOMER", "COLLECTING_INFORMATION", "CHECKING_AVAILABILITY", "WAITING_FOR_SLOT_SELECTION", "BOOKING"] },
      },
    }),
    db.automationExecution.findMany({
      where: { companyId, repliedAt: { not: null } },
      distinct: ["customerId"],
      select: { customerId: true },
    }),
    db.automationExecution.count({ where: { companyId, goalCompletedAt: { not: null }, goal: { in: ["BOOK_MAINTENANCE", "QUALIFY_NEW_LEAD", "RECOVER_MISSED_CALL"] } } }),
    db.communicationThread.count({ where: { companyId, handlingState: { in: ["NEEDS_HUMAN", "WAITING_FOR_HUMAN"] } } }),
  ]);

  return {
    automations,
    metrics: {
      activeConversations,
      customersEngaged: engaged.filter((row) => row.customerId).length,
      appointmentsBooked: booked,
      needsHuman,
    },
  };
}
