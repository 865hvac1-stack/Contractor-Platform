import { prisma } from "@/lib/db";
import { contractorYouMayAutoreply, loadCustomerConversationOwner } from "@/lib/comms/conversation-owner";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { isActiveSchedulingSession, loadOpenSchedulingSession } from "@/lib/agent-tools/persist-offers";
import { selectedSlotFromState } from "@/lib/agent-tools/booking-contract";
import { parseOfferedSlots } from "@/lib/scheduling/conversation-turn";
import { formatLocalDateShort, formatWindowChip } from "@/lib/scheduling/time";
import { auditReceptionistTurn, logReceptionistTurn } from "@/lib/intelligence/receptionist/log";
import { handoffToOffice } from "@/lib/intelligence/receptionist/handoff";
import { loadReceptionistSettings } from "@/lib/intelligence/receptionist/settings";
import { sanitizeCustomerSms } from "@/lib/intelligence/receptionist/sanitize";
import { getAiReceptionistProvider } from "@/lib/intelligence/receptionist/v2/provider";
import { capabilityAllowsIntent } from "@/lib/intelligence/receptionist/v2/intent";
import { answerFromCompanyKnowledge, loadCompanyKnowledgeFromSettings } from "@/lib/intelligence/receptionist/v2/knowledge";
import { actionForIntent, runReceptionistTool } from "@/lib/intelligence/receptionist/v2/tools";
import { assertResponseUsesOnlyVerifiedFacts } from "@/lib/intelligence/receptionist/v2/compose";
import { boundConversationHistory } from "@/lib/intelligence/receptionist/v2/context";
import { recordReceptionistV2Usage } from "@/lib/intelligence/receptionist/v2/usage";
import {
  parseReceptionistV2Mode,
  receptionistV2MaySendLive,
  receptionistV2ShouldObserve,
  type ReceptionistV2Action,
  type VerifiedFacts,
} from "@/lib/intelligence/receptionist/v2/types";
import { startSchedulingTool } from "@/lib/agent-tools/scheduling-session";

export type ReceptionistV2InboundInput = {
  companyId: string;
  threadId: string;
  customerId?: string | null;
  messageId: string;
  body?: string | null;
  phone?: string | null;
  contactId?: string | null;
  actualProductionResponse?: string | null;
  skipLiveSend?: boolean;
};

export type ReceptionistV2Deps = {
  provider?: ReturnType<typeof getAiReceptionistProvider>;
  runTool?: typeof runReceptionistTool;
  send?: typeof sendCompanyCommunication;
  startScheduling?: typeof startSchedulingTool;
  handoff?: typeof handoffToOffice;
};

