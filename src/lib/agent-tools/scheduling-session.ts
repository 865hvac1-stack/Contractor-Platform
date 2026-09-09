import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  actionSmsDedupeKey,
  logHybridAction,
  mergeSchedulingIntake,
  normalizeAgentToolBody,
  parseToolPersonName,
  parseToolServiceAddress,
  selectedSlotFromState,
  toolAddressSchema,
  type SchedulingSessionPhase,
} from "@/lib/agent-tools/booking-contract";
import { bookAppointmentTool } from "@/lib/agent-tools/book-appointment";
import { checkAvailabilityTool } from "@/lib/agent-tools/check-availability";
import { customerPayload, resolveToolCustomer, validateHighLevelLocation } from "@/lib/agent-tools/context";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import {
  isActiveSchedulingSession,
  loadOpenSchedulingSession,
  persistOfferedSlots,
  persistSchedulingSession,
  persistSelectedSlot,
  resolveActionThread,
} from "@/lib/agent-tools/persist-offers";
import { sendActionResultSms } from "@/lib/agent-tools/send-result";
import { prisma } from "@/lib/db";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import {
  extractCustomerConcern,
  hasReliableCustomerName,
  matchPropertyFromText,
  parseIntake,
  parsePersonName,
  parseServiceAddress,
  propertyChoiceLabel,
  type SchedulingIntake,
} from "@/lib/scheduling/conversation-identity";
import {
  isDeclineScheduling,
  parseOfferedSlots,
  resolveOfferedSlotSelection,
  type OfferedSlot,
} from "@/lib/scheduling/conversation-turn";
import {
  askNameBeforeFinishingSchedule,
  askNameMessage,
  askServiceConcernMessage,
  askWhichPropertyForServiceMessage,
  askWhichPropertyMessage,
  contractorYouOfferWindowsMessage,
  officeReviewMessage,
  sessionClosedMessage,
  slotTakenOfferMessage,
  thanksNameAskAddressMessage,
  unmatchedOfferedSlotMessage,
} from "@/lib/scheduling/templates";

export const startSchedulingSchema = z.object({
  location_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  conversation_id: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  customer_first_name: z.string().optional().nullable(),
  customer_last_name: z.string().optional().nullable(),
  customer_reply: z.string().optional().nullable(),
  service_type: z.string().optional().nullable(),
  service_need: z.string().optional().nullable(),
  service_address: toolAddressSchema.optional().nullable(),
  send_to_customer: z.boolean().optional(),
});

export type SchedulingInboundKind =
  | "decline"
  | "handoff"
  | "slot_match"
  | "slot_ambiguous"
  | "slot_none"
  | "name"
  | "address"
  | "property"
  | "concern"
  | "unknown";

export type SchedulingDecision =
  | { action: "already_booked"; phase: SchedulingSessionPhase }
  | { action: "cancel"; phase: "CANCELLED" }
  | { action: "handoff"; phase: "HANDOFF" }
  | { action: "ask_name"; phase: "NEED_CUSTOMER_NAME" | "SLOT_SELECTED"; afterSlot: boolean }
  | { action: "ask_address"; phase: "NEED_PROPERTY" | "SLOT_SELECTED" }
  | { action: "ask_property"; phase: "NEED_PROPERTY" | "SLOT_SELECTED" }
  | { action: "ask_concern"; phase: "NEED_SERVICE_CONTEXT" }
  | { action: "offer_slots"; phase: "CHECKING_AVAILABILITY" }
  | { action: "clarify_slots"; phase: "WAITING_FOR_SLOT_SELECTION" }
  | { action: "unmatched_slot"; phase: "WAITING_FOR_SLOT_SELECTION" }
  | { action: "select_slot"; phase: "SLOT_SELECTED" }
  | { action: "book"; phase: "READY_TO_BOOK" }
  | { action: "noop"; phase: SchedulingSessionPhase };

const HUMAN_HANDOFF =
  /\b(human|person|office|someone from the office|talk to (a )?person|speak to (a )?(human|person|rep)|representative|real person)\b/i;

