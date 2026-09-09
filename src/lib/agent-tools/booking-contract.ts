import { z } from "zod";
import { canonicalizeUsPhone } from "@/lib/phone";

export const toolAddressSchema = z.union([
  z.string(),
  z.object({
    line1: z.string().optional(),
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postal_code: z.string().optional(),
    zip: z.string().optional(),
  }),
]);
import {
  hasReliableCustomerName,
  parseIntake,
  parsePersonName,
  parseServiceAddress,
  type SchedulingIntake,
} from "@/lib/scheduling/conversation-identity";
import type { OfferedSlot } from "@/lib/scheduling/conversation-turn";

export const HYBRID_PHASES = [
  "NEED_CUSTOMER",
  "NEED_PROPERTY",
  "NEED_SERVICE_CONTEXT",
  "CHECK_AVAILABILITY",
  "SLOTS_OFFERED",
  "SLOT_SELECTED",
  "READY_TO_BOOK",
  "BOOKING",
  "BOOKED",
] as const;

export type HybridPhase = (typeof HYBRID_PHASES)[number];

export const DO_NOT_CLAIM_BOOKED =
  "Do not tell the customer they are booked. ContractorYou will send the booking confirmation after the booking transaction succeeds.";
export const DO_NOT_DUPLICATE_CONFIRMATION =
  "Booking is confirmed in ContractorYou. Do not send a duplicate confirmation because ContractorYou already sent it.";
export const ASK_NAME_THEN_BOOK =
  "The selected appointment is saved. Ask only for the customer's name. Do not say they are scheduled. Do not make them pick the appointment again.";
export const ASK_ADDRESS_THEN_BOOK =
  "The selected appointment is saved. Ask only for the service address. Do not say they are scheduled. Do not make them pick the appointment again.";
export const ASK_PROPERTY_THEN_BOOK =
  "The selected appointment is saved. Ask which property this visit is for. Do not say they are scheduled.";
export const TRIGGER_BOOK_SELECTED_SLOT =
  "Do not tell the customer they are booked. Trigger Book Selected Slot. ContractorYou will send the booking confirmation after the booking transaction succeeds.";
export const HAND_OFF_TO_OFFICE =
  "Do not guess. Do not tell the customer they are booked. Have the office finish scheduling.";

export type BookingReadiness = {
  phase: HybridPhase;
  ready_to_book: boolean;
  booking_confirmed: false;
  requires_customer_name: boolean;
  requires_service_address: boolean;
  requires_property_selection: boolean;
  requires_office: boolean;
  customer_id: string | null;
  customer_first_name: string | null;
  property_id: string | null;
  property_address: string | null;
  missingField: "name" | "address" | "property" | "service" | null;
};

export function chooseResolvedThread<T extends { id: string; lastActivityAt: Date; externalContactId?: string | null }>(
  matches: T[],
  contactId?: string | null,
  recentMs = 36 * 60 * 60 * 1000
): { status: "resolved"; thread: T } | { status: "ambiguous"; count: number } | { status: "not_found" } {
  if (!matches.length) return { status: "not_found" };
  const scoped = contactId ? matches.filter((row) => row.externalContactId === contactId) : matches;
  const pool = scoped.length ? scoped : matches;
  if (pool.length === 1) return { status: "resolved", thread: pool[0]! };
  const now = Date.now();
  const recent = pool.filter((row) => now - row.lastActivityAt.getTime() <= recentMs);
  if (recent.length === 1) return { status: "resolved", thread: recent[0]! };
  return { status: "ambiguous", count: recent.length || pool.length };
}

export function coerceToolBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n", ""].includes(normalized)) return false;
  }
  return undefined;
}

function firstPresent(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return undefined;
}

export function normalizeAgentToolBody(body: unknown): Record<string, unknown> {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? { ...(body as Record<string, unknown>) } : {};
  const phone = firstPresent(raw, ["customer_phone", "phone", "customerPhone", "from", "customer_phone_number"]);
  const reply = firstPresent(raw, ["customer_reply", "reply", "message", "text", "inbound_message", "customerReply"]);
  const contact = firstPresent(raw, ["contact_id", "contactId", "contactID"]);
  const conversation = firstPresent(raw, ["conversation_id", "conversationId"]);
  const address = firstPresent(raw, ["service_address", "address", "serviceAddress"]);
  const send = coerceToolBoolean(firstPresent(raw, ["send_to_customer", "sendToCustomer", "send_to_customer"]));
  if (phone !== undefined) raw.customer_phone = phone;
  if (reply !== undefined) raw.customer_reply = reply;
  if (contact !== undefined) raw.contact_id = contact;
  if (conversation !== undefined) raw.conversation_id = conversation;
  if (address !== undefined) raw.service_address = address;
  if (send !== undefined) raw.send_to_customer = send;
  return raw;
}

