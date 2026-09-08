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
}) {
  const safe = {
    conversationId: input.threadId,
    inboundProviderMessageId: input.inboundMessageId,
    resolvedCustomerId: input.customerId ?? null,
    resolvedPropertyId: input.propertyId ?? null,
    detectedIntent: input.intent,
    schedulingState: input.schedulingState ?? null,
    availabilityResultCount: input.availabilityCount ?? 0,
    bookingResult: input.bookingResult ?? null,
    outboundSent: Boolean(input.outboundSent),
    handoffReason: input.handoffReason ?? null,
    errorCode: input.errorCode ?? null,
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