export function decideSchedulingNextStep(input: {
  booked?: boolean;
  hasReliableName: boolean;
  propertyCount: number;
  propertyId?: string | null;
  hasAddress: boolean;
  hasConcern: boolean;
  offeredCount: number;
  selectedSlot?: { date: string; windowId: string } | null;
  inboundKind?: SchedulingInboundKind;
  phase?: string | null;
}): SchedulingDecision {
  if (input.booked) return { action: "already_booked", phase: "BOOKED" };
  if (input.inboundKind === "decline") return { action: "cancel", phase: "CANCELLED" };
  if (input.inboundKind === "handoff") return { action: "handoff", phase: "HANDOFF" };

  const selected = Boolean(input.selectedSlot);
  const multipleProperties = input.propertyCount > 1 && !input.propertyId;
  const hasProperty = Boolean(input.propertyId) || (input.propertyCount === 0 && input.hasAddress) || input.hasAddress;

  if (input.inboundKind === "slot_match") return { action: "select_slot", phase: "SLOT_SELECTED" };
  if (input.inboundKind === "slot_ambiguous") return { action: "clarify_slots", phase: "WAITING_FOR_SLOT_SELECTION" };
  if (
    (input.phase === "WAITING_FOR_SLOT_SELECTION" || input.phase === "SLOTS_OFFERED") &&
    input.inboundKind === "slot_none" &&
    input.offeredCount > 0 &&
    !selected
  ) {
    return { action: "unmatched_slot", phase: "WAITING_FOR_SLOT_SELECTION" };
  }

  if (selected) {
    if (!input.hasReliableName) return { action: "ask_name", phase: "SLOT_SELECTED", afterSlot: true };
    if (multipleProperties) return { action: "ask_property", phase: "SLOT_SELECTED" };
    if (!hasProperty) return { action: "ask_address", phase: "SLOT_SELECTED" };
    if (!input.hasConcern) return { action: "ask_concern", phase: "NEED_SERVICE_CONTEXT" };
    return { action: "book", phase: "READY_TO_BOOK" };
  }

  if (multipleProperties) return { action: "ask_property", phase: "NEED_PROPERTY" };
  if (!hasProperty) {
    if (!input.hasReliableName) return { action: "ask_name", phase: "NEED_CUSTOMER_NAME", afterSlot: false };
    return { action: "ask_address", phase: "NEED_PROPERTY" };
  }
  if (!input.hasConcern) return { action: "ask_concern", phase: "NEED_SERVICE_CONTEXT" };
  if (input.offeredCount > 0 && (input.phase === "WAITING_FOR_SLOT_SELECTION" || input.phase === "SLOTS_OFFERED")) {
    return { action: "noop", phase: "WAITING_FOR_SLOT_SELECTION" };
  }
  return { action: "offer_slots", phase: "CHECKING_AVAILABILITY" };
}

export function classifySchedulingInbound(input: {
  text: string;
  offered: OfferedSlot[];
  selected: boolean;
  phase?: string | null;
}): SchedulingInboundKind {
  const text = input.text.trim();
  if (!text) return "unknown";
  if (isDeclineScheduling(text)) return "decline";
  if (HUMAN_HANDOFF.test(text)) return "handoff";

  const waiting = input.phase === "WAITING_FOR_SLOT_SELECTION" || input.phase === "SLOTS_OFFERED" || input.offered.length > 0;
  if (waiting && !input.selected && input.offered.length) {
    const selection = resolveOfferedSlotSelection(text, input.offered);
    if (selection.kind === "match") return "slot_match";
    if (selection.kind === "ambiguous") return "slot_ambiguous";
    if (input.phase === "WAITING_FOR_SLOT_SELECTION" || input.phase === "SLOTS_OFFERED") return "slot_none";
  }

  if (parseServiceAddress(text)) return "address";
  if (parsePersonName(text)) return "name";
  if (extractCustomerConcern(text)) return "concern";
  return "unknown";
}

