import type { AgentToolAction, AgentToolEnvelope } from "@/lib/agent-tools/envelope";

export type StudioSlot = {
  slot_token?: string | null;
  display?: string | null;
};

export type StudioSlotFields = {
  availability_found: boolean;
  slot_1_display: string | null;
  slot_1_token: string | null;
  slot_2_display: string | null;
  slot_2_token: string | null;
  slot_3_display: string | null;
  slot_3_token: string | null;
  slot_4_display: string | null;
  slot_4_token: string | null;
  available_slots_text: string;
};

export type AvailabilityStudioFields = StudioSlotFields & {
  customer_status: string | null;
  customer_first_name: string | null;
  customer_id: string | null;
  property_status: string | null;
  property_id: string | null;
  property_address: string | null;
  service_type_name: string | null;
  requires_customer_name: boolean;
  requires_service_address: boolean;
  requires_property_selection: boolean;
  requires_office: boolean;
  agent_instruction: string;
  error_code: string | null;
};

export type BookingStudioFields = StudioSlotFields & {
  booking_confirmed: boolean;
  booking_id: string | null;
  job_id: string | null;
  job_number: string | null;
  appointment_display: string | null;
  appointment_date: string | null;
  appointment_window_start: string | null;
  appointment_window_end: string | null;
  customer_first_name: string | null;
  property_address: string | null;
  technician_name: string | null;
  requires_customer_name: boolean;
  requires_service_address: boolean;
  requires_property_selection: boolean;
  agent_instruction: string;
  error_code: string | null;
};

const AVAILABLE_INSTRUCTION =
  "Offer only the returned ContractorYou appointment windows. Do not invent additional availability.";
const ADDRESS_INSTRUCTION =
  "Customer was found, but service address is required before booking. Ask only for the service address.";
const MULTIPLE_PROPERTIES_INSTRUCTION =
  "Customer has multiple properties. Ask which service address this visit is for.";
const NO_AVAILABILITY_INSTRUCTION =
  "No valid ContractorYou appointment windows were found. Do not promise a time.";
const NEW_CUSTOMER_INSTRUCTION =
  "Customer is new. Ask only for name and service address before booking. Offer only the returned appointment windows if any were found.";
const BOOKED_INSTRUCTION = "The appointment is confirmed. Confirm this exact appointment naturally.";
const SLOT_GONE_INSTRUCTION =
  "That window was just taken. Offer only the newly returned appointment windows. Do not invent another time.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function extractSlots(data: unknown): StudioSlot[] {
  const record = asRecord(data);
  const raw = record?.available_slots;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = asRecord(row);
      if (!item) return null;
      const display = asString(item.display);
      const token = asString(item.slot_token);
      if (!display && !token) return null;
      return { display, slot_token: token };
    })
    .filter((row): row is StudioSlot => Boolean(row));
}

export function flattenSlots(slots: StudioSlot[]): StudioSlotFields {
  const firstFour = slots.slice(0, 4);
  const displays = firstFour.map((slot) => slot.display).filter((value): value is string => Boolean(value));
  return {
    availability_found: firstFour.length > 0,
    slot_1_display: firstFour[0]?.display ?? null,
    slot_1_token: firstFour[0]?.slot_token ?? null,
    slot_2_display: firstFour[1]?.display ?? null,
    slot_2_token: firstFour[1]?.slot_token ?? null,
    slot_3_display: firstFour[2]?.display ?? null,
    slot_3_token: firstFour[2]?.slot_token ?? null,
    slot_4_display: firstFour[3]?.display ?? null,
    slot_4_token: firstFour[3]?.slot_token ?? null,
    available_slots_text: displays.join(" | "),
  };
}

function customerRecord(data: Record<string, unknown> | null) {
  return asRecord(data?.customer);
}

function propertyAddressFromCustomer(customer: Record<string, unknown> | null) {
  const properties = Array.isArray(customer?.properties) ? customer.properties : [];
  const propertyId = asString(customer?.property_id);
  const match = properties
    .map((row) => asRecord(row))
    .find((row) => row && asString(row.id) === propertyId);
  return asString(match?.display_address) ?? asString(customer?.property_address);
}

function requiresList(data: Record<string, unknown> | null): string[] {
  return Array.isArray(data?.requires) ? data.requires.filter((row): row is string => typeof row === "string") : [];
}

export function availabilityInstruction(input: {
  availabilityFound: boolean;
  customerStatus: string | null;
  requiresCustomerName: boolean;
  requiresServiceAddress: boolean;
  requiresPropertySelection: boolean;
}) {
  if (!input.availabilityFound) return NO_AVAILABILITY_INSTRUCTION;
  if (input.requiresPropertySelection) return MULTIPLE_PROPERTIES_INSTRUCTION;
  if (input.customerStatus === "existing" && input.requiresServiceAddress) return ADDRESS_INSTRUCTION;
  if (input.customerStatus === "new" || input.requiresCustomerName) return NEW_CUSTOMER_INSTRUCTION;
  return AVAILABLE_INSTRUCTION;
}

