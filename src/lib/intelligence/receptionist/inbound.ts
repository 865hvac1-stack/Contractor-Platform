import { prisma } from "@/lib/db";
import { contractorYouMayAutoreply, loadCustomerConversationOwner } from "@/lib/comms/conversation-owner";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { processInboundScheduling } from "@/lib/scheduling/conversation";
import { ACTIVE_SCHEDULING_STATUSES, parseOfferedSlots } from "@/lib/scheduling/conversation-turn";
import { auditReceptionistTurn, logReceptionistTurn } from "@/lib/intelligence/receptionist/log";
import { handoffToOffice } from "@/lib/intelligence/receptionist/handoff";
import { loadReceptionistSettings, receptionistShouldHandleInbound } from "@/lib/intelligence/receptionist/settings";
import { understandReceptionistTurn } from "@/lib/intelligence/receptionist/understand";
import { composeReceptionistReply } from "@/lib/intelligence/receptionist/voice";
import { sanitizeCustomerSms } from "@/lib/intelligence/receptionist/sanitize";
import {
  SCHEDULING_INTENTS,
  type ReceptionistIntent,
  type ReceptionistPlan,
  type ReceptionistResult,
} from "@/lib/intelligence/receptionist/types";

export type ReceptionistInboundInput = {
  companyId: string;
  threadId: string;
  customerId?: string | null;
  messageId: string;
  body?: string | null;
  direction?: string | null;
  channel?: string | null;
  phone?: string | null;
};

export type ReceptionistDeps = {
  understand?: typeof understandReceptionistTurn;
  compose?: typeof composeReceptionistReply;
  schedule?: typeof processInboundScheduling;
};

function companyKnowledgeAnswer(input: {
  intent: ReceptionistIntent;
  hoursNote?: string | null;
  serviceArea?: string | null;
  phone?: string | null;
}) {
  if (input.intent !== "general_service_question") return null;
  const parts = [input.hoursNote, input.serviceArea ? `We serve ${input.serviceArea}.` : null, input.phone ? `You can also reach the office at ${input.phone}.` : null].filter(
    Boolean
  );
  if (!parts.length) return null;
  return parts.join(" ");
}

