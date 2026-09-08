import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { interpretSchedulingIntent, mergeSchedulingIntent } from "@/lib/scheduling/intent";
import {
  matchOfferedSlot,
  resolveOfferedSlotSelection,
  resolveSchedulingTurn,
  shouldFetchNextAvailability,
  shouldSearchAvailability,
} from "@/lib/scheduling/conversation-turn";
import {
  extractCustomerConcern,
  jobDescriptionFromConcern,
  matchPropertyFromText,
  parsePersonName,
  parseServiceAddress,
  propertyChoiceLabel,
  resolveSchedulingCustomer,
  streetLabel,
} from "@/lib/scheduling/conversation-identity";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { askWhichPropertyMessage, clarifyOfferedSlotsMessage, confirmationMessage } from "@/lib/scheduling/templates";
import { DEFAULT_POLICY } from "@/lib/scheduling/types";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";

const now = new Date("2026-09-08T16:00:00.000Z");
const windows = [
  { id: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60, active: true },
  { id: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60, active: true },
  { id: "w13", startMinutes: 13 * 60, endMinutes: 15 * 60, active: true },
];

const offered = [
  { date: "2026-09-08", windowId: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60 },
  { date: "2026-09-09", windowId: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 },
];

describe("slot-selection loop regression", () => {
  it("does not search availability again just because missingField is slot_selection", () => {
    const intent = interpretSchedulingIntent({
      text: "The first one",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(
      shouldSearchAvailability({
        intent,
        previousMissing: "slot_selection",
        text: "The first one",
      })
    ).toBe(false);
    expect(
      shouldFetchNextAvailability({
        intent,
        previousMissing: "slot_selection",
        offeredSlots: offered,
        text: "The first one",
      })
    ).toBe(false);
  });

  it("advances to book for ordinal, weekday, and window phrases against stored offers", () => {
    const phrases = [
      ["The first one", offered[0]],
      ["First one", offered[0]],
      ["second option", offered[1]],
      ["Wednesday works", offered[1]],
      ["Let's do 9 to 11", offered[1]],
      ["11-1", offered[0]],
      ["11 to 1", offered[0]],
      ["Tuesday", offered[0]],
    ] as const;
    for (const [text, slot] of phrases) {
      expect(matchOfferedSlot(text, offered), text).toEqual(slot);
      const turn = resolveSchedulingTurn({
        previous: { status: "CLARIFYING", paused: false, missingField: "slot_selection" },
        intent: { confidence: "low", missingField: "slot_selection" },
        text,
        offeredSlots: offered,
        canAutoBook: true,
        todayKey: "2026-09-08",
        todaySlots: offered,
        requestedSlots: offered,
        nextSlots: offered,
      });
      expect(turn, text).toEqual({ action: "book", date: slot.date, windowId: slot.windowId });
      expect(
        shouldFetchNextAvailability({
          intent: { confidence: "low" },
          previousMissing: "slot_selection",
          offeredSlots: offered,
          text,
          selectedSlot: slot,
        }),
        text
      ).toBe(false);
    }
  });

  it("asks one targeted clarification instead of re-offering a new search", () => {
    const sameDay = [
      { date: "2026-09-09", windowId: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 },
      { date: "2026-09-09", windowId: "w13", startMinutes: 13 * 60, endMinutes: 15 * 60 },
    ];
    expect(resolveOfferedSlotSelection("that one", sameDay)).toEqual({ kind: "ambiguous", candidates: sameDay });
    expect(resolveOfferedSlotSelection("the afternoon one", sameDay)).toEqual({
      kind: "match",
      slot: sameDay[1],
    });
    expect(
      resolveOfferedSlotSelection("Tuesday morning", [
        { date: "2026-09-08", windowId: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 },
        { date: "2026-09-08", windowId: "w13", startMinutes: 13 * 60, endMinutes: 15 * 60 },
      ])
    ).toEqual({
      kind: "match",
      slot: { date: "2026-09-08", windowId: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 },
    });
    const turn = resolveSchedulingTurn({
      previous: { status: "CLARIFYING", paused: false, missingField: "slot_selection" },
      intent: { confidence: "low", missingField: "slot_selection" },
      text: "that one",
      offeredSlots: sameDay,
      canAutoBook: true,
      todayKey: "2026-09-08",
      todaySlots: sameDay,
      requestedSlots: sameDay,
      nextSlots: sameDay,
    });
    expect(turn.action).toBe("clarify_slots");
    if (turn.action === "clarify_slots") {
      expect(turn.slots).toEqual(sameDay);
      expect(
        clarifyOfferedSlotsMessage({
          slots: turn.slots.map((slot) => ({
            dateKey: slot.date,
            startMinutes: slot.startMinutes,
            endMinutes: slot.endMinutes,
            timeZone: "America/New_York",
          })),
        })
      ).toMatch(/I have two openings that match — .+ or .+\. Which one would you like\?/);
    }
    expect(
      shouldFetchNextAvailability({
        intent: { confidence: "low" },
        previousMissing: "slot_selection",
        offeredSlots: sameDay,
        text: "that one",
      })
    ).toBe(false);
  });

  it("only searches again after a valid selection when the customer rejects the offers", () => {
    expect(
      shouldFetchNextAvailability({
        intent: { confidence: "low" },
        previousMissing: "slot_selection",
        offeredSlots: offered,
        text: "none of those",
      })
    ).toBe(true);
    expect(
      shouldFetchNextAvailability({
        intent: interpretSchedulingIntent({
          text: "What else do you have?",
          timeZone: "America/New_York",
          now,
          windows,
        }),
        previousMissing: "slot_selection",
        offeredSlots: offered,
        text: "What else do you have?",
      })
    ).toBe(true);
  });
});

describe("customer and property resolution", () => {
  it("resolves an existing customer from inbound phone and HighLevel identity map", async () => {
    const customer = {
      id: "cust_tj",
      firstName: "TJ",
      lastName: "Hurst",
      phone: "+18655550100",
      secondaryPhone: null,
      status: "ACTIVE",
    };
    const db = {
      customer: {
        findFirst: async ({ where }: { where: { id?: string } }) =>
          where.id === customer.id ? { id: customer.id } : null,
        findMany: async () => [customer],
      },
      communicationThread: {
        findFirst: async () => ({
          customerId: null,
          leadId: null,
          phone: "(865) 555-0100",
          externalContactId: "hl_contact_1",
        }),
      },
      providerIdentityMap: {
        findFirst: async ({
          where,
        }: {
          where: { entityType?: string; externalId?: string };
        }) =>
          where.entityType === "CUSTOMER" && where.externalId === "hl_contact_1"
            ? {
                id: "map_1",
                provider: HIGHLEVEL_PROVIDER_KEY,
                entityType: "CUSTOMER",
                internalId: "cust_tj",
                externalId: "hl_contact_1",
              }
            : null,
      },
      lead: { findFirst: async () => null, findMany: async () => [] },
    };
    const byMap = await resolveSchedulingCustomer(db as never, {
      companyId: "865",
      contactId: "hl_contact_1",
    });
    expect(byMap).toEqual({ customerId: "cust_tj", leadId: null, matchedOn: "identity_map" });
    const byPhone = await resolveSchedulingCustomer(db as never, {
      companyId: "865",
      phone: "865-555-0100",
    });
    expect(byPhone.customerId).toBe("cust_tj");
    expect(byPhone.matchedOn).toBe("phone");
  });

  it("matches inbound phones by canonical E.164, not name", () => {
    expect(canonicalizeUsPhone("(865) 555-0100")).toBe("+18655550100");
    expect(phonesMatch("8655550100", "+1 (865) 555-0100")).toBe(true);
    expect(phonesMatch("865-555-0100", "18655550100")).toBe(true);
    const identity = readFileSync(resolve("src/lib/scheduling/conversation-identity.ts"), "utf8");
    expect(identity).toMatch(/phonesMatch/);
    expect(identity).toMatch(/ProviderIdentityMap|getIdentityMap/);
    expect(identity).toMatch(/entityType: "CUSTOMER"/);
    expect(identity).not.toMatch(/matchedOn: "name"/);
  });

  it("reuses one property automatically and asks when there are two", () => {
    const home = {
      id: "p1",
      address: "312 Emory Road",
      city: "Knoxville",
      state: "TN",
      zip: "37918",
      isPrimary: true,
    };
    const other = {
      id: "p2",
      address: "104 Washington Pike",
      city: "Knoxville",
      state: "TN",
      zip: "37917",
      isPrimary: false,
    };
    expect(streetLabel(home.address)).toBe("Emory Road");
    expect(propertyChoiceLabel(home, 0)).toBe("your home on Emory Road");
    expect(propertyChoiceLabel(other, 1)).toBe("the property on Washington Pike");
    expect(askWhichPropertyMessage(["your home on Emory Road", "the property on Washington Pike"])).toBe(
      "Is this for your home on Emory Road or the property on Washington Pike?"
    );
    expect(matchPropertyFromText("the house on Emory", [home, other])).toEqual([home]);
    expect(matchPropertyFromText("Washington Pike", [home, other])).toEqual([other]);
  });

  it("collects name and address for an unknown phone without asking for the phone again", () => {
    expect(parsePersonName("John Smith")).toEqual({ firstName: "John", lastName: "Smith" });
    expect(parsePersonName("My name is John Smith")).toEqual({ firstName: "John", lastName: "Smith" });
    expect(parseServiceAddress("123 Main Street, Knoxville TN 37918")).toEqual({
      street: "123 Main Street",
      city: "Knoxville",
      state: "TN",
      zip: "37918",
    });
    const conversation = readFileSync(resolve("src/lib/scheduling/conversation.ts"), "utf8");
    expect(conversation).toMatch(/askNameMessage/);
    expect(conversation).toMatch(/createCustomerForConversation/);
    expect(conversation).toMatch(/createPropertyForConversation/);
    expect(conversation).not.toMatch(/What(?:'s| is) your phone/);
  });

  it("stores the customer concern without inventing a diagnosis", () => {
    expect(extractCustomerConcern("Outside fan is humming but won't spin.")).toMatch(/humming/);
    expect(jobDescriptionFromConcern("Outside fan is humming but won't spin.")).toBe(
      "Customer reports outside fan is humming but won't spin."
    );
    expect(jobDescriptionFromConcern("My AC isn't cooling.")).toBe("Customer reports my AC isn't cooling.");
    expect(jobDescriptionFromConcern(null)).toBe("Service call requested.");
    expect(jobDescriptionFromConcern("Bad capacitor.")).not.toBe("Bad capacitor.");
  });
});

describe("booking confirmation and existing-customer skip", () => {
  it("confirms with the booked window and does not ask known customers for name or address", () => {
    expect(
      confirmationMessage({
        policy: DEFAULT_POLICY,
        dateKey: "2026-09-09",
        startMinutes: 9 * 60,
        endMinutes: 11 * 60,
        timeZone: "America/New_York",
      })
    ).toMatch(/You’re all set for .+ between /);
    const conversation = readFileSync(resolve("src/lib/scheduling/conversation.ts"), "utf8");
    expect(conversation).toMatch(/properties\.length === 1/);
    expect(conversation).toMatch(/bookAppointment/);
    expect(conversation).toMatch(/findOpenMaintenanceVisit/);
  });

  it("keeps merge on slot_selection instead of resetting to a date question", () => {
    const previous = {
      requestedDate: null,
      requestedWindowId: null,
      missingField: "slot_selection" as const,
      confidence: "high" as const,
    };
    const next = interpretSchedulingIntent({
      text: "The first one",
      timeZone: "America/New_York",
      now,
      windows,
    });
    const merged = mergeSchedulingIntent(previous, next);
    expect(merged.missingField).toBe("slot_selection");
    expect(merged.availabilitySearchRequested).toBeFalsy();
  });
});
