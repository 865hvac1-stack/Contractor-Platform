import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handoffToOffice } from "@/lib/intelligence/receptionist/handoff";
import { sendCompanyCommunication } from "@/lib/comms/provider";

const OPT_OUT = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HUMAN_ESCALATION =
  /\b(manager|supervisor|human|real person|office|price is ridiculous|dispute|refund|lawyer|attorney|legal action|unsafe|emergency)\b/i;
const CUSTOMER_REQUEST =
  /\b(can (?:he|she|they|the tech|your tech)|could (?:he|she|they|the tech|your tech)|please|also|make sure|tell (?:him|her|them)|gate code|dog|call before|side entrance|upstairs|downstairs|park)\b/i;
const AFFIRMATIVE = /^(yes|yes please|yep|yeah|correct|that works|works for me|all set|confirmed|perfect)[.! ]*$/i;

export function isSmsOptOut(body: string) {
  return OPT_OUT.has(body.trim().replace(/[.!]/g, "").toUpperCase());
}

export function needsHumanEscalation(body: string) {
  return HUMAN_ESCALATION.test(body);
}

export function looksLikePreArrivalRequest(body: string) {
  return CUSTOMER_REQUEST.test(body) && body.trim().length >= 4;
}

export async function applyInboundConversationControls(input: {
  companyId: string;
  threadId: string;
  messageId: string;
  body?: string | null;
  customerId?: string | null;
  phone?: string | null;
}) {
  const body = input.body?.trim();
  if (!body) return { handled: false, reason: "empty" as const };

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
    },
    orderBy: { updatedAt: "desc" },
  });
  const customerId = session?.customerId || input.customerId || null;

  if (isSmsOptOut(body)) {
    const customer = customerId
      ? await prisma.customer.findFirst({
          where: { id: customerId, companyId: input.companyId },
          select: { tags: true },
        })
      : null;
    const tags = Array.from(new Set([...(customer?.tags || []), "sms-opt-out"]));
    await prisma.$transaction(async (tx) => {
      if (customerId) {
        await tx.customer.updateMany({
          where: { id: customerId, companyId: input.companyId },
          data: {
            smsMarketingOptedOutAt: new Date(),
            smsOptOutSource: "INBOUND_SMS_KEYWORD",
            communicationConsentUpdatedAt: new Date(),
            tags: { set: tags },
          },
        });
      }
      await tx.conversationGoalSession.updateMany({
        where: { companyId: input.companyId, threadId: input.threadId, completedAt: null },
        data: { state: "OPTED_OUT", completedAt: new Date(), lastInboundMessageId: input.messageId },
      });
      await tx.automationExecution.updateMany({
        where: { companyId: input.companyId, threadId: input.threadId, status: { notIn: ["COMPLETED", "FAILED", "BLOCKED"] } },
        data: { status: "OPTED_OUT", optedOutAt: new Date() },
      });
      await tx.communicationThread.updateMany({
        where: { id: input.threadId, companyId: input.companyId },
        data: { handlingState: "PAUSED", reginaPausedAt: new Date(), currentGoal: null },
      });
      await tx.conversationAuditEvent.create({
        data: {
          companyId: input.companyId,
          threadId: input.threadId,
          executionId: session?.executionId,
          event: "CUSTOMER_OPTED_OUT",
          decision: "REGINA_PAUSED",
          details: { keyword: body.toUpperCase() },
        },
      });
    });
    return { handled: true, stopAutoReply: true, reason: "opt_out" as const };
  }

  if (!session) return { handled: false, reason: "no_active_goal" as const };

  await prisma.$transaction(async (tx) => {
    await tx.conversationGoalSession.update({
      where: { id: session.id },
      data: { state: "COLLECTING_INFORMATION", lastInboundMessageId: input.messageId },
    });
    if (session.executionId) {
      await tx.automationExecution.update({
        where: { id: session.executionId },
        data: { status: "CUSTOMER_REPLIED", repliedAt: new Date() },
      });
    }
    await tx.conversationAuditEvent.create({
      data: {
        companyId: input.companyId,
        threadId: input.threadId,
        executionId: session.executionId,
        event: "CUSTOMER_REPLIED",
        decision: "CONTINUE_GOAL",
        details: { goal: session.goal, messageId: input.messageId },
      },
    });
  });

  if (needsHumanEscalation(body)) {
    await markGoalNeedsHuman({
      companyId: input.companyId,
      threadId: input.threadId,
      sessionId: session.id,
      executionId: session.executionId,
      customerId,
      phone: input.phone,
      reason: "customer_requested_human_or_sensitive_issue",
    });
    return { handled: true, stopAutoReply: true, reason: "needs_human" as const, session };
  }

  if (session.goal === "CONFIRM_APPOINTMENT" && AFFIRMATIVE.test(body)) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.conversationGoalSession.update({
        where: { id: session.id },
        data: { state: "GOAL_COMPLETED", completedAt: now },
      });
      if (session.executionId) {
        await tx.automationExecution.update({
          where: { id: session.executionId },
          data: { status: "GOAL_COMPLETED", goalCompletedAt: now },
        });
      }
      await tx.communicationThread.update({
        where: { id: input.threadId },
        data: { currentGoal: null },
      });
      await tx.conversationAuditEvent.create({
        data: {
          companyId: input.companyId,
          threadId: input.threadId,
          executionId: session.executionId,
          event: "CONVERSATION_GOAL_COMPLETED",
          decision: "APPOINTMENT_CONFIRMED",
          details: { messageId: input.messageId },
        },
      });
    });
    if (input.phone) {
      await sendCompanyCommunication({
        companyId: input.companyId,
        channel: "SMS",
        to: input.phone,
        body: "Perfect — you’re all set. We’ll send you a heads-up when your technician is on the way.",
        customerId,
        origin: "CONTRACTORYOU_AUTOMATION",
      });
    }
    return { handled: true, stopAutoReply: true, reason: "appointment_confirmed" as const, session };
  }

  if (
    session.goal === "ANSWER_PRE_ARRIVAL_QUESTIONS" &&
    session.jobId &&
    customerId &&
    session.allowedActions.includes("ADD_CUSTOMER_REQUEST_NOTE") &&
    looksLikePreArrivalRequest(body)
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.customerRequest.create({
        data: {
          companyId: input.companyId,
          customerId,
          jobId: session.jobId!,
          threadId: input.threadId,
          body: body.slice(0, 2000),
        },
      });
      await tx.customerNote.create({
        data: {
          companyId: input.companyId,
          customerId,
          jobId: session.jobId!,
          body: `CUSTOMER REQUEST: ${body.slice(0, 1900)}\nSource: Customer conversation with Regina`,
        },
      });
      await tx.conversationAuditEvent.create({
        data: {
          companyId: input.companyId,
          threadId: input.threadId,
          executionId: session.executionId,
          event: "CUSTOMER_REQUEST_ADDED_TO_JOB",
          decision: "JOB_NOTE_CREATED",
          details: { jobId: session.jobId, messageId: input.messageId },
        },
      });
    });
    if (input.phone) {
      await sendCompanyCommunication({
        companyId: input.companyId,
        channel: "SMS",
        to: input.phone,
        body: "Absolutely. I added that as a customer request for your technician. They’ll confirm anything that could change the scope or price.",
        customerId,
        origin: "CONTRACTORYOU_AUTOMATION",
      });
    }
    return { handled: true, stopAutoReply: true, reason: "customer_request_added" as const, session };
  }

  return { handled: true, stopAutoReply: false, reason: "goal_continues" as const, session };
}

