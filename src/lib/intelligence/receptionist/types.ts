export const RECEPTIONIST_INTENTS = [
  "schedule_service",
  "choose_appointment_slot",
  "provide_customer_info",
  "provide_property",
  "reschedule_appointment",
  "cancel_appointment",
  "check_appointment_status",
  "maintenance_question",
  "waiting_status",
  "general_service_question",
  "unknown",
  "human_handoff",
] as const;

export type ReceptionistIntent = (typeof RECEPTIONIST_INTENTS)[number];

export type ReceptionistPlan = {
  intent: ReceptionistIntent;
  responseHint?: string | null;
  serviceType?: string | null;
  concern?: string | null;
  customerName?: string | null;
  serviceAddress?: string | null;
  selectedSlotHint?: string | null;
  needs?: string[];
  requiresHuman?: boolean;
  confidence?: "high" | "medium" | "low";
};

export type ReceptionistResult = {
  handled: boolean;
  skipped?: boolean;
  duplicate?: boolean;
  reason?: string;
  intent: ReceptionistIntent;
  responseText?: string | null;
  nextState?: string | null;
  actions: string[];
  requiresHuman: boolean;
  customerId?: string | null;
  propertyId?: string | null;
  jobId?: string | null;
  availabilityCount?: number;
  bookingResult?: string | null;
  errorCode?: string | null;
};

export type ReceptionistSettings = {
  enabled: boolean;
  assistantName: string;
  autoReplyInboundSms: boolean;
  autoBookServiceCalls: boolean;
  allowSameDayBooking: boolean;
  humanHandoffFallback: boolean;
  businessHoursBehavior: string;
};

export const SCHEDULING_INTENTS: ReceptionistIntent[] = [
  "schedule_service",
  "choose_appointment_slot",
  "provide_customer_info",
  "provide_property",
  "reschedule_appointment",
  "cancel_appointment",
  "maintenance_question",
];