export async function processInboundReceptionist(
  input: ReceptionistInboundInput,
  deps: ReceptionistDeps = {}
): Promise<ReceptionistResult> {
  const started = Date.now();
  const understand = deps.understand ?? understandReceptionistTurn;
  const compose = deps.compose ?? composeReceptionistReply;
  const schedule = deps.schedule ?? processInboundScheduling;
  const empty: ReceptionistResult = {
    handled: false,
    intent: "unknown",
    actions: [],
    requiresHuman: false,
  };

  const direction = (input.direction || "").toUpperCase();
  if (direction && direction !== "INBOUND") return { ...empty, skipped: true, reason: "not_inbound" };
  if (!input.body?.trim()) return { ...empty, skipped: true, reason: "empty" };
  const channel = (input.channel || "SMS").toUpperCase();
  if (channel === "CALL" || channel === "VOICEMAIL") return { ...empty, skipped: true, reason: "voice" };

  const owner = await loadCustomerConversationOwner(prisma, input.companyId);
  if (!contractorYouMayAutoreply(owner)) {
    return { ...empty, skipped: true, reason: "conversation_owner" };
  }
  const settings = await loadReceptionistSettings(input.companyId);
  if (!receptionistShouldHandleInbound(settings)) {
    return { ...empty, skipped: true, reason: "receptionist_disabled" };
  }

  const existingTurn = await prisma.receptionistTurn.findUnique({
    where: { companyId_inboundMessageId: { companyId: input.companyId, inboundMessageId: input.messageId } },
  });
  if (existingTurn) {
    return {
      handled: true,
      duplicate: true,
      intent: (existingTurn.intent as ReceptionistIntent) || "unknown",
      actions: ["duplicate_ignored"],
      requiresHuman: Boolean(existingTurn.handoffReason),
      errorCode: existingTurn.errorCode,
    };
  }

  try {
    await prisma.receptionistTurn.create({
      data: {
        companyId: input.companyId,
        threadId: input.threadId,
        inboundMessageId: input.messageId,
        customerId: input.customerId ?? null,
        intent: "unknown",
      },
    });
  } catch {
    return { handled: true, duplicate: true, intent: "unknown", actions: ["duplicate_ignored"], requiresHuman: false };
  }

  const [company, history, previous] = await Promise.all([
    prisma.company.findFirst({
      where: { id: input.companyId },
      select: { timezone: true, hoursNote: true, serviceArea: true, phone: true },
    }),
    prisma.communicationMessage.findMany({
      where: { companyId: input.companyId, threadId: input.threadId },
      orderBy: { occurredAt: "desc" },
      take: 8,
      select: { direction: true, body: true },
    }),
    prisma.conversationSchedulingState.findFirst({
      where: {
        companyId: input.companyId,
        threadId: input.threadId,
        status: { in: [...ACTIVE_SCHEDULING_STATUSES] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const understood = await understand({
    text: input.body,
    timeZone: company?.timezone || "America/New_York",
    assistantName: settings.assistantName,
    history: history.reverse().map((row) => ({ direction: row.direction, body: row.body || "" })),
    hasActiveScheduling: Boolean(previous && !previous.paused),
    offeredSlots: parseOfferedSlots(previous?.offeredSlots).map((slot) => ({ date: slot.date })),
  });
  const plan: ReceptionistPlan = understood.plan;
  const actions: string[] = [`understood:${plan.intent}`];
  if (understood.usedAi) actions.push("ai_nlu");
  else actions.push("deterministic_nlu");

  const phone = input.phone;
  const shouldHandoff =
    plan.intent === "human_handoff" ||
    plan.requiresHuman ||
    plan.intent === "waiting_status" ||
    (plan.intent === "unknown" && !previous && understood.errorCode === "MISSING_AI_KEY" && settings.humanHandoffFallback);

  if (shouldHandoff && plan.intent !== "schedule_service") {
    await handoffToOffice({
      companyId: input.companyId,
      threadId: input.threadId,
      stateId: previous?.id,
      customerId: input.customerId,
      phone,
      reason: plan.intent === "human_handoff" ? "human_requested" : plan.intent,
    });
    await finishTurn({
      companyId: input.companyId,
      messageId: input.messageId,
      intent: plan.intent,
      customerId: input.customerId,
      propertyId: previous?.propertyId,
      schedulingState: "NEEDS_REVIEW",
      outboundSent: Boolean(phone),
      handoffReason: plan.intent,
      errorCode: understood.errorCode,
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      intent: plan.intent,
      requiresHuman: true,
      actions: [...actions, "handoff"],
      nextState: "NEEDS_REVIEW",
      errorCode: understood.errorCode ?? null,
    };
  }

  const knowledge = companyKnowledgeAnswer({
    intent: plan.intent,
    hoursNote: company?.hoursNote,
    serviceArea: company?.serviceArea,
    phone: company?.phone,
  });
  if (knowledge && !SCHEDULING_INTENTS.includes(plan.intent) && !previous) {
    if (phone) {
      await sendCompanyCommunication({
        companyId: input.companyId,
        channel: "SMS",
        to: phone,
        body: sanitizeCustomerSms(await compose({ assistantName: settings.assistantName, templateText: knowledge })),
        customerId: input.customerId,
        origin: "CONTRACTORYOU_AUTOMATION",
      });
    }
    await finishTurn({
      companyId: input.companyId,
      messageId: input.messageId,
      intent: plan.intent,
      customerId: input.customerId,
      outboundSent: Boolean(phone),
      durationMs: Date.now() - started,
    });
    return { handled: true, intent: plan.intent, actions: [...actions, "company_knowledge"], requiresHuman: false };
  }

  const scheduling = await schedule({
    companyId: input.companyId,
    threadId: input.threadId,
    customerId: input.customerId,
    messageId: input.messageId,
    body: input.body,
    direction: input.direction,
    channel: input.channel,
    phone: input.phone,
    forceScheduling: SCHEDULING_INTENTS.includes(plan.intent) || Boolean(previous),
    composeReply: async ({ templateText }) =>
      compose({
        assistantName: settings.assistantName,
        templateText,
        facts: { intent: plan.intent, concern: plan.concern, assistantName: settings.assistantName },
      }),
  });

  const state = await prisma.conversationSchedulingState.findFirst({
    where: { companyId: input.companyId, threadId: input.threadId },
    orderBy: { updatedAt: "desc" },
  });
  if (state) {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: {
        lastIntent: plan.intent,
        lastAiAction: scheduling.handled ? (scheduling as { outcome?: string }).outcome || "scheduling" : "ignored",
        receptionistTurnCount: { increment: 1 },
      },
    });
  }

  if (!scheduling.handled && settings.humanHandoffFallback) {
    await handoffToOffice({
      companyId: input.companyId,
      threadId: input.threadId,
      stateId: state?.id,
      customerId: input.customerId ?? state?.customerId,
      phone,
      reason: "unsupported_or_unclear",
    });
    await finishTurn({
      companyId: input.companyId,
      messageId: input.messageId,
      intent: plan.intent,
      customerId: input.customerId ?? state?.customerId,
      propertyId: state?.propertyId,
      schedulingState: "NEEDS_REVIEW",
      outboundSent: Boolean(phone),
      handoffReason: "unsupported_or_unclear",
      errorCode: understood.errorCode ?? "UNHANDLED",
      durationMs: Date.now() - started,
    });
    return {
      handled: true,
      intent: plan.intent,
      requiresHuman: true,
      actions: [...actions, "handoff"],
      nextState: "NEEDS_REVIEW",
    };
  }

  const outcome = scheduling.handled ? (scheduling as { outcome?: string; jobId?: string; duplicate?: boolean }) : {};
  await finishTurn({
    companyId: input.companyId,
    messageId: input.messageId,
    intent: plan.intent,
    customerId: state?.customerId ?? input.customerId,
    propertyId: state?.propertyId,
    schedulingState: state?.status,
    availabilityCount: parseOfferedSlots(state?.offeredSlots).length,
    bookingResult: outcome.jobId ? "booked" : outcome.outcome || (outcome.duplicate ? "duplicate" : null),
    outboundSent: Boolean(scheduling.handled && !outcome.duplicate),
    errorCode: understood.errorCode,
    durationMs: Date.now() - started,
  });

  return {
    handled: Boolean(scheduling.handled),
    duplicate: Boolean(outcome.duplicate),
    intent: plan.intent,
    nextState: state?.status ?? null,
    actions: [...actions, "scheduling"],
    requiresHuman: state?.status === "NEEDS_REVIEW" || state?.status === "PAUSED",
    customerId: state?.customerId,
    propertyId: state?.propertyId,
    jobId: outcome.jobId ?? null,
    availabilityCount: parseOfferedSlots(state?.offeredSlots).length,
    bookingResult: outcome.jobId ? "booked" : outcome.outcome ?? null,
  };
}

async function finishTurn(input: {
  companyId: string;
  messageId: string;
  intent: string;
  customerId?: string | null;
  propertyId?: string | null;
  schedulingState?: string | null;
  availabilityCount?: number;
  bookingResult?: string | null;
  outboundSent?: boolean;
  handoffReason?: string | null;
  errorCode?: string | null;
  durationMs: number;
}) {
  const turn = await prisma.receptionistTurn.update({
    where: { companyId_inboundMessageId: { companyId: input.companyId, inboundMessageId: input.messageId } },
    data: {
      customerId: input.customerId ?? null,
      propertyId: input.propertyId ?? null,
      intent: input.intent,
      schedulingState: input.schedulingState ?? null,
      availabilityCount: input.availabilityCount ?? 0,
      bookingResult: input.bookingResult ?? null,
      outboundSent: Boolean(input.outboundSent),
      handoffReason: input.handoffReason ?? null,
      errorCode: input.errorCode ?? null,
      durationMs: input.durationMs,
    },
  });
  logReceptionistTurn({
    companyId: input.companyId,
    threadId: turn.threadId,
    inboundMessageId: input.messageId,
    customerId: input.customerId,
    propertyId: input.propertyId,
    intent: input.intent,
    schedulingState: input.schedulingState,
    availabilityCount: input.availabilityCount,
    bookingResult: input.bookingResult,
    outboundSent: input.outboundSent,
    handoffReason: input.handoffReason,
    errorCode: input.errorCode,
  });
  await auditReceptionistTurn({
    companyId: input.companyId,
    threadId: turn.threadId,
    inboundMessageId: input.messageId,
    intent: input.intent,
    errorCode: input.errorCode,
    bookingResult: input.bookingResult,
    handoffReason: input.handoffReason,
  });
}
