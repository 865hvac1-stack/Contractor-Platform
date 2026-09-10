import { writeAudit } from "@/lib/audit";

export function logReceptionistTurn(input: {
  companyId: string;
  threadId: string;
  inboundMessageId: string;
  customerId?: string | null;
  propertyId?: string | null;
  intent: string;
  schedulingState?: string | null;
  availabilityCount?: number;
  bookingResult?: string | null;
  outboundSent?: boolean;
  handoffReason?: string | null;
  errorCode?: string | null;
  receptionistTurnId?: string | null;
  confidence?: number | null;
  activeWorkflow?: string | null;
  requestedAction?: string | null;
  toolUsed?: string | null;
  latencyMs?: number | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  shadow?: boolean;
  mode?: string | null;
}) {
  const safe = {
    companyId: input.companyId,
    conversationId: input.threadId,
    inboundProviderMessageId: input.inboundMessageId,
    receptionistTurnId: input.receptionistTurnId ?? null,
    resolvedCustomerId: input.customerId ?? null,
    resolvedPropertyId: input.propertyId ?? null,
    detectedIntent: input.intent,
    confidence: input.confidence ?? null,
    activeWorkflow: input.activeWorkflow ?? null,
    activeSchedulingState: input.schedulingState ?? null,
    requestedAction: input.requestedAction ?? null,
    toolUsed: input.toolUsed ?? null,
    availabilityResultCount: input.availabilityCount ?? 0,
    bookingResult: input.bookingResult ?? null,
    outboundSent: Boolean(input.outboundSent),
    handoffReason: input.handoffReason ?? null,
    errorCode: input.errorCode ?? null,
    latencyMs: input.latencyMs ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    shadow: Boolean(input.shadow),
    mode: input.mode ?? null,
  };
  console.info("[receptionist]", JSON.stringify(safe));
}

export async function auditReceptionistTurn(input: {
  companyId: string;
  threadId: string;
  inboundMessageId: string;
  intent: string;
  errorCode?: string | null;
  bookingResult?: string | null;
  handoffReason?: string | null;
}) {
  await writeAudit({
    companyId: input.companyId,
    action: input.handoffReason ? "receptionist.handoff" : "receptionist.turn",
    entityType: "CommunicationThread",
    entityId: input.threadId,
    metadata: {
      inboundMessageId: input.inboundMessageId,
      intent: input.intent,
      errorCode: input.errorCode ?? null,
      bookingResult: input.bookingResult ?? null,
      handoffReason: input.handoffReason ?? null,
    },
  });
}
