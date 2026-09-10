import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifySchedulingInbound,
  decideSchedulingNextStep,
} from "@/lib/agent-tools/scheduling-session";
import {
  chooseResolvedThread,
  evaluateBookingReadiness,
  isTerminalSchedulingPhase,
  normalizeAgentToolBody,
  parseToolPersonName,
  parseToolServiceAddress,
  phoneLookupVariants,
  SCHEDULING_SESSION_PHASES,
  selectedSlotFromState,
} from "@/lib/agent-tools/booking-contract";
import { isActiveSchedulingSession } from "@/lib/agent-tools/persist-offers";
import { isPublicPath } from "@/lib/auth-session";
import { hasReliableCustomerName } from "@/lib/scheduling/conversation-identity";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";
import { resolveOfferedSlotSelection } from "@/lib/scheduling/conversation-turn";
import {
  askAddressAfterAckMessage,
  askNameBeforeFinishingSchedule,
  askNameMessage,
  askServiceConcernMessage,
  askWhichPropertyForServiceMessage,
  contractorYouBookingConfirmation,
  contractorYouOfferWindowsMessage,
  slotTakenOfferMessage,
  thanksNameAskAddressMessage,
} from "@/lib/scheduling/templates";

const productionOffers = [
  { date: "2026-09-15", windowId: "w9a", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-21", windowId: "w9b", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-22", windowId: "w9c", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-28", windowId: "w9d", startMinutes: 9 * 60, endMinutes: 11 * 60 },
];

describe("ContractorYou scheduling session architecture", () => {
  it("defines the required session phases and treats booked/handoff/cancelled as terminal", () => {
    expect(SCHEDULING_SESSION_PHASES).toEqual([
      "STARTED",
      "NEED_CUSTOMER_NAME",
      "NEED_PROPERTY",
      "NEED_SERVICE_CONTEXT",
      "CHECKING_AVAILABILITY",
      "SLOTS_OFFERED",
      "WAITING_FOR_SLOT_SELECTION",
      "SLOT_SELECTED",
      "READY_TO_BOOK",
      "BOOKING",
      "BOOKED",
      "HANDOFF",
      "CANCELLED",
    ]);
    expect(isTerminalSchedulingPhase("BOOKED")).toBe(true);
    expect(isTerminalSchedulingPhase("HANDOFF")).toBe(true);
    expect(isTerminalSchedulingPhase("CANCELLED")).toBe(true);
    expect(isTerminalSchedulingPhase("WAITING_FOR_SLOT_SELECTION")).toBe(false);
    expect(
      isActiveSchedulingSession({
        status: "SUGGESTED",
        lastAiAction: "WAITING_FOR_SLOT_SELECTION",
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).toBe(true);
    expect(
      isActiveSchedulingSession({
        status: "BOOKED",
        lastAiAction: "BOOKED",
        bookedJobId: "job_1",
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).toBe(false);
  });

  it("exposes one start-scheduling entry and keeps the old tools", () => {
    expect(isPublicPath("/api/agent-tools/start-scheduling")).toBe(true);
    expect(readFileSync(resolve("src/app/api/agent-tools/start-scheduling/route.ts"), "utf8")).toMatch(
      /startSchedulingTool/
    );
    expect(readFileSync(resolve("src/app/api/agent-tools/check-availability/route.ts"), "utf8")).toMatch(
      /checkAvailabilityTool/
    );
    expect(readFileSync(resolve("src/app/api/agent-tools/select-offered-slot/route.ts"), "utf8")).toMatch(
      /selectOfferedSlotTool/
    );
    expect(readFileSync(resolve("src/app/api/agent-tools/book-selected-slot/route.ts"), "utf8")).toMatch(
      /bookAppointmentTool/
    );
    expect(readFileSync(resolve("src/lib/agent-tools/envelope.ts"), "utf8")).toMatch(/start_scheduling/);
    expect(readFileSync(resolve("src/lib/agent-tools/audit.ts"), "utf8")).toMatch(/start_scheduling/);
  });

  it("routes inbound SMS to the session before receptionist or another scheduling flow", () => {
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(webhook.indexOf("processSchedulingSessionInbound")).toBeLessThan(
      webhook.indexOf("contractorYouMayAutoreply(conversationOwner)")
    );
    expect(webhook.indexOf("processSchedulingSessionInbound")).toBeLessThan(webhook.indexOf("processInboundReceptionist"));
    expect(webhook.indexOf("processSchedulingSessionInbound")).toBeLessThan(webhook.indexOf("processInboundScheduling"));
    expect(readFileSync(resolve("src/lib/agent-tools/hybrid-continue.ts"), "utf8")).toMatch(
      /processSchedulingSessionInbound/
    );
  });

  it("normalizes US phones and HighLevel concern aliases", () => {
    expect(canonicalizeUsPhone("+18653858079")).toBe("+18653858079");
    expect(canonicalizeUsPhone("8653858079")).toBe("+18653858079");
    expect(canonicalizeUsPhone("(865) 385-8079")).toBe("+18653858079");
    expect(phonesMatch("+18653858079", "8653858079")).toBe(true);
    expect(phoneLookupVariants("8653858079")).toContain("+18653858079");
    const body = normalizeAgentToolBody({
      phone: "(865) 385-8079",
      concern: "It's not cooling",
      send_to_customer: "true",
    });
    expect(body.customer_phone).toBe("(865) 385-8079");
    expect(body.service_need).toBe("It's not cooling");
    expect(body.send_to_customer).toBe(true);
  });

  it("does not guess when canonical thread resolution is ambiguous", () => {
    const now = new Date();
    const result = chooseResolvedThread(
      [
        { id: "t1", lastActivityAt: now, externalContactId: "a" },
        { id: "t2", lastActivityAt: now, externalContactId: "b" },
      ],
      null
    );
    expect(result).toEqual({ status: "ambiguous", count: 2 });
    expect(chooseResolvedThread([{ id: "t1", lastActivityAt: now, externalContactId: "ct" }], "ct")).toEqual({
      status: "resolved",
      thread: { id: "t1", lastActivityAt: now, externalContactId: "ct" },
    });
  });

  it("runs the production new-customer case: offer → Sep 15 → ask name → book", () => {
    const start = decideSchedulingNextStep({
      hasReliableName: false,
      propertyCount: 0,
      hasAddress: true,
      hasConcern: true,
      offeredCount: 0,
      selectedSlot: null,
    });
    expect(start).toEqual({ action: "offer_slots", phase: "CHECKING_AVAILABILITY" });

    expect(resolveOfferedSlotSelection("Tuesday September 15th", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[0],
    });
    expect(classifySchedulingInbound({
      text: "Tuesday September 15th",
      offered: productionOffers,
      selected: false,
      phase: "WAITING_FOR_SLOT_SELECTION",
    })).toBe("slot_match");

    const afterSelect = decideSchedulingNextStep({
      hasReliableName: false,
      propertyCount: 0,
      hasAddress: true,
      hasConcern: true,
      offeredCount: 4,
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
      inboundKind: "slot_match",
    });
    expect(afterSelect.action).toBe("select_slot");

    const needName = decideSchedulingNextStep({
      hasReliableName: false,
      propertyCount: 0,
      hasAddress: true,
      hasConcern: true,
      offeredCount: 4,
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
    });
    expect(needName).toEqual({ action: "ask_name", phase: "SLOT_SELECTED", afterSlot: true });
    expect(askNameBeforeFinishingSchedule()).toBe("Absolutely. Before I finish scheduling that, what's your name?");

    const selected = selectedSlotFromState({
      requestedDate: new Date("2026-09-15T00:00:00.000Z"),
      requestedWindowId: "w9a",
      offeredSlots: productionOffers,
    });
    expect(selected?.date).toBe("2026-09-15");
    expect(parseToolPersonName({ customer_reply: "TJ Hurst" })).toEqual({ firstName: "TJ", lastName: "Hurst" });

    const ready = decideSchedulingNextStep({
      hasReliableName: true,
      propertyCount: 0,
      hasAddress: true,
      hasConcern: true,
      offeredCount: 4,
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
    });
    expect(ready).toEqual({ action: "book", phase: "READY_TO_BOOK" });
    expect(
      evaluateBookingReadiness({
        intake: { firstName: "TJ", lastName: "Hurst", street: "8233 Tazewell Pike" },
        hasServiceContext: true,
        selectedSlot: { date: "2026-09-15", windowId: "w9a" },
      }).ready_to_book
    ).toBe(true);
    expect(contractorYouBookingConfirmation({
      appointmentDisplay: "Tuesday, September 15 from 9–11 AM",
      propertyAddress: "8233 Tazewell Pike",
    })).toBe("Perfect — you're scheduled for Tuesday, September 15 from 9–11 AM at 8233 Tazewell Pike.");
  });

  it("skips name and address for an existing customer with one property and a concern", () => {
    expect(
      decideSchedulingNextStep({
        hasReliableName: true,
        propertyCount: 1,
        propertyId: "prop_1",
        hasAddress: true,
        hasConcern: true,
        offeredCount: 0,
      })
    ).toEqual({ action: "offer_slots", phase: "CHECKING_AVAILABILITY" });
  });

  it("asks which property when the existing customer has more than one", () => {
    expect(
      decideSchedulingNextStep({
        hasReliableName: true,
        propertyCount: 2,
        propertyId: null,
        hasAddress: false,
        hasConcern: true,
        offeredCount: 0,
      })
    ).toEqual({ action: "ask_property", phase: "NEED_PROPERTY" });
    expect(askWhichPropertyForServiceMessage()).toBe("Which property do you need service at?");
  });

  it("asks for address when the existing customer has no property", () => {
    expect(
      decideSchedulingNextStep({
        hasReliableName: true,
        propertyCount: 0,
        hasAddress: false,
        hasConcern: true,
        offeredCount: 0,
      })
    ).toEqual({ action: "ask_address", phase: "NEED_PROPERTY" });
  });

  it("asks for name first when a new customer has no address", () => {
    expect(
      decideSchedulingNextStep({
        hasReliableName: false,
        propertyCount: 0,
        hasAddress: false,
        hasConcern: true,
        offeredCount: 0,
      })
    ).toEqual({ action: "ask_name", phase: "NEED_CUSTOMER_NAME", afterSlot: false });
    expect(askNameMessage().toLowerCase()).toMatch(/what.?s your name/);
    expect(thanksNameAskAddressMessage("TJ")).toBe("Thanks, TJ. What's the address where you need service?");
    expect(askAddressAfterAckMessage()).toBe("Great. What's the address where you need service?");
    expect(classifySchedulingInbound({ text: "Yes next steps please", offered: [], selected: false })).not.toBe("name");
    expect(hasReliableCustomerName("Yes")).toBe(false);
  });

  it("asks for the service concern when it was not already supplied", () => {
    expect(
      decideSchedulingNextStep({
        hasReliableName: true,
        propertyCount: 1,
        propertyId: "prop_1",
        hasAddress: true,
        hasConcern: false,
        offeredCount: 0,
      })
    ).toEqual({ action: "ask_concern", phase: "NEED_SERVICE_CONTEXT" });
    expect(askServiceConcernMessage()).toBe("What's going on with the system?");
  });

  it("resolves natural, ordinal, and ambiguous slot replies against persisted offers only", () => {
    expect(resolveOfferedSlotSelection("Tuesday September 15th", productionOffers).kind).toBe("match");
    expect(resolveOfferedSlotSelection("the first one", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[0],
    });
    expect(resolveOfferedSlotSelection("second option", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[1],
    });
    expect(resolveOfferedSlotSelection("9-11", productionOffers).kind).toBe("ambiguous");
    expect(resolveOfferedSlotSelection("Tuesday morning", productionOffers).kind).toBe("ambiguous");
    expect(resolveOfferedSlotSelection("Friday night", productionOffers)).toEqual({ kind: "none" });
    expect(
      decideSchedulingNextStep({
        hasReliableName: false,
        propertyCount: 0,
        hasAddress: true,
        hasConcern: true,
        offeredCount: 4,
        phase: "WAITING_FOR_SLOT_SELECTION",
        inboundKind: "slot_ambiguous",
      }).action
    ).toBe("clarify_slots");
    expect(
      decideSchedulingNextStep({
        hasReliableName: false,
        propertyCount: 0,
        hasAddress: true,
        hasConcern: true,
        offeredCount: 4,
        phase: "WAITING_FOR_SLOT_SELECTION",
        inboundKind: "slot_none",
      }).action
    ).toBe("unmatched_slot");
  });

  it("cancels or hands off without inventing a booking", () => {
    expect(
      decideSchedulingNextStep({
        hasReliableName: false,
        propertyCount: 0,
        hasAddress: true,
        hasConcern: true,
        offeredCount: 4,
        inboundKind: "decline",
      })
    ).toEqual({ action: "cancel", phase: "CANCELLED" });
    expect(
      decideSchedulingNextStep({
        hasReliableName: true,
        propertyCount: 1,
        propertyId: "p1",
        hasAddress: true,
        hasConcern: true,
        offeredCount: 4,
        inboundKind: "handoff",
      })
    ).toEqual({ action: "handoff", phase: "HANDOFF" });
    expect(classifySchedulingInbound({ text: "never mind", offered: productionOffers, selected: false })).toBe(
      "decline"
    );
    expect(classifySchedulingInbound({ text: "can I talk to a person", offered: [], selected: false })).toBe("handoff");
  });

  it("keeps a selected slot while missing name and does not treat that as booked", () => {
    const readiness = evaluateBookingReadiness({
      intake: parseToolServiceAddress("8233 Tazewell Pike") ?? {},
      hasServiceContext: true,
      offeredCount: 4,
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
    });
    expect(readiness.ready_to_book).toBe(false);
    expect(readiness.requires_customer_name).toBe(true);
    expect(readiness.booking_confirmed).toBe(false);
    expect(readiness.phase).toBe("SLOT_SELECTED");
  });

  it("uses ContractorYou-owned offer and slot-taken copy", () => {
    expect(
      contractorYouOfferWindowsMessage([
        "Tuesday, September 15 from 9–11 AM",
        "Monday, September 21 from 9–11 AM",
        "Tuesday, September 22 from 9–11 AM",
      ])
    ).toContain("I have these appointment windows available:");
    expect(slotTakenOfferMessage(["Monday, September 21 from 9–11 AM"])).toContain(
      "That appointment was just taken, but I have these openings available"
    );
  });

  it("protects start, inbound, booking, and confirmation against duplicates", () => {
    const session = readFileSync(resolve("src/lib/agent-tools/scheduling-session.ts"), "utf8");
    expect(session).toMatch(/session_reused/);
    expect(session).toMatch(/lastInboundMessageId === input.messageId/);
    expect(session).toMatch(/P2002/);
    expect(session).toMatch(/duplicate_sms/);
    expect(session).toMatch(/SLOT_NO_LONGER_AVAILABLE/);
    expect(session).toMatch(/checkAvailabilityTool/);
    expect(session).toMatch(/bookAppointmentTool/);
    const book = readFileSync(resolve("src/lib/agent-tools/book-appointment.ts"), "utf8");
    expect(book).toMatch(/idempotencyKey/);
    expect(book).toMatch(/duplicate_confirmation/);
    expect(book).toMatch(/confirmationStatus === "SENT"/);
    expect(readFileSync(resolve("src/lib/agent-tools/select-slot.ts"), "utf8")).toMatch(/readiness.ready_to_book/);
  });

  it("shows compact HighLevel scheduling diagnostics and documents Regina ownership limits", () => {
    const settings = readFileSync(resolve("src/components/highlevel/agent-tool-settings.tsx"), "utf8");
    expect(settings).toMatch(/Scheduling orchestration/);
    expect(settings).toMatch(/Active scheduling sessions/);
    expect(settings).toMatch(/Last scheduling action/);
    expect(settings).toMatch(/Last scheduling error/);
    const docs = readFileSync(resolve("docs/HIGHLEVEL_AGENT_STUDIO.md"), "utf8");
    expect(docs).toMatch(/cannot dynamically pause HighLevel Conversation AI/);
    expect(docs).toMatch(/start-scheduling/);
    expect(docs).toMatch(/Do not tell the customer they are booked/);
    expect(docs).not.toMatch(/ghp_/);
  });
});