function sessionStatusForPhase(phase: string): "OPEN" | "CLARIFYING" | "SUGGESTED" | "NEEDS_REVIEW" | "BOOKED" | "CANCELED" {
  if (phase === "BOOKED") return "BOOKED";
  if (phase === "CANCELLED") return "CANCELED";
  if (phase === "HANDOFF") return "NEEDS_REVIEW";
  if (phase === "WAITING_FOR_SLOT_SELECTION" || phase === "SLOTS_OFFERED") return "SUGGESTED";
  return "CLARIFYING";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function slotLinesFromCheckBody(body: unknown): string[] {
  const record = asRecord(body);
  const data = asRecord(record?.data) ?? record;
  const slots = Array.isArray(data?.available_slots) ? data.available_slots : [];
  return slots
    .map((row) => asRecord(row)?.display)
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

function offeredFromCheckBody(body: unknown): OfferedSlot[] {
  const record = asRecord(body);
  const data = asRecord(record?.data) ?? record;
  const slots = Array.isArray(data?.available_slots) ? data.available_slots : [];
  return slots
    .map((row) => {
      const item = asRecord(row);
      if (!item || typeof item.date !== "string" || typeof item.window_id !== "string") return null;
      const start = typeof item.window_start === "string" ? item.window_start.split(":").map(Number) : [];
      const end = typeof item.window_end === "string" ? item.window_end.split(":").map(Number) : [];
      return {
        date: item.date,
        windowId: item.window_id,
        startMinutes: (start[0] ?? 9) * 60 + (start[1] ?? 0),
        endMinutes: (end[0] ?? 11) * 60 + (end[1] ?? 0),
      } satisfies OfferedSlot;
    })
    .filter((row): row is OfferedSlot => Boolean(row));
}

async function sendSessionSms(input: {
  companyId: string;
  phone?: string | null;
  customerId?: string | null;
  body: string;
  kind: string;
  previousIntent?: string | null;
  send: boolean;
}) {
  const dedupe = actionSmsDedupeKey(input.kind, input.body);
  if (!input.send) return { sent: false as const, skipReason: "send_to_customer_false", dedupe };
  if (input.previousIntent === dedupe) return { sent: false as const, skipReason: "duplicate_sms", dedupe };
  const result = await sendActionResultSms({
    companyId: input.companyId,
    phone: input.phone,
    customerId: input.customerId,
    body: input.body,
    send: true,
  });
  return { ...result, dedupe };
}

function propertyQuestion(properties: Array<{ address: string; city: string; state: string; zip: string; isPrimary: boolean; id: string }>) {
  if (!properties.length) return askWhichPropertyForServiceMessage();
  return askWhichPropertyMessage(properties.map((row, index) => propertyChoiceLabel(row, index)));
}

export async function startSchedulingTool(input: { companyId: string; body: unknown; source?: string }) {
  const parsed = startSchedulingSchema.safeParse(normalizeAgentToolBody(input.body));
  if (!parsed.success) {
    return {
      status: 400,
      body: toolError("start_scheduling", "INVALID_REQUEST", "phone or contact_id is required to start scheduling."),
    };
  }
  const body = parsed.data;
  const location = await validateHighLevelLocation(input.companyId, body.location_id);
  if (!location.ok) {
    return { status: 403, body: toolError("start_scheduling", location.code, location.message) };
  }
  const resolvedThread = await resolveActionThread({
    companyId: input.companyId,
    conversationId: body.conversation_id,
    phone: body.customer_phone,
    contactId: body.contact_id,
  });
  if (resolvedThread.status === "ambiguous") {
    logHybridAction({
      action: "START",
      companyId: input.companyId,
      threadAmbiguous: true,
      errorCode: "CONVERSATION_AMBIGUOUS",
      source: input.source ?? "agent_tool",
    });
    return {
      status: 422,
      body: toolError(
        "start_scheduling",
        "CONVERSATION_AMBIGUOUS",
        "More than one active ContractorYou conversation matched that phone. The office needs to finish this.",
        { requires_office: true, booking_confirmed: false, scheduling_phase: "HANDOFF" }
      ),
    };
  }
  if (resolvedThread.status === "not_found") {
    return {
      status: 422,
      body: toolError("start_scheduling", "CONVERSATION_NOT_FOUND", "No ContractorYou conversation was found for that request.", {
        requires_office: true,
        booking_confirmed: false,
      }),
    };
  }

  return advanceSchedulingSession({
    companyId: input.companyId,
    thread: resolvedThread.thread,
    phone: body.customer_phone || resolvedThread.thread.phone,
    contactId: body.contact_id || resolvedThread.thread.externalContactId,
    inboundText: body.customer_reply,
    inboundMessageId: null,
    serviceType: body.service_type,
    serviceNeed: body.service_need,
    serviceAddress: body.service_address,
    customerName: body.customer_name,
    customerFirstName: body.customer_first_name,
    customerLastName: body.customer_last_name,
    sendToCustomer: body.send_to_customer !== false,
    source: input.source ?? "start_scheduling",
    createIfMissing: true,
  });
}

export async function processSchedulingSessionInbound(input: {
  companyId: string;
  threadId: string;
  messageId: string;
  phone?: string | null;
  contactId?: string | null;
  body?: string | null;
}) {
  const text = input.body?.trim() || "";
  if (!text) return { handled: false as const, reason: "empty" };
  const thread = await prisma.communicationThread.findFirst({
    where: { id: input.threadId, companyId: input.companyId, provider: HIGHLEVEL_PROVIDER_KEY },
    select: {
      id: true,
      companyId: true,
      phone: true,
      customerId: true,
      leadId: true,
      externalId: true,
      externalContactId: true,
      lastActivityAt: true,
      provider: true,
    },
  });
  if (!thread) return { handled: false as const, reason: "no_thread" };
  const state = await loadOpenSchedulingSession(input.companyId, thread.id);
  if (!state || !isActiveSchedulingSession(state)) return { handled: false as const, reason: "no_active_session" };
  if (state.lastInboundMessageId === input.messageId) {
    return { handled: true as const, reason: "duplicate" };
  }

  try {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { lastInboundMessageId: input.messageId },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { handled: true as const, reason: "duplicate" };
    }
    throw error;
  }

  const result = await advanceSchedulingSession({
    companyId: input.companyId,
    thread,
    stateId: state.id,
    phone: input.phone || thread.phone,
    contactId: input.contactId || thread.externalContactId,
    inboundText: text,
    inboundMessageId: input.messageId,
    serviceNeed: state.customerConcern,
    sendToCustomer: true,
    source: "inbound_session",
    createIfMissing: false,
  });
  logHybridAction({
    action: "START",
    companyId: input.companyId,
    source: "inbound_session",
    phase: typeof result.body === "object" && result.body && "scheduling_phase" in result.body ? String(result.body.scheduling_phase) : null,
    bookingConfirmed: Boolean(asRecord(result.body)?.booking_confirmed),
    errorCode: (() => {
      const code = asRecord(asRecord(result.body)?.error)?.code;
      return typeof code === "string" ? code : null;
    })(),
  });
  return { handled: true as const, reason: "session_advanced", status: result.status };
}

async function advanceSchedulingSession(input: {
  companyId: string;
  thread: {
    id: string;
    phone: string | null;
    customerId: string | null;
    externalContactId: string | null;
  };
  stateId?: string | null;
  phone?: string | null;
  contactId?: string | null;
  inboundText?: string | null;
  inboundMessageId?: string | null;
  serviceType?: string | null;
  serviceNeed?: string | null;
  serviceAddress?: unknown;
  customerName?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  sendToCustomer: boolean;
  source: string;
  createIfMissing: boolean;
}) {
  const existing = input.stateId
    ? await prisma.conversationSchedulingState.findFirst({ where: { id: input.stateId, companyId: input.companyId } })
    : await loadOpenSchedulingSession(input.companyId, input.thread.id);

  if (existing?.status === "BOOKED" && existing.bookedJobId) {
    return {
      status: 200,
      customerId: existing.customerId,
      propertyId: existing.propertyId,
      jobId: existing.bookedJobId,
      body: toolOk("start_scheduling", {
        booking_confirmed: true,
        scheduling_phase: "BOOKED",
        job_id: existing.bookedJobId,
        customer_message: null,
        agent_instruction: "This conversation already has a booked appointment. Do not send a duplicate confirmation.",
      }),
    };
  }

  if (!existing && !input.createIfMissing) {
    return {
      status: 422,
      body: toolError("start_scheduling", "CONVERSATION_NOT_FOUND", "No active ContractorYou scheduling session was found."),
    };
  }

  const inboundName =
    parseToolPersonName({
      customer_name: input.customerName,
      customer_first_name: input.customerFirstName,
      customer_last_name: input.customerLastName,
      customer_reply: input.inboundText,
    }) || null;
  const inboundAddress =
    parseToolServiceAddress(input.serviceAddress) || parseToolServiceAddress(input.inboundText) || parseServiceAddress(input.inboundText || "");
  const inboundConcern = extractCustomerConcern(input.serviceNeed || "") || extractCustomerConcern(input.inboundText || "");

  let intake = mergeSchedulingIntake(parseIntake(existing?.intake), {
    ...(inboundName ? { firstName: inboundName.firstName, lastName: inboundName.lastName } : {}),
    ...(inboundAddress ?? {}),
  });

  const resolved = await resolveToolCustomer({
    companyId: input.companyId,
    contactId: input.contactId,
    conversationId: null,
    phone: input.phone || input.thread.phone,
  });
  const customer = customerPayload(resolved.context);
  const properties = resolved.context?.properties ?? [];
  let propertyId = existing?.propertyId || (customer.property_count === 1 ? customer.property_id : null);
  if (!propertyId && input.inboundText && properties.length > 1) {
    const matched = matchPropertyFromText(input.inboundText, properties);
    if (matched.length === 1) propertyId = matched[0]!.id;
  }

  const offered = parseOfferedSlots(existing?.offeredSlots);
  const selected = selectedSlotFromState({
    requestedDate: existing?.requestedDate,
    requestedWindowId: existing?.requestedWindowId,
    offeredSlots: offered,
  });
  const concern = existing?.customerConcern || input.serviceNeed || inboundConcern;
  const inboundKind = input.inboundText
    ? classifySchedulingInbound({
        text: input.inboundText,
        offered,
        selected: Boolean(selected),
        phase: existing?.lastAiAction,
      })
    : "unknown";

  if (inboundKind === "property" || (properties.length > 1 && input.inboundText)) {
    const matched = matchPropertyFromText(input.inboundText || "", properties);
    if (matched.length === 1) propertyId = matched[0]!.id;
  }

  const reliableName = Boolean(
    customer.customer_id
      ? hasReliableCustomerName(resolved.context?.firstName, resolved.context?.lastName)
      : hasReliableCustomerName(intake.firstName, intake.lastName)
  );

  const decision = decideSchedulingNextStep({
    booked: existing?.status === "BOOKED",
    hasReliableName: reliableName,
    propertyCount: propertyId ? 1 : customer.property_count,
    propertyId,
    hasAddress: Boolean(intake.street) || Boolean(propertyId),
    hasConcern: Boolean(concern),
    offeredCount: offered.length,
    selectedSlot: selected,
    inboundKind: input.inboundText ? inboundKind : "unknown",
    phase: existing?.lastAiAction,
  });

  const session = existing
    ? existing
    : await persistSchedulingSession({
        companyId: input.companyId,
        threadId: input.thread.id,
        phase: "STARTED",
        status: "OPEN",
        customerId: customer.customer_id,
        propertyId,
        customerConcern: concern,
        intake,
        lastInboundMessageId: input.inboundMessageId,
      });

  if (decision.action === "cancel") {
    await persistSchedulingSession({
      companyId: input.companyId,
      threadId: input.thread.id,
      stateId: session.id,
      phase: "CANCELLED",
      customerConcern: concern,
      intake,
      lastInboundMessageId: input.inboundMessageId,
    });
    const message = sessionClosedMessage();
    await sendSessionSms({
      companyId: input.companyId,
      phone: input.phone || input.thread.phone,
      customerId: customer.customer_id,
      body: message,
      kind: "cancelled",
      previousIntent: session.lastIntent,
      send: input.sendToCustomer,
    });
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId,
      body: toolOk("start_scheduling", {
        booking_confirmed: false,
        scheduling_phase: "CANCELLED",
        customer_message: message,
      }),
    };
  }

  if (decision.action === "handoff") {
    const message = officeReviewMessage();
    await persistSchedulingSession({
      companyId: input.companyId,
      threadId: input.thread.id,
      stateId: session.id,
      phase: "HANDOFF",
      customerConcern: concern,
      intake,
      handoffReason: "customer_requested",
      lastInboundMessageId: input.inboundMessageId,
    });
    await sendSessionSms({
      companyId: input.companyId,
      phone: input.phone || input.thread.phone,
      customerId: customer.customer_id,
      body: message,
      kind: "handoff",
      previousIntent: session.lastIntent,
      send: input.sendToCustomer,
    });
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId,
      body: toolOk("start_scheduling", {
        booking_confirmed: false,
        requires_office: true,
        scheduling_phase: "HANDOFF",
        customer_message: message,
      }),
    };
  }

  if (decision.action === "select_slot" || decision.action === "clarify_slots" || decision.action === "unmatched_slot" || decision.action === "book") {
    const selectResult = await (await import("@/lib/agent-tools/select-slot")).selectOfferedSlotTool({
      companyId: input.companyId,
      body: {
        customer_phone: input.phone || input.thread.phone,
        contact_id: input.contactId,
        customer_reply: input.inboundText || "",
        customer_name: inboundName ? `${inboundName.firstName} ${inboundName.lastName}`.trim() : input.customerName,
        service_address: intake.street,
        service_need: concern,
        send_to_customer: input.sendToCustomer,
      },
      source: input.source,
    });
    const selectBody = asRecord(selectResult.body);
    if (selectBody?.error && asRecord(selectBody.error)?.code === "SLOT_NO_LONGER_AVAILABLE") {
      return refreshTakenSlot({
        companyId: input.companyId,
        threadId: input.thread.id,
        stateId: session.id,
        phone: input.phone || input.thread.phone,
        customerId: customer.customer_id,
        propertyId,
        concern,
        intake,
        serviceType: input.serviceType,
        sendToCustomer: input.sendToCustomer,
        previousIntent: session.lastIntent,
        inboundMessageId: input.inboundMessageId,
      });
    }
    if (decision.action === "book" && !selectBody?.booking_confirmed) {
      const booked = await bookAppointmentTool({
        companyId: input.companyId,
        body: {
          customer_phone: input.phone || input.thread.phone,
          contact_id: input.contactId,
          customer_name: inboundName ? `${inboundName.firstName} ${inboundName.lastName}`.trim() : input.customerName,
          customer_reply: input.inboundText,
          service_address: intake.street,
          service_need: concern,
          service_type: input.serviceType,
          send_to_customer: input.sendToCustomer,
        },
      });
      const bookBody = asRecord(booked.body);
      if (bookBody?.error && asRecord(bookBody.error)?.code === "SLOT_NO_LONGER_AVAILABLE") {
        return refreshTakenSlot({
          companyId: input.companyId,
          threadId: input.thread.id,
          stateId: session.id,
          phone: input.phone || input.thread.phone,
          customerId: customer.customer_id,
          propertyId,
          concern,
          intake,
          serviceType: input.serviceType,
          sendToCustomer: input.sendToCustomer,
          previousIntent: session.lastIntent,
          inboundMessageId: input.inboundMessageId,
        });
      }
      return {
        ...booked,
        body: {
          ...booked.body,
          action: "start_scheduling",
          scheduling_phase: bookBody?.booking_confirmed ? "BOOKED" : "SLOT_SELECTED",
        },
      };
    }
    return {
      ...selectResult,
      body: {
        ...selectResult.body,
        action: "start_scheduling",
        scheduling_phase: selectBody?.booking_confirmed
          ? "BOOKED"
          : selectBody?.slot_selected
            ? "SLOT_SELECTED"
            : "WAITING_FOR_SLOT_SELECTION",
      },
    };
  }

  if (!input.inboundText && existing && (decision.action === "offer_slots" || decision.action === "noop") && offered.length) {
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId,
      body: toolOk("start_scheduling", {
        booking_confirmed: false,
        scheduling_phase: "WAITING_FOR_SLOT_SELECTION",
        customer_message: null,
        session_reused: true,
        slot_selected: Boolean(selected),
      }),
    };
  }

  if (decision.action === "offer_slots") {
    const check = await checkAvailabilityTool({
      companyId: input.companyId,
      body: {
        customer_phone: input.phone || input.thread.phone,
        contact_id: input.contactId,
        service_type: input.serviceType,
        service_need: concern,
        service_address: intake.street,
        send_to_customer: false,
      },
    });
    const lines = slotLinesFromCheckBody(check.body);
    const slots = offeredFromCheckBody(check.body);
    const message = contractorYouOfferWindowsMessage(lines);
    if (slots.length) {
      await persistOfferedSlots({
        companyId: input.companyId,
        threadId: input.thread.id,
        customerId: customer.customer_id,
        propertyId,
        customerConcern: concern,
        intake,
        slots,
        phase: "WAITING_FOR_SLOT_SELECTION",
        lastInboundMessageId: input.inboundMessageId,
      });
    } else {
      await persistSchedulingSession({
        companyId: input.companyId,
        threadId: input.thread.id,
        stateId: session.id,
        phase: "HANDOFF",
        customerId: customer.customer_id,
        propertyId,
        customerConcern: concern,
        intake,
        handoffReason: "no_availability",
        lastInboundMessageId: input.inboundMessageId,
      });
    }
    const sms = await sendSessionSms({
      companyId: input.companyId,
      phone: input.phone || input.thread.phone,
      customerId: customer.customer_id,
      body: message,
      kind: slots.length ? "offer_slots" : "no_availability",
      previousIntent: session.lastIntent,
      send: input.sendToCustomer,
    });
    if (sms.sent && slots.length) {
      await persistSchedulingSession({
        companyId: input.companyId,
        threadId: input.thread.id,
        stateId: session.id,
        phase: "WAITING_FOR_SLOT_SELECTION",
        lastIntent: sms.dedupe,
        customerConcern: concern,
        intake,
        offeredSlots: slots,
      });
    }
    logHybridAction({
      action: "START",
      companyId: input.companyId,
      threadResolved: true,
      sendToCustomer: input.sendToCustomer,
      smsSent: sms.sent,
      smsSkipReason: sms.sent ? null : sms.skipReason,
      phase: slots.length ? "WAITING_FOR_SLOT_SELECTION" : "HANDOFF",
      source: input.source,
    });
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId,
      serviceTypeId: check.serviceTypeId,
      body: toolOk("start_scheduling", {
        ...(asRecord(check.body)?.data && typeof check.body === "object" && check.body && "data" in check.body ? (check.body.data as object) : {}),
        booking_confirmed: false,
        scheduling_phase: slots.length ? "WAITING_FOR_SLOT_SELECTION" : "HANDOFF",
        customer_message: message,
        requires_office: !slots.length,
        session_reused: Boolean(existing),
      }),
    };
  }

  const ask = await askFromDecision({
    decision,
    properties,
    intake,
    companyId: input.companyId,
    phone: input.phone || input.thread.phone,
    customerId: customer.customer_id,
    propertyId,
    concern,
    threadId: input.thread.id,
    stateId: session.id,
    inboundMessageId: input.inboundMessageId,
    previousIntent: session.lastIntent,
    send: input.sendToCustomer,
    selected,
    offered,
  });
  logHybridAction({
    action: "START",
    companyId: input.companyId,
    threadResolved: true,
    requiresCustomerName: decision.action === "ask_name",
    sendToCustomer: input.sendToCustomer,
    smsSent: ask.smsSent,
    phase: decision.phase,
    source: input.source,
  });
  return {
    status: 200,
    customerId: customer.customer_id,
    propertyId,
    body: toolOk("start_scheduling", {
      booking_confirmed: false,
      scheduling_phase: decision.phase,
      customer_message: ask.message,
      requires_customer_name: decision.action === "ask_name",
      requires_service_address: decision.action === "ask_address",
      requires_property_selection: decision.action === "ask_property",
      slot_selected: Boolean(selected),
      session_reused: Boolean(existing),
      ready_to_book: false,
    }),
  };
}

