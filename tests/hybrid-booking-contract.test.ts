import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ASK_NAME_THEN_BOOK,
  DO_NOT_CLAIM_BOOKED,
  DO_NOT_DUPLICATE_CONFIRMATION,
  agentInstructionForReadiness,
  blockedBookingPayload,
  chooseResolvedThread,
  coerceToolBoolean,
  evaluateBookingReadiness,
  isBookingActuallyConfirmed,
  mergeSchedulingIntake,
  normalizeAgentToolBody,
  parseToolPersonName,
  parseToolServiceAddress,
  phoneLookupVariants,
  selectedSlotFromState,
} from "@/lib/agent-tools/booking-contract";
import { shouldContinueHybridInbound } from "@/lib/agent-tools/hybrid-continue";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import { bookingStudioFields } from "@/lib/agent-tools/studio-fields";
import {
  hasReliableCustomerName,
  parsePersonName,
  parseServiceAddress,
} from "@/lib/scheduling/conversation-identity";
import { resolveOfferedSlotSelection } from "@/lib/scheduling/conversation-turn";
import { askNameBeforeFinishingSchedule, contractorYouBookingConfirmation } from "@/lib/scheduling/templates";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";

const productionOffers = [
  { date: "2026-09-15", windowId: "w9a", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-21", windowId: "w9b", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-22", windowId: "w9c", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-28", windowId: "w9d", startMinutes: 9 * 60, endMinutes: 11 * 60 },
];

describe("production SMS identity and slot contract", () => {
  it("canonicalizes the live inbound phone", () => {
    expect(canonicalizeUsPhone("+18653858079")).toBe("+18653858079");
    expect(canonicalizeUsPhone("8653858079")).toBe("+18653858079");
    expect(canonicalizeUsPhone("(865) 385-8079")).toBe("+18653858079");
    expect(phonesMatch("+18653858079", "8653858079")).toBe(true);
    expect(phoneLookupVariants("(865) 385-8079")).toContain("+18653858079");
    expect(phoneLookupVariants("8653858079")).toContain("8653858079");
  });

  it("matches Tuesday September 15th to the stored Sep 15 window only", () => {
    const result = resolveOfferedSlotSelection("Tuesday September 15th", productionOffers);
    expect(result).toEqual({ kind: "match", slot: productionOffers[0] });
  });

  it("asks for name and does not confirm when the customer is new", () => {
    const selected = selectedSlotFromState({
      requestedDate: new Date("2026-09-15T00:00:00.000Z"),
      requestedWindowId: "w9a",
      offeredSlots: productionOffers,
    });
    expect(selected).toEqual({
      date: "2026-09-15",
      windowId: "w9a",
      startMinutes: 9 * 60,
      endMinutes: 11 * 60,
    });
    const readiness = evaluateBookingReadiness({
      customerId: null,
      intake: parseToolServiceAddress("8233 Tazewell Pike") ?? {},
      hasServiceContext: true,
      offeredCount: 4,
      selectedSlot: selected,
    });
    expect(readiness.phase).toBe("SLOT_SELECTED");
    expect(readiness.ready_to_book).toBe(false);
    expect(readiness.requires_customer_name).toBe(true);
    expect(readiness.booking_confirmed).toBe(false);
    const payload = blockedBookingPayload({
      readiness,
      customer_message: askNameBeforeFinishingSchedule(),
      error_code: "CUSTOMER_NAME_REQUIRED",
      slot_selected: true,
      match_status: "exact",
      appointment_display: "Tuesday, September 15 from 9–11 AM",
    });
    const body = toolOk("select_offered_slot", payload, { instruction: ASK_NAME_THEN_BOOK });
    expect(body.success).toBe(true);
    expect(body.booking_confirmed).toBe(false);
    expect(body.slot_selected).toBe(true);
    expect(body.ready_to_book).toBe(false);
    expect(body.requires_customer_name).toBe(true);
    expect(body.job_id).toBeNull();
    expect(body.booking_id).toBeNull();
    expect(body.customer_message).toBe("Absolutely. Before I finish scheduling that, what's your name?");
    expect(body.agent_instruction).toMatch(/Do not tell the customer they are booked|Ask only for the customer's name/i);
  });

  it("books only after name + address + selected slot are present", () => {
    const name = parsePersonName("TJ Hurst");
    expect(name).toEqual({ firstName: "TJ", lastName: "Hurst" });
    const intake = mergeSchedulingIntake(parseToolServiceAddress("8233 Tazewell Pike") ?? {}, {
      firstName: name!.firstName,
      lastName: name!.lastName,
    });
    const readiness = evaluateBookingReadiness({
      intake,
      hasServiceContext: true,
      offeredCount: 4,
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
    });
    expect(readiness.phase).toBe("READY_TO_BOOK");
    expect(readiness.ready_to_book).toBe(true);
    expect(readiness.requires_customer_name).toBe(false);
    expect(readiness.requires_service_address).toBe(false);
    expect(
      contractorYouBookingConfirmation({
        appointmentDisplay: "Tuesday, September 15 from 9–11 AM",
        propertyAddress: "8233 Tazewell Pike",
      })
    ).toBe("Perfect — you're scheduled for Tuesday, September 15 from 9–11 AM at 8233 Tazewell Pike.");
  });

  it("reuses an existing customer recognized by phone and does not ask for their name", () => {
    expect(hasReliableCustomerName("JR", "Day")).toBe(true);
    const readiness = evaluateBookingReadiness({
      customerId: "cus_existing",
      customerFirstName: "JR",
      customerLastName: "Day",
      propertyId: "prop_1",
      propertyAddress: "8233 Tazewell Pike",
      propertyCount: 1,
      hasServiceContext: true,
      offeredCount: 4,
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
    });
    expect(readiness.requires_customer_name).toBe(false);
    expect(readiness.ready_to_book).toBe(true);
    expect(readiness.phase).toBe("READY_TO_BOOK");
  });

  it("asks for address when a new customer has a name but no property", () => {
    const readiness = evaluateBookingReadiness({
      intake: { firstName: "TJ", lastName: "Hurst" },
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
      hasServiceContext: true,
    });
    expect(readiness.requires_service_address).toBe(true);
    expect(readiness.ready_to_book).toBe(false);
    expect(readiness.phase).toBe("SLOT_SELECTED");
  });

  it("asks which property when an existing customer has more than one", () => {
    const readiness = evaluateBookingReadiness({
      customerId: "cus_1",
      customerFirstName: "JR",
      propertyCount: 2,
      selectedSlot: { date: "2026-09-15", windowId: "w9a" },
      hasServiceContext: true,
    });
    expect(readiness.requires_property_selection).toBe(true);
    expect(readiness.ready_to_book).toBe(false);
    expect(readiness.property_id).toBeNull();
  });

  it("keeps the selected slot while collecting a missing name or address", () => {
    const selected = { date: "2026-09-15", windowId: "w9a" };
    const missingName = evaluateBookingReadiness({
      intake: parseToolServiceAddress("8233 Tazewell Pike") ?? {},
      selectedSlot: selected,
      hasServiceContext: true,
    });
    const missingAddress = evaluateBookingReadiness({
      intake: { firstName: "TJ", lastName: "Hurst" },
      selectedSlot: selected,
      hasServiceContext: true,
    });
    expect(missingName.phase).toBe("SLOT_SELECTED");
    expect(missingAddress.phase).toBe("SLOT_SELECTED");
    expect(selectedSlotFromState({ requestedDate: "2026-09-15", requestedWindowId: "w9a", offeredSlots: productionOffers })?.date).toBe(
      "2026-09-15"
    );
  });
});

describe("booking_confirmed contract", () => {
  it("never treats success or a display string as a booking", () => {
    expect(
      isBookingActuallyConfirmed({
        booking_confirmed: false,
        job_id: null,
        booking_id: null,
      })
    ).toBe(false);
    expect(
      isBookingActuallyConfirmed({
        booking_confirmed: true,
        job_id: "job_1",
        booking_id: null,
      })
    ).toBe(false);
    expect(
      isBookingActuallyConfirmed({
        booking_confirmed: true,
        job_id: "job_1",
        booking_id: "bk_1",
        error_code: "CUSTOMER_NAME_REQUIRED",
      })
    ).toBe(false);
    const ok = toolOk("book_appointment", {
      booking_confirmed: false,
      booking_id: null,
      job_id: null,
      appointment_display: "Tuesday, September 15 from 9–11 AM",
      customer_message: askNameBeforeFinishingSchedule(),
    });
    expect(ok.success).toBe(true);
    expect(ok.booking_confirmed).toBe(false);
    expect(ok.appointment_display).toBe("Tuesday, September 15 from 9–11 AM");
    expect(ok.job_id).toBeNull();
  });

  it("requires persisted Job + SchedulingBooking before booking_confirmed is true", () => {
    const body = toolOk("book_appointment", {
      booking_confirmed: true,
      booking_id: "bk_1",
      job_id: "job_1",
      job_number: "865-1001",
      appointment_display: "Tuesday, September 15 from 9–11 AM",
      customer_id: "cus_tj",
      customer_first_name: "TJ",
      property_id: "prop_1",
      property_address: "8233 Tazewell Pike",
      customer_message: "Perfect — you're scheduled for Tuesday, September 15 from 9–11 AM at 8233 Tazewell Pike.",
      agent_instruction: DO_NOT_DUPLICATE_CONFIRMATION,
    });
    expect(body.booking_confirmed).toBe(true);
    expect(body.booking_id).toBe("bk_1");
    expect(body.job_id).toBe("job_1");
    expect(body.agent_instruction).toBe(DO_NOT_DUPLICATE_CONFIRMATION);
    expect(bookingStudioFields({ booking: { booking_id: "bk_1", job_id: "job_1" }, booking_confirmed: false }).booking_confirmed).toBe(
      false
    );
  });

  it("flattens a failed book without a confirmation instruction", () => {
    const body = toolError("book_appointment", "BOOKING_TRANSACTION_FAILED", "The booking transaction did not complete.", {
      booking_confirmed: false,
      job_id: null,
      booking_id: null,
    });
    expect(body.success).toBe(false);
    expect(body.booking_confirmed).toBe(false);
    expect(body.agent_instruction).not.toMatch(/appointment is confirmed/i);
    expect(body.agent_instruction).toMatch(/Do not tell the customer they are booked|could not be booked/i);
  });
});

describe("canonical thread resolution", () => {
  it("resolves one HighLevel thread by phone or contact_id", () => {
    const now = new Date("2026-09-08T21:03:00.000Z");
    const thread = { id: "th_1", lastActivityAt: now, externalContactId: "ct_1" };
    expect(chooseResolvedThread([thread], "ct_1")).toEqual({ status: "resolved", thread });
    expect(chooseResolvedThread([thread], null)).toEqual({ status: "resolved", thread });
  });

  it("does not guess when two recent conversations are active", () => {
    const recent = new Date("2026-09-08T21:03:00.000Z");
    const a = { id: "th_a", lastActivityAt: recent, externalContactId: "ct_a" };
    const b = { id: "th_b", lastActivityAt: new Date(recent.getTime() - 60_000), externalContactId: "ct_b" };
    expect(chooseResolvedThread([a, b], null).status).toBe("ambiguous");
  });

  it("uses the only recently active thread when older ones exist", () => {
    const recent = new Date();
    const stale = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const live = { id: "th_live", lastActivityAt: recent, externalContactId: "ct_1" };
    const old = { id: "th_old", lastActivityAt: stale, externalContactId: "ct_1" };
    expect(chooseResolvedThread([live, old], "ct_1")).toEqual({ status: "resolved", thread: live });
  });
});

describe("hybrid booking source files", () => {
  it("keeps confirmation behind a verified Job + SchedulingBooking", () => {
    const book = readFileSync(resolve("src/lib/agent-tools/book-appointment.ts"), "utf8");
    const select = readFileSync(resolve("src/lib/agent-tools/select-slot.ts"), "utf8");
    const send = readFileSync(resolve("src/lib/agent-tools/send-result.ts"), "utf8");
    expect(book).toMatch(/booking_confirmed: true/);
    expect(book).toMatch(/schedulingBooking/);
    expect(book).toMatch(/assignments/);
    expect(book).toMatch(/sendConfirmation: false/);
    expect(book).toMatch(/CUSTOMER_NAME_REQUIRED/);
    expect(book).toMatch(/askNameBeforeFinishingSchedule/);
    expect(book).toMatch(/contractorYouBookingConfirmation/);
    expect(book).not.toMatch(/I've got you scheduled/);
    expect(select).toMatch(/requires_customer_name/);
    expect(select).toMatch(/ready_to_book/);
    expect(select).toMatch(/askNameBeforeFinishingSchedule/);
    expect(select).toMatch(/blockedBookingPayload/);
    expect(readFileSync(resolve("src/lib/agent-tools/booking-contract.ts"), "utf8")).toMatch(
      /booking_confirmed: false as const/
    );
    expect(select).not.toMatch(/I've got you scheduled/);
    expect(send).toMatch(/CONTRACTORYOU_ACTION_RESULT/);
    expect(agentInstructionForReadiness(evaluateBookingReadiness({ selectedSlot: { date: "2026-09-15", windowId: "w9a" } }), false)).toBe(
      ASK_NAME_THEN_BOOK
    );
    expect(DO_NOT_CLAIM_BOOKED).toMatch(/Do not tell the customer they are booked/);
  });

  it("documents the HighLevel hybrid safety contract", () => {
    const docs = readFileSync(resolve("docs/HIGHLEVEL_AGENT_STUDIO.md"), "utf8");
    expect(docs).toMatch(/booking_confirmed/);
    expect(docs).toMatch(/Do not tell the customer they are booked/);
    expect(docs).toMatch(/Do not send a duplicate confirmation/);
    expect(docs).toMatch(/I’ve got you scheduled/);
    expect(docs).toMatch(/Book Selected Slot/);
    expect(docs).toMatch(/HIGHLEVEL_AI/);
    expect(docs).not.toMatch(/ghp_/);
    expect(docs).not.toMatch(/cyat_[A-Za-z0-9_-]{20,}/);
  });

  it("covers retry, expiry, and dispatch-verify failure handling", () => {
    const book = readFileSync(resolve("src/lib/agent-tools/book-appointment.ts"), "utf8");
    expect(book).toMatch(/idempotencyKey/);
    expect(book).toMatch(/booked\.duplicate/);
    expect(book).toMatch(/SLOT_EXPIRED/);
    expect(book).toMatch(/BOOKING_TRANSACTION_FAILED/);
    expect(book).toMatch(/DISPATCH_VERIFY_FAILED/);
    expect(book).toMatch(/BOOKING_VERIFY_FAILED/);
    expect(book).toMatch(/confirmationStatus === "SENT"/);
    expect(book).toMatch(/duplicate_confirmation/);
    const persist = readFileSync(resolve("src/lib/agent-tools/persist-offers.ts"), "utf8");
    expect(persist).toMatch(/contactId/);
    expect(persist).toMatch(/phoneLookupVariants/);
    expect(persist).toMatch(/chooseResolvedThread/);
    expect(persist).toMatch(/status === "BOOKED"/);
  });

  it("coerces HighLevel string variables so Select does not 400", () => {
    expect(coerceToolBoolean("true")).toBe(true);
    expect(coerceToolBoolean("True")).toBe(true);
    expect(coerceToolBoolean("false")).toBe(false);
    const body = normalizeAgentToolBody({
      phone: "+18653858079",
      contactId: "ct_1",
      reply: "Tuesday September 15th",
      send_to_customer: "true",
      address: "8233 Tazewell Pike",
    });
    expect(body.customer_phone).toBe("+18653858079");
    expect(body.contact_id).toBe("ct_1");
    expect(body.customer_reply).toBe("Tuesday September 15th");
    expect(body.send_to_customer).toBe(true);
    expect(body.service_address).toBe("8233 Tazewell Pike");
  });

  it("continues the selected Sep 15 slot when the customer later texts TJ Hurst", () => {
    expect(
      shouldContinueHybridInbound({
        text: "Tuesday September 15th",
        offeredCount: 4,
        matchKind: "match",
        selected: false,
        looksLikeName: false,
        looksLikeAddress: false,
      })
    ).toBe(true);
    expect(
      shouldContinueHybridInbound({
        text: "TJ Hurst",
        offeredCount: 4,
        matchKind: "none",
        selected: true,
        looksLikeName: true,
        looksLikeAddress: false,
        missingField: "name",
      })
    ).toBe(true);
    expect(
      shouldContinueHybridInbound({
        text: "hello",
        offeredCount: 4,
        matchKind: "none",
        selected: false,
        looksLikeName: false,
        looksLikeAddress: false,
      })
    ).toBe(false);
  });

  it("keeps HIGHLEVEL_AI inbound continuation without turning Regina into the booker", () => {
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(webhook).toMatch(/continueHybridSchedulingFromInbound/);
    expect(webhook).toMatch(/highLevelOwnsConversation/);
    expect(readFileSync(resolve("src/lib/agent-tools/http.ts"), "utf8")).toMatch(/normalizeAgentToolBody/);
    expect(readFileSync(resolve("src/lib/agent-tools/select-slot.ts"), "utf8")).toMatch(/sendSelectSms/);
    expect(readFileSync(resolve("src/lib/agent-tools/select-slot.ts"), "utf8")).toMatch(/logHybridAction/);
    expect(readFileSync(resolve("src/app/api/health/route.ts"), "utf8")).toMatch(/RAILWAY_GIT_COMMIT_SHA/);
  });

  it("accepts the production street-only address", () => {
    expect(parseServiceAddress("8233 Tazewell Pike")).toEqual({
      street: "8233 Tazewell Pike",
      city: "",
      state: "",
      zip: "",
    });
    expect(parseToolPersonName({ customer_reply: "TJ Hurst" })).toEqual({ firstName: "TJ", lastName: "Hurst" });
  });
});
