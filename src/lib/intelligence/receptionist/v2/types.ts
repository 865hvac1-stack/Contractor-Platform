export const RECEPTIONIST_V2_MODES = [
  "HIGHLEVEL_REGINA",
  "CONTRACTORYOU_SHADOW",
  "CONTRACTORYOU_AI",
  "OFFICE_ONLY",
] as const;

export type ReceptionistV2Mode = (typeof RECEPTIONIST_V2_MODES)[number];

export const RECEPTIONIST_V2_INTENTS = [
  "GREETING",
  "GENERAL_QUESTION",
  "SCHEDULING",
  "RESCHEDULE",
  "CANCEL_APPOINTMENT",
  "JOB_STATUS",
  "WAITING_PART_STATUS",
  "ESTIMATE_STATUS",
  "INVOICE_BALANCE",
  "PAYMENT_QUESTION",
  "MEMBERSHIP",
  "MAINTENANCE",
  "SERVICE_QUESTION",
  "SERVICE_CONCERN",
  "HUMAN_REQUEST",
  "COMPLAINT",
  "EMERGENCY",
  "UNKNOWN",
] as const;

export type ReceptionistV2Intent = (typeof RECEPTIONIST_V2_INTENTS)[number];

export const RECEPTIONIST_V2_ACTIONS = [
  "none",
  "findCustomer",
  "getCustomerProperties",
  "getCustomerJobs",
  "getAppointmentStatus",
  "checkAvailability",
  "startScheduling",
  "selectOfferedSlot",
  "bookAppointment",
  "getWaitingStatus",
  "getEstimateStatus",
  "getInvoiceBalance",
  "getMembershipStatus",
  "requestHumanHandoff",
  "answer_from_knowledge",
  "continue_workflow",
] as const;

export type ReceptionistV2Action = (typeof RECEPTIONIST_V2_ACTIONS)[number];

export type ReceptionistV2Extracted = {
  concern?: string | null;
  customerName?: string | null;
  serviceAddress?: string | null;
  slotHint?: string | null;
  casualAck?: boolean;
  interruptingQuestion?: string | null;
  currentSubject?: string | null;
  serviceConcernActive?: boolean;
  outstandingSchedulingOffer?: boolean;
  acceptedSchedulingOffer?: boolean;
  nextAction?: string | null;
};

export type ReceptionistV2Classification = {
  intent: ReceptionistV2Intent;
  confidence: number;
  extractedContext: ReceptionistV2Extracted;
  shouldHandoff: boolean;
  handoffReason?: string | null;
};

export type ReceptionistV2Generation = {
  intent: ReceptionistV2Intent;
  responseText: string;
  requestedAction: ReceptionistV2Action;
  extractedFields: ReceptionistV2Extracted;
  confidence: number;
  shouldHandoff: boolean;
  handoffReason?: string | null;
};

export type VerifiedFacts = {
  companyName?: string | null;
  assistantName: string;
  customerFirstName?: string | null;
  customerId?: string | null;
  properties?: Array<{ id: string; address: string; isPrimary: boolean }>;
  schedulingPhase?: string | null;
  offeredSlots?: string[];
  selectedSlot?: string | null;
  bookingConfirmed?: boolean;
  jobId?: string | null;
  bookingId?: string | null;
  appointmentDisplay?: string | null;
  serviceAddress?: string | null;
  nextWorkflowAsk?: string | null;
  knowledgeAnswers?: string[];
  invoiceBalance?: string | null;
  estimateStatus?: string | null;
  membershipStatus?: string | null;
  waitingStatus?: string | null;
  jobStatus?: string | null;
  toolError?: string | null;
  hasActiveMembership?: boolean | null;
  opportunityOffer?: string | null;
  currentSubject?: string | null;
  currentServiceConcern?: string | null;
  serviceConcernActive?: boolean;
  hasActiveAppointment?: boolean;
  activeSchedulingSession?: boolean;
  outstandingSchedulingOffer?: boolean;
  offerScheduling?: boolean;
  acceptedSchedulingOffer?: boolean;
  conversationText?: string | null;
  safeGuidance?: string | null;
  isTroubleshootingAsk?: boolean;
  canScheduleService?: boolean;
  canReadAvailability?: boolean;
  canBookAppointment?: boolean;
  canReschedule?: boolean;
  canCancel?: boolean;
};

export function parseReceptionistV2Mode(value: unknown): ReceptionistV2Mode {
  const raw = String(value || "").trim().toUpperCase();
  if ((RECEPTIONIST_V2_MODES as readonly string[]).includes(raw)) return raw as ReceptionistV2Mode;
  return "HIGHLEVEL_REGINA";
}

export function receptionistV2ShouldObserve(mode: ReceptionistV2Mode) {
  return mode === "CONTRACTORYOU_SHADOW" || mode === "CONTRACTORYOU_AI";
}

export function receptionistV2MaySendLive(input: {
  mode: ReceptionistV2Mode;
  conversationOwner: string;
}) {
  return input.mode === "CONTRACTORYOU_AI" && input.conversationOwner === "CONTRACTORYOU";
}