async function askFromDecision(input: {
  decision: SchedulingDecision;
  properties: Array<{ id: string; address: string; city: string; state: string; zip: string; isPrimary: boolean }>;
  intake: SchedulingIntake;
  companyId: string;
  phone?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
  concern?: string | null;
  threadId: string;
  stateId: string;
  inboundMessageId?: string | null;
  previousIntent?: string | null;
  send: boolean;
  selected: { date: string; windowId: string; startMinutes: number; endMinutes: number } | null;
  offered: OfferedSlot[];
}) {
  let message = askNameMessage();
  let kind = "name";
  if (input.decision.action === "ask_name") {
    message = input.decision.afterSlot ? askNameBeforeFinishingSchedule() : askNameMessage();
    kind = input.decision.afterSlot ? "name_after_slot" : "name";
  } else if (input.decision.action === "ask_address") {
    message = input.intake.firstName ? thanksNameAskAddressMessage(input.intake.firstName) : "What's the address where you need service?";
    kind = "address";
  } else if (input.decision.action === "ask_property") {
    message = propertyQuestion(input.properties);
    kind = "property";
  } else if (input.decision.action === "ask_concern") {
    message = askServiceConcernMessage();
    kind = "concern";
  } else if (input.decision.action === "noop") {
    message = "Which of those openings works best for you?";
    kind = "which_slot";
  }

  const sms = await sendSessionSms({
    companyId: input.companyId,
    phone: input.phone,
    customerId: input.customerId,
    body: message,
    kind,
    previousIntent: input.previousIntent,
    send: input.send,
  });
  if (input.selected) {
    await persistSelectedSlot({
      companyId: input.companyId,
      threadId: input.threadId,
      stateId: input.stateId,
      date: input.selected.date,
      windowId: input.selected.windowId,
      customerId: input.customerId,
      propertyId: input.propertyId,
      intake: input.intake,
      missingField: kind === "name" || kind === "name_after_slot" ? "name" : kind === "address" ? "address" : kind === "property" ? "property" : "service",
      phase: input.decision.phase,
      lastIntent: sms.dedupe,
      offeredSlots: input.offered,
      customerConcern: input.concern,
      lastInboundMessageId: input.inboundMessageId,
    });
  } else {
    await persistSchedulingSession({
      companyId: input.companyId,
      threadId: input.threadId,
      stateId: input.stateId,
      phase: input.decision.phase,
      status: sessionStatusForPhase(input.decision.phase),
      customerId: input.customerId,
      propertyId: input.propertyId,
      customerConcern: input.concern,
      intake: input.intake,
      missingField: kind === "name" || kind === "name_after_slot" ? "name" : kind === "address" ? "address" : kind === "property" ? "property" : "service",
      lastIntent: sms.dedupe,
      lastInboundMessageId: input.inboundMessageId,
    });
  }
  return { message, smsSent: sms.sent };
}