export async function processReceptionistV2(
  input: ReceptionistV2InboundInput,
  deps: ReceptionistV2Deps = {}
) {
  const started = Date.now();
  const settings = await loadReceptionistSettings(input.companyId);
  const mode = parseReceptionistV2Mode(settings.mode);
  const owner = await loadCustomerConversationOwner(prisma, input.companyId);
  if (mode === "OFFICE_ONLY") {
    return { handled: false, skipped: true, reason: "office_only", mode };
  }
  if (!receptionistV2ShouldObserve(mode)) {
    return { handled: false, skipped: true, reason: "v2_mode_off", mode };
  }

  const shadow = !receptionistV2MaySendLive({ mode, conversationOwner: owner });
  const text = input.body?.trim() || "";
  if (!text) return { handled: false, skipped: true, reason: "empty", mode, shadow };

  const existing = await prisma.receptionistTurn.findUnique({
    where: { companyId_inboundMessageId: { companyId: input.companyId, inboundMessageId: input.messageId } },
  });
  if (existing?.proposedResponse && existing.mode) {
    return { handled: true, duplicate: true, mode, shadow, intent: existing.intent };
  }

  const [company, history, scheduling] = await Promise.all([
    prisma.company.findFirst({
      where: { id: input.companyId },
      select: { businessName: true, timezone: true, hoursNote: true, serviceArea: true, description: true, phone: true },
    }),
    prisma.communicationMessage.findMany({
      where: { companyId: input.companyId, threadId: input.threadId },
      orderBy: { occurredAt: "desc" },
      take: 8,
      select: { direction: true, body: true },
    }),
    loadOpenSchedulingSession(input.companyId, input.threadId),
  ]);

  const boundedHistory = boundConversationHistory(history, { newestFirst: true });
  const activeScheduling = Boolean(scheduling && isActiveSchedulingSession(scheduling));
  const provider = deps.provider ?? getAiReceptionistProvider();
  const runTool = deps.runTool ?? runReceptionistTool;
  const send = deps.send ?? sendCompanyCommunication;
  const startScheduling = deps.startScheduling ?? startSchedulingTool;
  const handoff = deps.handoff ?? handoffToOffice;
  const classified = await provider.classifyIntent({
    text,
    history: boundedHistory,
    hasActiveScheduling: activeScheduling,
    assistantName: settings.assistantName,
  });

  if (!capabilityAllowsIntent({ intent: classified.data.intent, ...settings }) && classified.data.intent !== "HUMAN_REQUEST") {
    classified.data.shouldHandoff = true;
    classified.data.handoffReason = "capability_disabled";
  }

  const knowledge = loadCompanyKnowledgeFromSettings({
    businessName: company?.businessName,
    hoursNote: company?.hoursNote,
    serviceArea: company?.serviceArea,
    description: company?.description,
    settings,
  });
  const knowledgeAnswer =
    classified.data.extractedContext.interruptingQuestion || classified.data.intent === "SERVICE_QUESTION"
      ? answerFromCompanyKnowledge({ question: text, knowledge })
      : null;

  const requestedAction = actionForIntent(classified.data.intent);
  const tool = await runTool({
    companyId: input.companyId,
    action: requestedAction,
    phone: input.phone,
    customerId: input.customerId,
    contactId: input.contactId,
    threadId: input.threadId,
    shadow,
  });

  const offered = parseOfferedSlots(scheduling?.offeredSlots);
  const selected = selectedSlotFromState({
    requestedDate: scheduling?.requestedDate,
    requestedWindowId: scheduling?.requestedWindowId,
    offeredSlots: offered,
  });
  const timeZone = company?.timezone || "America/New_York";
  const offeredDisplays = offered.map(
    (slot) => `${formatLocalDateShort(slot.date, timeZone)} from ${formatWindowChip(slot.startMinutes, slot.endMinutes)}`
  );
  const facts: VerifiedFacts = {
    companyName: company?.businessName ?? null,
    assistantName: settings.assistantName,
    customerFirstName: tool.facts.customerFirstName ?? null,
    customerId: tool.facts.customerId ?? input.customerId ?? null,
    properties: tool.facts.properties,
    schedulingPhase: scheduling?.lastAiAction ?? null,
    offeredSlots: offeredDisplays,
    selectedSlot: selected ? `${selected.date} ${selected.windowId}` : null,
    bookingConfirmed: scheduling?.status === "BOOKED" && Boolean(scheduling.bookedJobId),
    jobId: scheduling?.bookedJobId ?? tool.facts.jobId ?? null,
    bookingId: tool.facts.bookingId ?? null,
    appointmentDisplay: selected
      ? `${formatLocalDateShort(selected.date, timeZone)} from ${formatWindowChip(selected.startMinutes, selected.endMinutes)}`
      : null,
    serviceAddress: tool.facts.properties?.length === 1 ? tool.facts.properties[0]!.address : scheduling ? parseStreet(scheduling.intake) : null,
    nextWorkflowAsk: nextAskFromPhase(scheduling?.lastAiAction, tool.facts.properties?.length ?? 0),
    knowledgeAnswers: knowledgeAnswer ? [knowledgeAnswer] : [],
    invoiceBalance: tool.facts.invoiceBalance ?? null,
    estimateStatus: tool.facts.estimateStatus ?? null,
    membershipStatus: tool.facts.membershipStatus ?? null,
    waitingStatus: tool.facts.waitingStatus ?? null,
    jobStatus: tool.facts.jobStatus ?? null,
    toolError: tool.skipped ?? null,
  };

  const generated = await provider.generateResponse({
    text,
    classification: classified.data,
    facts,
    history: boundedHistory,
    personality: {
      assistantName: settings.assistantName,
      tone: settings.tone,
      responseLength: settings.responseLength,
      useCustomerFirstName: settings.useCustomerFirstName,
    },
  });

  const guard = assertResponseUsesOnlyVerifiedFacts({ responseText: generated.data.responseText, facts });
  const safeText = sanitizeCustomerSms(
    guard.ok
      ? generated.data.responseText
      : "I don't want to give you the wrong information on that. Let me get the office to take a look."
  );
  const shouldHandoff = generated.data.shouldHandoff || classified.data.shouldHandoff || !guard.ok;
  const handoffReason = generated.data.handoffReason || classified.data.handoffReason || (!guard.ok ? guard.reason : null);
  const lowConfidence = generated.data.confidence < 0.45 && classified.data.intent === "UNKNOWN";
  const finalHandoff = shouldHandoff || (lowConfidence && settings.humanHandoffFallback);

  let outboundSent = false;
  const maySend = !shadow && !input.skipLiveSend && contractorYouMayAutoreply(owner) && Boolean(input.phone);
  if (maySend && input.phone) {
    if (finalHandoff) {
      await handoff({
        companyId: input.companyId,
        threadId: input.threadId,
        stateId: scheduling?.id,
        customerId: facts.customerId,
        phone: input.phone,
        reason: handoffReason || "v2_handoff",
        replyText: safeText,
      });
      outboundSent = true;
    } else if (requestedAction === "startScheduling" && settings.allowScheduling && !activeScheduling) {
      await startScheduling({
        companyId: input.companyId,
        body: {
          customer_phone: input.phone,
          contact_id: input.contactId,
          customer_reply: text,
          service_need: classified.data.extractedContext.concern,
          send_to_customer: false,
        },
        source: "receptionist_v2",
      });
      await send({
        companyId: input.companyId,
        channel: "SMS",
        to: input.phone,
        body: safeText,
        customerId: facts.customerId,
        origin: "CONTRACTORYOU_AUTOMATION",
      });
      outboundSent = true;
    } else {
      await send({
        companyId: input.companyId,
        channel: "SMS",
        to: input.phone,
        body: safeText,
        customerId: facts.customerId,
        origin: "CONTRACTORYOU_AUTOMATION",
      });
      outboundSent = true;
    }
  }

  const turnData = {
    customerId: facts.customerId,
    intent: classified.data.intent,
    schedulingState: facts.schedulingPhase,
    availabilityCount: offered.length,
    outboundSent,
    handoffReason: finalHandoff ? handoffReason : null,
    errorCode: generated.errorCode ?? classified.errorCode ?? null,
    durationMs: Date.now() - started,
    mode,
    proposedResponse: safeText,
    actualResponse: input.actualProductionResponse ?? null,
    confidence: generated.data.confidence,
    requestedAction,
    extractedFields: classified.data.extractedContext,
    verifiedFacts: facts,
    provider: generated.provider,
    model: generated.model,
    inputTokens: generated.inputTokens + classified.inputTokens,
    outputTokens: generated.outputTokens + classified.outputTokens,
    costMicrousd: generated.costMicrousd + classified.costMicrousd,
    shadow,
    toolUsed: tool.skipped ? `${requestedAction}:${tool.skipped}` : requestedAction,
    activeWorkflow: activeScheduling ? "scheduling" : null,
  };

  let turnId = existing?.id ?? null;
  if (existing) {
    await prisma.receptionistTurn.update({
      where: { id: existing.id },
      data: turnData,
    });
  } else {
    try {
      const created = await prisma.receptionistTurn.create({
        data: {
          companyId: input.companyId,
          threadId: input.threadId,
          inboundMessageId: input.messageId,
          ...turnData,
        },
      });
      turnId = created.id;
    } catch {
      return { handled: true, duplicate: true, mode, shadow, intent: classified.data.intent };
    }
  }

  logReceptionistTurn({
    companyId: input.companyId,
    threadId: input.threadId,
    inboundMessageId: input.messageId,
    receptionistTurnId: turnId,
    customerId: facts.customerId,
    intent: classified.data.intent,
    schedulingState: facts.schedulingPhase,
    outboundSent,
    handoffReason: finalHandoff ? handoffReason : null,
    errorCode: turnData.errorCode,
    confidence: generated.data.confidence,
    activeWorkflow: turnData.activeWorkflow,
    requestedAction,
    toolUsed: turnData.toolUsed,
    latencyMs: turnData.durationMs,
    provider: generated.provider,
    model: generated.model,
    inputTokens: turnData.inputTokens,
    outputTokens: turnData.outputTokens,
    shadow,
    mode,
  });
  await auditReceptionistTurn({
    companyId: input.companyId,
    threadId: input.threadId,
    inboundMessageId: input.messageId,
    intent: classified.data.intent,
    errorCode: turnData.errorCode,
    handoffReason: finalHandoff ? handoffReason : null,
  });
  try {
    await recordReceptionistV2Usage({
      companyId: input.companyId,
      model: generated.model,
      inputTokens: turnData.inputTokens,
      outputTokens: turnData.outputTokens,
      costMicrousd: turnData.costMicrousd,
      latencyMs: turnData.durationMs,
      status: turnData.errorCode ? "ERROR" : "OK",
      errorKind: turnData.errorCode,
    });
  } catch {
    // Usage is observability-only; never fail the inbound turn.
  }

  return {
    handled: true,
    mode,
    shadow,
    sent: outboundSent,
    intent: classified.data.intent,
    proposedResponse: safeText,
    requestedAction,
    confidence: generated.data.confidence,
    usedAi: generated.usedAi || classified.usedAi,
  };
}