export function logHybridAction(event: {
  action: "CHECK" | "SELECT" | "MISSING_INFO" | "BOOK";
  companyId: string;
  threadResolved?: boolean;
  threadAmbiguous?: boolean;
  matchStatus?: string | null;
  slotDate?: string | null;
  requiresCustomerName?: boolean;
  readyToBook?: boolean;
  bookingConfirmed?: boolean;
  sendToCustomer?: boolean;
  smsSent?: boolean;
  smsSkipReason?: string | null;
  errorCode?: string | null;
  phase?: string | null;
  source?: string | null;
}) {
  console.info("[hybrid-action]", JSON.stringify(event));
}

export function actionSmsDedupeKey(kind: string, body: string) {
  return `SMS:${kind}:${body.trim().slice(0, 80)}`;
}

export function phoneLookupVariants(value?: string | null) {
  const raw = (value || "").trim();
  const canonical = canonicalizeUsPhone(value);
  if (!canonical) return raw ? [raw] : [];
  const national = canonical.slice(2);
  return Array.from(
    new Set([
      canonical,
      national,
      `1${national}`,
      `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`,
      `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`,
      `${national.slice(0, 3)}.${national.slice(3, 6)}.${national.slice(6)}`,
    ])
  );
}

export function parseToolServiceAddress(value: unknown): SchedulingIntake | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = parseServiceAddress(value);
    return parsed;
  }
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    const line1 = typeof row.line1 === "string" ? row.line1 : typeof row.street === "string" ? row.street : null;
    if (!line1?.trim()) return null;
    const structured = {
      street: line1.trim(),
      city: typeof row.city === "string" ? row.city.trim() : "",
      state: typeof row.state === "string" ? row.state.trim() : "",
      zip: typeof row.postal_code === "string" ? row.postal_code.trim() : typeof row.zip === "string" ? row.zip.trim() : "",
    };
    if (structured.city && structured.state && structured.zip) return structured;
    return parseServiceAddress(line1) ?? structured;
  }
  return null;
}

export function parseToolPersonName(input: {
  customer_name?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_reply?: string | null;
}) {
  const composed = [input.customer_first_name, input.customer_last_name].filter(Boolean).join(" ").trim();
  return parsePersonName(input.customer_name || "") || parsePersonName(composed) || parsePersonName(input.customer_reply || "");
}

export function mergeSchedulingIntake(
  current: SchedulingIntake,
  extra: Partial<SchedulingIntake>
): SchedulingIntake {
  return {
    firstName: extra.firstName || current.firstName || null,
    lastName: extra.lastName || current.lastName || null,
    street: extra.street || current.street || null,
    city: extra.city || current.city || null,
    state: extra.state || current.state || null,
    zip: extra.zip || current.zip || null,
  };
}

export function intakeFromUnknown(value: unknown): SchedulingIntake {
  return parseIntake(value);
}

export function selectedSlotFromState(input: {
  requestedDate?: Date | string | null;
  requestedWindowId?: string | null;
  offeredSlots?: OfferedSlot[];
}) {
  const date =
    input.requestedDate instanceof Date
      ? input.requestedDate.toISOString().slice(0, 10)
      : typeof input.requestedDate === "string"
        ? input.requestedDate.slice(0, 10)
        : null;
  if (!date || !input.requestedWindowId) return null;
  const offered = input.offeredSlots?.find((slot) => slot.date === date && slot.windowId === input.requestedWindowId);
  return {
    date,
    windowId: input.requestedWindowId,
    startMinutes: offered?.startMinutes ?? 9 * 60,
    endMinutes: offered?.endMinutes ?? 11 * 60,
  };
}