async function refreshTakenSlot(input: {
  companyId: string;
  threadId: string;
  stateId: string;
  phone?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
  concern?: string | null;
  intake: SchedulingIntake;
  serviceType?: string | null;
  sendToCustomer: boolean;
  previousIntent?: string | null;
  inboundMessageId?: string | null;
}) {
  const check = await checkAvailabilityTool({
    companyId: input.companyId,
    body: {
      customer_phone: input.phone,
      service_type: input.serviceType,
      service_need: input.concern,
      service_address: input.intake.street,
      send_to_customer: false,
    },
  });
  const lines = slotLinesFromCheckBody(check.body);
  const slots = offeredFromCheckBody(check.body);
  const message = slotTakenOfferMessage(lines);
  if (slots.length) {
    await persistOfferedSlots({
      companyId: input.companyId,
      threadId: input.threadId,
      customerId: input.customerId,
      propertyId: input.propertyId,
      customerConcern: input.concern,
      intake: input.intake,
      slots,
      phase: "WAITING_FOR_SLOT_SELECTION",
      lastInboundMessageId: input.inboundMessageId,
    });
  }
  await sendSessionSms({
    companyId: input.companyId,
    phone: input.phone,
    customerId: input.customerId,
    body: message,
    kind: "slot_taken",
    previousIntent: input.previousIntent,
    send: input.sendToCustomer,
  });
  return {
    status: 409,
    customerId: input.customerId,
    propertyId: input.propertyId,
    body: toolError(
      "start_scheduling",
      "SLOT_NO_LONGER_AVAILABLE",
      "That window is no longer available.",
      {
        booking_confirmed: false,
        scheduling_phase: "WAITING_FOR_SLOT_SELECTION",
        customer_message: message,
        available_slots: asRecord(asRecord(check.body)?.data)?.available_slots ?? [],
      }
    ),
  };
}

export async function loadSchedulingIntegrationStatus(companyId: string) {
  const [activeSessions, lastCall, lastError] = await Promise.all([
    prisma.conversationSchedulingState.count({
      where: {
        companyId,
        status: { in: ["OPEN", "CLARIFYING", "SUGGESTED"] },
        bookedJobId: null,
        expiresAt: { gt: new Date() },
        OR: [{ lastAiAction: null }, { lastAiAction: { notIn: ["BOOKED", "HANDOFF", "CANCELLED"] } }],
      },
    }),
    prisma.agentToolCall.findFirst({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: { tool: true, success: true, errorCode: true, createdAt: true },
    }),
    prisma.agentToolCall.findFirst({
      where: { companyId, success: false },
      orderBy: { createdAt: "desc" },
      select: { tool: true, errorCode: true, createdAt: true },
    }),
  ]);
  return {
    orchestration: "ContractorYou" as const,
    activeSessions,
    lastActionAt: lastCall?.createdAt ?? null,
    lastActionTool: lastCall?.tool ?? null,
    lastActionOk: lastCall?.success ?? null,
    lastErrorAt: lastError?.createdAt ?? null,
    lastErrorCode: lastError?.errorCode ?? null,
  };
}
