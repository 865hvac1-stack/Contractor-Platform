import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { interpretSchedulingIntent, mergeSchedulingIntent } from "@/lib/scheduling/intent";
import {
  isAvailabilityQuestion,
  matchOfferedSlot,
  ownsSchedulingInbound,
  resolveSchedulingTurn,
  uniqueWindowOffers,
} from "@/lib/scheduling/conversation-turn";
import { clarificationMessage, noOpenWindowsMessage, offerSlotsMessage } from "@/lib/scheduling/templates";
import { evaluateCapacity } from "@/lib/scheduling/capacity-engine";
import { DEFAULT_POLICY } from "@/lib/scheduling/types";
import { conversationCanAutoBook } from "@/lib/scheduling/auto-book";

const now = new Date("2026-09-08T16:00:00.000Z");
const windows = [
  { id: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60, active: true },
  { id: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60, active: true },
  { id: "w13", startMinutes: 13 * 60, endMinutes: 15 * 60, active: true },
  { id: "w15", startMinutes: 15 * 60, endMinutes: 17 * 60, active: true },
];

function engineOptions() {
  const result = evaluateCapacity(
    {
      timeZone: "America/New_York",
      policy: { ...DEFAULT_POLICY, allowSameDay: true, minNoticeMinutes: 0 },
      windows: windows.map((window) => ({ ...window, name: window.id, daypart: "ANY" as const })),
      technicians: [{ id: "tj", name: "TJ Hurst", active: true }],
      weekly: windows.flatMap((window) => [
        { userId: "tj", windowId: window.id, weekday: 2, available: true, capacity: 1 },
        { userId: "tj", windowId: window.id, weekday: 3, available: true, capacity: 1 },
      ]),
      overrides: [],
      eligibility: [{ userId: "tj", serviceTypeId: "residential-service", eligible: true }],
      bookings: [],
      now,
    },
    { companyId: "865", date: "2026-09-08" }
  );
  return uniqueWindowOffers(
    result.options.map((option) => ({
      date: option.date,
      windowId: option.windowId,
      startMinutes: option.startMinutes,
      endMinutes: option.endMinutes,
      remainingCapacity: option.remainingCapacity,
    }))
  );
}