export async function maybeRunReceptionistV2(input: ReceptionistV2InboundInput) {
  const settings = await loadReceptionistSettings(input.companyId);
  const mode = parseReceptionistV2Mode(settings.mode);
  if (!receptionistV2ShouldObserve(mode)) return { skipped: true, reason: "v2_mode_off" };
  return processReceptionistV2(input);
}

export async function attachOutboundToLatestShadowTurn(input: {
  companyId: string;
  threadId: string;
  body?: string | null;
}) {
  const text = input.body?.trim();
  if (!text) return { attached: false };
  const turn = await prisma.receptionistTurn.findFirst({
    where: {
      companyId: input.companyId,
      threadId: input.threadId,
      shadow: true,
      actualResponse: null,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!turn) return { attached: false };
  await prisma.receptionistTurn.update({
    where: { id: turn.id },
    data: { actualResponse: text.slice(0, 480) },
  });
  return { attached: true, turnId: turn.id };
}

export async function loadReceptionistV2Review(companyId: string, take = 8) {
  const rows = await prisma.receptionistTurn.findMany({
    where: { companyId, OR: [{ shadow: true }, { mode: { in: ["CONTRACTORYOU_SHADOW", "CONTRACTORYOU_AI"] } }] },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      threadId: true,
      inboundMessageId: true,
      intent: true,
      confidence: true,
      proposedResponse: true,
      actualResponse: true,
      requestedAction: true,
      schedulingState: true,
      toolUsed: true,
      verifiedFacts: true,
      extractedFields: true,
      shadow: true,
      outboundSent: true,
      handoffReason: true,
      createdAt: true,
    },
  });
  const ids = rows.map((row) => row.inboundMessageId);
  const messages = ids.length
    ? await prisma.communicationMessage.findMany({
        where: {
          companyId,
          OR: [{ id: { in: ids } }, { externalId: { in: ids } }],
        },
        select: { id: true, externalId: true, body: true },
      })
    : [];
  return rows.map((row) => {
    const inbound = messages.find((message) => message.id === row.inboundMessageId || message.externalId === row.inboundMessageId);
    return {
      ...row,
      customerMessage: inbound?.body ?? null,
    };
  });
}

function nextAskFromPhase(phase?: string | null, propertyCount = 0) {
  if (phase === "NEED_SERVICE_CONTEXT") return "What's going on with the system?";
  if (phase === "NEED_CUSTOMER_NAME") return "What's your name?";
  if (phase === "NEED_PROPERTY" && propertyCount > 1) return "Which property do you need service at?";
  if (phase === "NEED_PROPERTY") return "What's the address where you're needing service?";
  if (phase === "WAITING_FOR_SLOT_SELECTION" || phase === "SLOTS_OFFERED") return "Which of those openings works best?";
  if (phase === "SLOT_SELECTED") return "Before I finish scheduling that, what's your name?";
  return null;
}

function parseStreet(intake: unknown) {
  if (!intake || typeof intake !== "object") return null;
  const street = (intake as { street?: unknown }).street;
  return typeof street === "string" && street.trim() ? street.trim() : null;
}

export function receptionistV2RequestedAction(value: unknown): ReceptionistV2Action {
  return actionForIntent(String(value));
}
