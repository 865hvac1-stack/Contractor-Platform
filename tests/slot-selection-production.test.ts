import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveOfferedSlotSelection,
  resolveSchedulingTurn,
} from "@/lib/scheduling/conversation-turn";
import { parseCustomerConversationOwner, highLevelOwnsConversation, contractorYouMayAutoreply } from "@/lib/comms/conversation-owner";

const productionOffers = [
  { date: "2026-09-15", windowId: "w9a", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-21", windowId: "w9b", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-22", windowId: "w9c", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-28", windowId: "w9d", startMinutes: 9 * 60, endMinutes: 11 * 60 },
];

function turnFor(text: string) {
  return resolveSchedulingTurn({
    previous: { status: "CLARIFYING", paused: false, missingField: "slot_selection" },
    intent: { confidence: "low", missingField: "slot_selection" },
    text,
    offeredSlots: productionOffers,
    canAutoBook: true,
    todayKey: "2026-09-08",
    todaySlots: [],
    requestedSlots: [],
    nextSlots: [],
  });
}

describe("production offered-slot resolution", () => {
  it("selects Tuesday September 15th from the live production reply", () => {
    expect(resolveOfferedSlotSelection("Tuesday September 15th", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[0],
    });
  });

  it("selects September 15th from 9-11 exactly and books instead of re-listing", () => {
    const result = resolveOfferedSlotSelection("I would take September 15th from 9-11", productionOffers);
    expect(result).toEqual({ kind: "match", slot: productionOffers[0] });
    expect(turnFor("I would take September 15th from 9-11")).toEqual({
      action: "book",
      date: "2026-09-15",
      windowId: "w9a",
    });
  });

  it("selects the first / earliest offered slot", () => {
    expect(resolveOfferedSlotSelection("the first one", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[0],
    });
    expect(resolveOfferedSlotSelection("first option", productionOffers).kind).toBe("match");
    expect(resolveOfferedSlotSelection("option 1", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[0],
    });
    expect(resolveOfferedSlotSelection("earliest one", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[0],
    });
  });

  it("treats two Tuesday mornings as ambiguous and asks which Tuesday", () => {
    const result = resolveOfferedSlotSelection("Tuesday morning", productionOffers);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((slot) => slot.date)).toEqual(["2026-09-15", "2026-09-22"]);
    }
    expect(turnFor("Tuesday morning").action).toBe("clarify_slots");
  });

  it("selects September 21 exactly", () => {
    expect(resolveOfferedSlotSelection("September 21", productionOffers)).toEqual({
      kind: "match",
      slot: productionOffers[1],
    });
    expect(resolveOfferedSlotSelection("September 21 works", productionOffers).kind).toBe("match");
  });

  it("treats Monday works as ambiguous when two Mondays were offered", () => {
    const result = resolveOfferedSlotSelection("Monday works", productionOffers);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((slot) => slot.date)).toEqual(["2026-09-21", "2026-09-28"]);
    }
  });

  it("does not invent a slot when the reply matches none of the offers", () => {
    expect(resolveOfferedSlotSelection("Friday at 7pm", productionOffers)).toEqual({ kind: "none" });
    expect(turnFor("Friday at 7pm").action).toBe("unmatched_slot");
  });

  it("keeps hybrid ownership aliases and HighLevel no-autoreply guards", () => {
    expect(parseCustomerConversationOwner("HIGHLEVEL")).toBe("HIGHLEVEL_AI");
    expect(parseCustomerConversationOwner("OFFICE_ONLY")).toBe("MANUAL");
    expect(highLevelOwnsConversation("HIGHLEVEL_AI")).toBe(true);
    expect(contractorYouMayAutoreply("HIGHLEVEL_AI")).toBe(false);
    expect(contractorYouMayAutoreply("CONTRACTORYOU")).toBe(true);
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(webhook).toMatch(/contractorYouMayAutoreply/);
    expect(webhook).toMatch(/continueHybridSchedulingFromInbound/);
    expect(webhook.indexOf("contractorYouMayAutoreply")).toBeLessThan(webhook.indexOf("processInboundReceptionist"));
    const provider = readFileSync(resolve("src/lib/comms/provider.ts"), "utf8");
    expect(provider).toMatch(/CONTRACTORYOU_ACTION_RESULT/);
    expect(readFileSync(resolve("src/app/api/agent-tools/select-offered-slot/route.ts"), "utf8")).toMatch(
      /selectOfferedSlotTool/
    );
  });
});