export function evaluateBookingReadiness(input: {
  booked?: boolean;
  customerId?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  propertyId?: string | null;
  propertyAddress?: string | null;
  propertyCount?: number;
  intake?: SchedulingIntake;
  hasServiceContext?: boolean;
  offeredCount?: number;
  selectedSlot?: { date: string; windowId: string } | null;
  requiresOffice?: boolean;
}): BookingReadiness {
  const intake = input.intake ?? {};
  const existingName = hasReliableCustomerName(input.customerFirstName, input.customerLastName);
  const intakeName = hasReliableCustomerName(intake.firstName, intake.lastName);
  const hasName = Boolean(input.customerId ? existingName : existingName || intakeName);
  const propertyCount = input.propertyCount ?? (input.propertyId ? 1 : 0);
  const intakeAddress = Boolean(intake.street?.trim());
  const hasProperty = Boolean(input.propertyId) || (propertyCount === 0 && intakeAddress);
  const multipleProperties = propertyCount > 1 && !input.propertyId;
  const hasService = input.hasServiceContext !== false;
  const selected = Boolean(input.selectedSlot);
  const offered = (input.offeredCount ?? 0) > 0;

  const requires_customer_name = !hasName;
  const requires_property_selection = multipleProperties;
  const requires_service_address = !multipleProperties && !hasProperty;
  const requires_office = Boolean(input.requiresOffice);

  let phase: HybridPhase = "NEED_CUSTOMER";
  if (input.booked) phase = "BOOKED";
  else if (requires_office && !selected) phase = "NEED_SERVICE_CONTEXT";
  else if (selected && hasName && hasProperty && hasService && !multipleProperties) phase = "READY_TO_BOOK";
  else if (selected) phase = "SLOT_SELECTED";
  else if (offered) phase = "SLOTS_OFFERED";
  else if (!hasService) phase = "NEED_SERVICE_CONTEXT";
  else if (!hasProperty) phase = "NEED_PROPERTY";
  else if (!hasName) phase = "NEED_CUSTOMER";
  else phase = "CHECK_AVAILABILITY";

  const ready_to_book =
    !input.booked &&
    !requires_office &&
    selected &&
    hasName &&
    hasProperty &&
    hasService &&
    !multipleProperties;

  return {
    phase,
    ready_to_book,
    booking_confirmed: false,
    requires_customer_name,
    requires_service_address,
    requires_property_selection,
    requires_office,
    customer_id: input.customerId ?? null,
    customer_first_name: input.customerFirstName || intake.firstName || null,
    property_id: input.propertyId ?? null,
    property_address: input.propertyAddress || intake.street || null,
    missingField: requires_customer_name
      ? "name"
      : requires_property_selection
        ? "property"
        : requires_service_address
          ? "address"
          : !hasService
            ? "service"
            : null,
  };
}

export function isBookingActuallyConfirmed(input: {
  booking_confirmed?: unknown;
  job_id?: unknown;
  booking_id?: unknown;
  error_code?: unknown;
}) {
  if (input.error_code) return false;
  if (input.booking_confirmed !== true) return false;
  return typeof input.job_id === "string" && Boolean(input.job_id) && typeof input.booking_id === "string" && Boolean(input.booking_id);
}

export function agentInstructionForReadiness(readiness: BookingReadiness, booked: boolean) {
  if (booked) return DO_NOT_DUPLICATE_CONFIRMATION;
  if (readiness.requires_office) return HAND_OFF_TO_OFFICE;
  if (readiness.ready_to_book) return TRIGGER_BOOK_SELECTED_SLOT;
  if (readiness.requires_customer_name) return ASK_NAME_THEN_BOOK;
  if (readiness.requires_property_selection) return ASK_PROPERTY_THEN_BOOK;
  if (readiness.requires_service_address) return ASK_ADDRESS_THEN_BOOK;
  return DO_NOT_CLAIM_BOOKED;
}

export function blockedBookingPayload(input: {
  readiness: BookingReadiness;
  customer_message: string;
  error_code: string | null;
  slot_selected?: boolean;
  match_status?: string | null;
  appointment_display?: string | null;
  slot_token?: string | null;
}) {
  return {
    booking_confirmed: false as const,
    success_means_booked: false as const,
    booking_id: null,
    job_id: null,
    job_number: null,
    appointment_display: input.appointment_display ?? null,
    customer_id: input.readiness.customer_id,
    customer_first_name: input.readiness.customer_first_name,
    property_id: input.readiness.property_id,
    property_address: input.readiness.property_address,
    requires_customer_name: input.readiness.requires_customer_name,
    requires_service_address: input.readiness.requires_service_address,
    requires_property_selection: input.readiness.requires_property_selection,
    requires_office: input.readiness.requires_office,
    ready_to_book: input.readiness.ready_to_book,
    slot_selected: Boolean(input.slot_selected),
    match_status: input.match_status ?? null,
    slot_token: input.slot_token ?? null,
    scheduling_phase: input.readiness.phase,
    customer_message: input.customer_message,
    error_code: input.error_code,
  };
}
