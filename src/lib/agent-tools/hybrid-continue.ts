import { selectOfferedSlotTool } from "@/lib/agent-tools/select-slot";
import { logHybridAction, parseToolServiceAddress } from "@/lib/agent-tools/booking-contract";
import { loadActiveSchedulingState, markSchedulingInbound, persistOfferedSlots } from "@/lib/agent-tools/persist-offers";
import { parseIntake, parsePersonName, parseServiceAddress } from "@/lib/scheduling/conversation-identity";
import { ACTIVE_SCHEDULING_STATUSES, parseOfferedSlots, resolveOfferedSlotSelection } from "@/lib/scheduling/conversation-turn";
import { selectedSlotFromState, mergeSchedulingIntake } from "@/lib/agent-tools/booking-contract";

export function shouldContinueHybridInbound(input: {
  text: string;
  offeredCount: number;
  matchKind: "match" | "ambiguous" | "none";
  selected: boolean;
  looksLikeName: boolean;
  looksLikeAddress: boolean;
  missingField?: string | null;
}) {
  if (input.matchKind === "match" || input.matchKind === "ambiguous") return true;
  if (input.selected && (input.looksLikeName || input.looksLikeAddress)) return true;
  if (input.selected && (input.missingField === "name" || input.missingField === "address" || input.missingField === "property")) {
    return input.looksLikeName || input.looksLikeAddress;
  }
  return false;
}

export async function continueHybridSchedulingFromInbound(input: {
  companyId: string;
  threadId: string;
  messageId: string;
  phone?: string | null;
  contactId?: string | null;
  body?: string | null;
}) {
  const text = input.body?.trim() || "";
  if (!text) return { handled: false as const, reason: "empty" };
  const state = await loadActiveSchedulingState(input.companyId, input.threadId);
  if (!state) return { handled: false as const, reason: "no_state" };
  if (state.status === "BOOKED") return { handled: false as const, reason: "already_booked" };
  if (!(ACTIVE_SCHEDULING_STATUSES as readonly string[]).includes(state.status)) {
    return { handled: false as const, reason: "inactive" };
  }
  if (state.expiresAt.getTime() < Date.now()) return { handled: false as const, reason: "expired" };
  if (state.lastInboundMessageId === input.messageId) return { handled: false as const, reason: "duplicate" };

  const offered = parseOfferedSlots(state.offeredSlots);
  const selected = selectedSlotFromState({
    requestedDate: state.requestedDate,
    requestedWindowId: state.requestedWindowId,
    offeredSlots: offered,
  });
  const address = parseServiceAddress(text) || parseToolServiceAddress(text);
  const name = parsePersonName(text);
  const selection = offered.length ? resolveOfferedSlotSelection(text, offered) : { kind: "none" as const };

  if (address && !selected && selection.kind !== "match") {
    await persistOfferedSlots({
      companyId: input.companyId,
      threadId: input.threadId,
      customerId: state.customerId,
      propertyId: state.propertyId,
      serviceTypeId: state.serviceTypeId,
      customerConcern: state.customerConcern,
      intake: mergeSchedulingIntake(parseIntake(state.intake), address),
      slots: offered,
      phase: state.lastAiAction || "SLOTS_OFFERED",
      lastInboundMessageId: input.messageId,
    });
    logHybridAction({
      action: "MISSING_INFO",
      companyId: input.companyId,
      phase: "NEED_PROPERTY",
      source: "inbound_continue",
      smsSent: false,
      smsSkipReason: "address_stored_only",
    });
    return { handled: true as const, reason: "address_stored" };
  }

  const shouldContinue = shouldContinueHybridInbound({
    text,
    offeredCount: offered.length,
    matchKind: selection.kind,
    selected: Boolean(selected),
    looksLikeName: Boolean(name),
    looksLikeAddress: Boolean(address),
    missingField: state.missingField,
  });
  if (!shouldContinue) {
    logHybridAction({
      action: "SELECT",
      companyId: input.companyId,
      matchStatus: selection.kind,
      source: "inbound_continue",
      smsSent: false,
      smsSkipReason: "not_a_scheduling_continuation",
    });
    return { handled: false as const, reason: "not_continuation" };
  }

  await markSchedulingInbound(input.companyId, input.threadId, input.messageId);
  const result = await selectOfferedSlotTool({
    companyId: input.companyId,
    body: {
      customer_phone: input.phone,
      contact_id: input.contactId,
      customer_reply: text,
      service_address: address?.street ?? parseIntake(state.intake).street,
      service_need: state.customerConcern,
      send_to_customer: true,
    },
    source: "inbound_continue",
  });
  logHybridAction({
    action: result.body && "booking_confirmed" in result.body && result.body.booking_confirmed ? "BOOK" : "SELECT",
    companyId: input.companyId,
    matchStatus: typeof result.body === "object" && result.body && "match_status" in result.body ? String(result.body.match_status) : selection.kind,
    bookingConfirmed: Boolean(result.body && "booking_confirmed" in result.body && result.body.booking_confirmed),
    readyToBook: Boolean(result.body && "ready_to_book" in result.body && result.body.ready_to_book),
    requiresCustomerName: Boolean(result.body && "requires_customer_name" in result.body && result.body.requires_customer_name),
    source: "inbound_continue",
    errorCode: result.body && "error" in result.body && result.body.error && typeof result.body.error === "object" && result.body.error && "code" in result.body.error
      ? String((result.body.error as { code?: string }).code)
      : null,
  });
  return { handled: true as const, reason: "select_continued", status: result.status };
}