async function markGoalNeedsHuman(input: {
  companyId: string;
  threadId: string;
  sessionId: string;
  executionId?: string | null;
  customerId?: string | null;
  phone?: string | null;
  reason: string;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.conversationGoalSession.update({
      where: { id: input.sessionId },
      data: { state: "HUMAN_TAKEOVER", humanTakeoverById: null },
    });
    if (input.executionId) {
      await tx.automationExecution.update({
        where: { id: input.executionId },
        data: { status: "NEEDS_HUMAN", humanTakeoverAt: new Date() },
      });
    }
    await tx.communicationThread.update({
      where: { id: input.threadId },
      data: { handlingState: "NEEDS_HUMAN", needsHumanAt: new Date(), reginaPausedAt: new Date() },
    });
    await tx.conversationAuditEvent.create({
      data: {
        companyId: input.companyId,
        threadId: input.threadId,
        executionId: input.executionId,
        event: "AUTOMATIC_ESCALATION",
        decision: "NEEDS_HUMAN",
        details: { reason: input.reason } as Prisma.InputJsonValue,
      },
    });
  });
  await handoffToOffice({
    companyId: input.companyId,
    threadId: input.threadId,
    customerId: input.customerId,
    phone: input.phone,
    reason: input.reason,
    replyText: "I’m going to have someone from the office step in here so we can help you properly.",
  });
}
