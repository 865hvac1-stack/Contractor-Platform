import { prisma } from "@/lib/db";

export async function completeConversationGoalForBooking(input: {
  companyId: string;
  threadId?: string | null;
  jobId: string;
}) {
  if (!input.threadId) return { completed: false };
  const session = await prisma.conversationGoalSession.findFirst({
    where: {
      companyId: input.companyId,
      threadId: input.threadId,
      state: {
        in: [
          "STARTED",
          "WAITING_FOR_CUSTOMER",
          "COLLECTING_INFORMATION",
          "CHECKING_AVAILABILITY",
          "WAITING_FOR_SLOT_SELECTION",
          "BOOKING",
        ],
      },
      goal: { in: ["BOOK_MAINTENANCE", "QUALIFY_NEW_LEAD", "RECOVER_MISSED_CALL"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!session) return { completed: false };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.conversationGoalSession.update({
      where: { id: session.id },
      data: { state: "GOAL_COMPLETED", completedAt: now, jobId: input.jobId },
    });
    if (session.executionId) {
      await tx.automationExecution.update({
        where: { id: session.executionId },
        data: { status: "GOAL_COMPLETED", goalCompletedAt: now },
      });
    }
    await tx.communicationThread.update({
      where: { id: input.threadId! },
      data: { currentGoal: null },
    });
    await tx.conversationAuditEvent.create({
      data: {
        companyId: input.companyId,
        threadId: input.threadId,
        executionId: session.executionId,
        event: "CONVERSATION_GOAL_COMPLETED",
        decision: "APPOINTMENT_BOOKED",
        details: { goal: session.goal, jobId: input.jobId },
      },
    });
  });
  return { completed: true, sessionId: session.id };
}