describe("production scheduling handoff regression", () => {
  it("starts a scheduling session from the real first customer text", () => {
    const intent = interpretSchedulingIntent({
      text: "I am trying to schedule a service call",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(intent.requestedDaypart).toBeNull();
    expect(intent.missingField).toBe("date");
    expect(ownsSchedulingInbound({ activeState: null, intent })).toBe("scheduling");
    expect(
      resolveSchedulingTurn({
        previous: null,
        intent,
        canAutoBook: true,
        todayKey: "2026-09-08",
        todaySlots: engineOptions(),
        requestedSlots: [],
        nextSlots: engineOptions(),
      })
    ).toEqual({ action: "ask", missing: "date" });
    expect(clarificationMessage({ policy: DEFAULT_POLICY, missing: "date" })).toBe(
      "Happy to get you on the calendar. What day works best?"
    );
  });

  it("does not repeat What day works best after an availability question", () => {
    const first = interpretSchedulingIntent({
      text: "I am trying to schedule a service call",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(first.missingField).toBe("date");
    const phrases = [
      "When do you have available?",
      "What days do you have available",
      "What day do you have available?",
      "What's your next opening?",
      "When can someone come?",
      "What do you have this week?",
    ];
    const nextSlots = [
      { date: "2026-09-09", windowId: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60 },
      { date: "2026-09-10", windowId: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 },
      { date: "2026-09-10", windowId: "w13", startMinutes: 13 * 60, endMinutes: 15 * 60 },
    ];
    for (const text of phrases) {
      const fresh = interpretSchedulingIntent({ text, timeZone: "America/New_York", now, windows });
      const merged = mergeSchedulingIntent(first, fresh);
      expect(isAvailabilityQuestion(text), text).toBe(true);
      expect(merged.availabilitySearchRequested || merged.availabilityAsk, text).toBe(true);
      expect(merged.missingField, text).not.toBe("date");
      const turn = resolveSchedulingTurn({
        previous: { status: "CLARIFYING", paused: false, missingField: "date" },
        intent: merged,
        text,
        canAutoBook: true,
        todayKey: "2026-09-08",
        todaySlots: [],
        requestedSlots: [],
        nextSlots,
      });
      expect(turn.action, text).toBe("offer_slots");
      if (turn.action === "offer_slots") {
        expect(turn.slots).toEqual(nextSlots);
        const reply = offerSlotsMessage({
          slots: turn.slots.map((slot) => ({
            dateKey: slot.date,
            startMinutes: slot.startMinutes,
            endMinutes: slot.endMinutes,
            timeZone: "America/New_York",
          })),
          todayKey: "2026-09-08",
          todayWasFull: true,
        });
        expect(reply, text).not.toMatch(/What day works best/i);
        expect(reply, text).toMatch(/Which works/);
      }
    }
  });

  it("books the first offered slot after The first one", () => {
    const offered = [
      { date: "2026-09-09", windowId: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60 },
      { date: "2026-09-10", windowId: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 },
    ];
    expect(matchOfferedSlot("The first one", offered)).toEqual(offered[0]);
    const turn = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false, missingField: "slot_selection" },
      intent: { confidence: "low", missingField: null },
      text: "The first one",
      offeredSlots: offered,
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots: [],
      requestedSlots: offered,
      nextSlots: offered,
    });
    expect(turn).toEqual({ action: "book", date: "2026-09-09", windowId: "w11" });
  });

  it("hands off instead of re-asking when no real availability exists", () => {
    const first = interpretSchedulingIntent({
      text: "I am trying to schedule a service call",
      timeZone: "America/New_York",
      now,
      windows,
    });
    const fresh = interpretSchedulingIntent({
      text: "When do you have available?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    const turn = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false, missingField: "date" },
      intent: mergeSchedulingIntent(first, fresh),
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots: [],
      requestedSlots: [],
      nextSlots: [],
    });
    expect(turn).toEqual({ action: "handoff", reason: "no_availability" });
    expect(noOpenWindowsMessage()).toMatch(/office help with scheduling/);
    expect(noOpenWindowsMessage()).not.toMatch(/What day works best/);
  });

  it("keeps the active session and offers real slots for When do you have available?", () => {
    const first = interpretSchedulingIntent({
      text: "I am trying to schedule a service call",
      timeZone: "America/New_York",
      now,
      windows,
    });
    const followUp = interpretSchedulingIntent({
      text: "When do you have available?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(isAvailabilityQuestion("When do you have available?")).toBe(true);
    expect(followUp.availabilityAsk).toBe(true);
    expect(followUp.confidence).toBe("high");
    const merged = mergeSchedulingIntent(first, followUp);
    const active = {
      status: "CLARIFYING",
      paused: false,
      expiresAt: new Date("2026-09-15T00:00:00.000Z"),
    };
    expect(ownsSchedulingInbound({ activeState: active, intent: followUp, now })).toBe("scheduling");
    const todaySlots = engineOptions();
    expect(todaySlots.length).toBeGreaterThan(0);
    const turn = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false },
      intent: merged,
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots,
      requestedSlots: todaySlots,
      nextSlots: todaySlots,
    });
    expect(turn.action).toBe("offer_slots");
    if (turn.action === "offer_slots") {
      expect(turn.slots.length).toBeGreaterThan(0);
      const reply = offerSlotsMessage({
        slots: turn.slots.map((slot) => ({
          dateKey: slot.date,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
          timeZone: "America/New_York",
        })),
        todayKey: "2026-09-08",
      });
      expect(reply).toMatch(/available today/);
      expect(reply).not.toMatch(/can't help with scheduling/i);
    }
  });

  it("does not contain the HighLevel Conversation AI refusal anywhere in ContractorYou scheduling", () => {
    const files = [
      "src/lib/scheduling/templates.ts",
      "src/lib/scheduling/conversation.ts",
      "src/lib/scheduling/conversation-turn.ts",
      "src/lib/intelligence/writing.ts",
      "src/lib/highlevel/webhooks.ts",
    ];
    for (const file of files) {
      expect(readFileSync(resolve(file), "utf8")).not.toMatch(/can't help with scheduling appointments/i);
    }
  });

  it("loads active state before deciding a follow-up is not scheduling", () => {
    const conversation = readFileSync(resolve("src/lib/scheduling/conversation.ts"), "utf8");
    const activeStateIndex = conversation.indexOf("ACTIVE_SCHEDULING_STATUSES");
    const routeIndex = conversation.indexOf("ownsSchedulingInbound");
    const oldEarlyExit = conversation.indexOf('fresh.confidence === "low"');
    expect(activeStateIndex).toBeGreaterThan(0);
    expect(routeIndex).toBeGreaterThan(0);
    expect(oldEarlyExit).toBe(-1);
    expect(conversation).toMatch(/lastInboundMessageId/);
    expect(readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8")).toMatch(/processInboundScheduling/);
  });
});

describe("availability questions and slot selection", () => {
  it("treats common availability wording as scheduling turns", () => {
    const phrases = [
      "When do you have available?",
      "What times do you have?",
      "What do you have today?",
      "Do you have anything tomorrow?",
      "What about tomorrow morning?",
      "What's your next opening?",
      "Can anyone come this afternoon?",
      "Do you have a 9-11?",
      "When can you get someone here?",
    ];
    for (const text of phrases) {
      const intent = interpretSchedulingIntent({ text, timeZone: "America/New_York", now, windows });
      expect(ownsSchedulingInbound({ activeState: null, intent }), text).toBe("scheduling");
    }
  });

  it("offers only real tomorrow slots, then books the chosen window after a re-check", () => {
    const ask = interpretSchedulingIntent({
      text: "What do you have tomorrow?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(ask.requestedDate).toBe("2026-09-09");
    const tomorrowSlots = uniqueWindowOffers([
      { date: "2026-09-09", windowId: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60, remainingCapacity: 1 },
      { date: "2026-09-09", windowId: "w13", startMinutes: 13 * 60, endMinutes: 15 * 60, remainingCapacity: 1 },
    ]);
    const offer = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false },
      intent: ask,
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots: [],
      requestedSlots: tomorrowSlots,
      nextSlots: tomorrowSlots,
    });
    expect(offer).toMatchObject({ action: "offer_slots" });
    if (offer.action === "offer_slots") {
      expect(offer.slots.map((slot) => slot.windowId)).toEqual(["w11", "w13"]);
      expect(offer.slots.every((slot) => slot.date === "2026-09-09")).toBe(true);
    }

    const pick = mergeSchedulingIntent(
      ask,
      interpretSchedulingIntent({ text: "11 to 1 works.", timeZone: "America/New_York", now, windows })
    );
    expect(pick.requestedWindowId).toBe("w11");
    expect(pick.requestedDate).toBe("2026-09-09");
    const book = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false },
      intent: pick,
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots: [],
      requestedSlots: tomorrowSlots,
      nextSlots: tomorrowSlots,
    });
    expect(book).toEqual({ action: "book", date: "2026-09-09", windowId: "w11" });

    const gone = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false },
      intent: pick,
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots: [],
      requestedSlots: [],
      nextSlots: tomorrowSlots.filter((slot) => slot.windowId === "w13"),
    });
    expect(gone.action).toBe("offer_slots");
    if (gone.action === "offer_slots") {
      expect(gone.slots.map((slot) => slot.windowId)).toEqual(["w13"]);
    }
  });

  it("does not auto-book when the service type needs office approval", () => {
    expect(
      conversationCanAutoBook({ autoBookingEnabled: true }, { autoBookAllowed: true, requiresOfficeApproval: true })
    ).toBe(false);
    const turn = resolveSchedulingTurn({
      previous: null,
      intent: {
        requestedDate: "2026-09-09",
        requestedWindowId: "w11",
        confidence: "high",
      },
      canAutoBook: false,
      todayKey: "2026-09-08",
      todaySlots: [],
      requestedSlots: [{ date: "2026-09-09", windowId: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60 }],
      nextSlots: [],
    });
    expect(turn).toEqual({ action: "suggest", date: "2026-09-09", windowId: "w11" });
  });

  it("closes the session without booking when the customer says never mind", () => {
    const intent = interpretSchedulingIntent({
      text: "Never mind, I'll call back",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(intent.declineIntent).toBe(true);
    expect(
      resolveSchedulingTurn({
        previous: { status: "CLARIFYING", paused: false },
        intent,
        canAutoBook: true,
        todayKey: "2026-09-08",
        todaySlots: engineOptions(),
        requestedSlots: [],
        nextSlots: [],
      }).action
    ).toBe("close");
  });

  it("does not invent capacity when the requested day is empty", () => {
    const intent = interpretSchedulingIntent({
      text: "What do you have today?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    const turn = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false },
      intent,
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots: [],
      requestedSlots: [],
      nextSlots: [{ date: "2026-09-09", windowId: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 }],
    });
    expect(turn.action).toBe("offer_slots");
    if (turn.action === "offer_slots") {
      expect(turn.todayWasFull).toBe(true);
      expect(turn.slots[0]?.date).toBe("2026-09-09");
    }
  });
});

describe("handoff security and idempotency wiring", () => {
  it("keeps booking behind the canonical transaction and inbound message id", () => {
    const conversation = readFileSync(resolve("src/lib/scheduling/conversation.ts"), "utf8");
    const booking = readFileSync(resolve("src/lib/scheduling/booking.ts"), "utf8");
    expect(conversation).toMatch(/idempotencyKey: `inbound:\${input.messageId}`/);
    expect(conversation).toMatch(/getAvailability/);
    expect(conversation).toMatch(/findNextAvailableOptions/);
    expect(booking).toMatch(/pg_advisory_xact_lock/);
    expect(booking).toMatch(/sendCompanyCommunication/);
  });
});