export function availabilityStudioFields(
  data: unknown,
  errorCode: string | null = null
): AvailabilityStudioFields {
  const record = asRecord(data);
  const customer = customerRecord(record);
  const requires = requiresList(record);
  const slots = flattenSlots(extractSlots(record));
  const customerStatus = asString(customer?.status);
  const propertyStatus = asString(customer?.property_status);
  const requiresCustomerName = requires.includes("customer_name") || customerStatus === "new";
  const requiresPropertySelection = requires.includes("property_id") || propertyStatus === "multiple";
  const requiresServiceAddress =
    requires.includes("service_address") || propertyStatus === "missing" || (customerStatus === "new" && !requiresPropertySelection);
  const requiresOffice = record?.requires_office === true || !slots.availability_found;
  return {
    ...slots,
    customer_status: customerStatus,
    customer_first_name: asString(customer?.first_name),
    customer_id: asString(customer?.customer_id),
    property_status: propertyStatus,
    property_id: asString(customer?.property_id),
    property_address: propertyAddressFromCustomer(customer),
    service_type_name: asString(asRecord(record?.service_type)?.name),
    requires_customer_name: requiresCustomerName,
    requires_service_address: requiresServiceAddress,
    requires_property_selection: requiresPropertySelection,
    requires_office: requiresOffice,
    agent_instruction: availabilityInstruction({
      availabilityFound: slots.availability_found,
      customerStatus,
      requiresCustomerName,
      requiresServiceAddress,
      requiresPropertySelection,
    }),
    error_code: errorCode,
  };
}

function bookingInstruction(errorCode: string | null, confirmed: boolean) {
  if (errorCode === "SLOT_NO_LONGER_AVAILABLE") return SLOT_GONE_INSTRUCTION;
  if (errorCode === "SERVICE_ADDRESS_REQUIRED") return ADDRESS_INSTRUCTION;
  if (errorCode === "PROPERTY_SELECTION_REQUIRED") return MULTIPLE_PROPERTIES_INSTRUCTION;
  if (errorCode === "CUSTOMER_NAME_REQUIRED") return NEW_CUSTOMER_INSTRUCTION;
  if (confirmed) return BOOKED_INSTRUCTION;
  if (errorCode) return "The appointment could not be booked. Ask only for missing information or offer returned windows.";
  return BOOKED_INSTRUCTION;
}

export function bookingStudioFields(data: unknown, errorCode: string | null = null): BookingStudioFields {
  const record = asRecord(data);
  const booking = asRecord(record?.booking);
  const customer = customerRecord(record);
  const property = asRecord(record?.property);
  const slots = flattenSlots(extractSlots(record));
  const confirmed = Boolean(booking?.booking_id || booking?.job_id) && errorCode == null;
  return {
    ...slots,
    booking_confirmed: confirmed,
    booking_id: asString(booking?.booking_id),
    job_id: asString(booking?.job_id),
    job_number: asString(booking?.job_number),
    appointment_display: asString(booking?.display),
    appointment_date: asString(booking?.date),
    appointment_window_start: asString(booking?.window_start),
    appointment_window_end: asString(booking?.window_end),
    customer_first_name: asString(customer?.first_name),
    property_address: asString(property?.display_address),
    technician_name: asString(booking?.technician_name),
    requires_customer_name: errorCode === "CUSTOMER_NAME_REQUIRED",
    requires_service_address: errorCode === "SERVICE_ADDRESS_REQUIRED",
    requires_property_selection: errorCode === "PROPERTY_SELECTION_REQUIRED",
    agent_instruction: bookingInstruction(errorCode, confirmed),
    error_code: errorCode,
  };
}

export function withStudioFields<T>(envelope: AgentToolEnvelope<T>): AgentToolEnvelope<T> &
  Partial<AvailabilityStudioFields & BookingStudioFields> {
  const errorCode = envelope.error?.code ?? null;
  if (envelope.action === "check_availability") {
    return { ...availabilityStudioFields(envelope.data, errorCode), ...envelope };
  }
  return { ...bookingStudioFields(envelope.data, errorCode), ...envelope };
}

export function studioFieldNames(action: AgentToolAction) {
  if (action === "check_availability") {
    return [
      "availability_found",
      "customer_status",
      "customer_first_name",
      "customer_id",
      "property_status",
      "property_id",
      "property_address",
      "service_type_name",
      "slot_1_display",
      "slot_1_token",
      "slot_2_display",
      "slot_2_token",
      "slot_3_display",
      "slot_3_token",
      "slot_4_display",
      "slot_4_token",
      "available_slots_text",
      "requires_customer_name",
      "requires_service_address",
      "requires_property_selection",
      "requires_office",
      "agent_instruction",
      "error_code",
    ];
  }
  return [
    "booking_confirmed",
    "booking_id",
    "job_id",
    "job_number",
    "appointment_display",
    "appointment_date",
    "appointment_window_start",
    "appointment_window_end",
    "customer_first_name",
    "property_address",
    "technician_name",
    "slot_1_display",
    "slot_1_token",
    "slot_2_display",
    "slot_2_token",
    "slot_3_display",
    "slot_3_token",
    "slot_4_display",
    "slot_4_token",
    "available_slots_text",
    "availability_found",
    "agent_instruction",
    "error_code",
  ];
}
