import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalizeUsPhone } from "@/lib/phone";
import { DEFAULT_RECEPTIONIST_SETTINGS, receptionistShouldHandleInbound } from "@/lib/intelligence/receptionist/settings";
import { sanitizeCustomerSms } from "@/lib/intelligence/receptionist/sanitize";
import { fallbackReceptionistPlan } from "@/lib/intelligence/receptionist/understand";
import { logReceptionistTurn } from "@/lib/intelligence/receptionist/log";
import { resolveOfferedSlotSelection, type OfferedSlot } from "@/lib/scheduling/conversation-turn";

const offered: OfferedSlot[] = [
  { date: "2026-09-14", windowId: "w1", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-15", windowId: "w2", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { date: "2026-09-15", windowId: "w3", startMinutes: 13 * 60, endMinutes: 15 * 60 },
];

describe("ContractorYou AI receptionist", () => {
  it("treats an unknown AC service request as schedule_service", () => {
    const plan = fallbackReceptionistPlan({
      text: "My AC isn’t cooling and I need someone to come out.",
      timeZone: "America/New_York",
    });
    expect(plan.intent).toBe("schedule_service");
    expect(plan.requiresHuman).toBeFalsy();
  });

  it("maps Tuesday morning to an exact stored slot and not an invented time", () => {
    const picked = resolveOfferedSlotSelection("Tuesday morning works", offered);
    expect(picked.kind).toBe("match");
    if (picked.kind === "match") {
      expect(picked.slot.date).toBe("2026-09-15");
      expect(picked.slot.windowId).toBe("w2");
      expect(picked.slot.startMinutes).toBe(9 * 60);
    }
    expect(fallbackReceptionistPlan({ text: "Tuesday morning works", timeZone: "America/New_York", hasActiveScheduling: true }).intent).toBe(
      "choose_appointment_slot"
    );
  });

  it("selects the first offered slot from natural language", () => {
    const picked = resolveOfferedSlotSelection("the first one", offered);
    expect(picked.kind).toBe("match");
    if (picked.kind === "match") expect(picked.slot.windowId).toBe("w1");
  });

  it("asks for clarification when the slot choice is ambiguous", () => {
    const picked = resolveOfferedSlotSelection("Tuesday works", offered);
    expect(picked.kind === "ambiguous" || picked.kind === "match").toBe(true);
    if (picked.kind === "match") expect(picked.slot.date).toBe("2026-09-15");
  });

  it("normalizes US phones without creating a second identity", () => {
    expect(canonicalizeUsPhone("(865) 555-0100")).toBe(canonicalizeUsPhone("+18655550100"));
    expect(canonicalizeUsPhone("8655550100")).toBe("+18655550100");
  });

  it("hands off when the customer asks for a person", () => {
    const plan = fallbackReceptionistPlan({ text: "Can I talk to a real person?", timeZone: "America/New_York" });
    expect(plan.intent).toBe("human_handoff");
    expect(plan.requiresHuman).toBe(true);
  });

  it("does not invent availability or leak internals in customer SMS", () => {
    expect(sanitizeCustomerSms("As an AI I cannot access the system returned slot_token abc")).toBe(
      "I’ve got this flagged for the office so we can take care of it."
    );
    expect(sanitizeCustomerSms("I can do Tuesday from 9–11 AM.")).toContain("Tuesday");
    expect(sanitizeCustomerSms("I can do Tuesday from 9–11 AM.")).not.toMatch(/slot_token|ContractorYou|HighLevel/i);
  });

  it("fails safely without AI configuration and does not fake an LLM reply", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const plan = fallbackReceptionistPlan({ text: "What is your warranty?", timeZone: "America/New_York" });
    expect(plan.intent).toBe("unknown");
    expect(receptionistShouldHandleInbound({ ...baseSettings(), enabled: true })).toBe(true);
    expect(receptionistShouldHandleInbound({ ...baseSettings(), enabled: false })).toBe(false);
    if (previous) process.env.OPENAI_API_KEY = previous;
  });

  it("wires inbound HighLevel messages through the receptionist then deterministic scheduling", () => {
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    const inbound = readFileSync(resolve("src/lib/intelligence/receptionist/inbound.ts"), "utf8");
    const conversation = readFileSync(resolve("src/lib/scheduling/conversation.ts"), "utf8");
    expect(webhook).toMatch(/upsertConversationMessage/);
    expect(webhook).toMatch(/processInboundReceptionist/);
    expect(inbound).toMatch(/processInboundScheduling/);
    expect(inbound).toMatch(/companyId_inboundMessageId/);
    expect(inbound).toMatch(/forceScheduling/);
    expect(inbound).toMatch(/composeReply/);
    expect(inbound).toMatch(/handoffToOffice/);
    expect(conversation).toMatch(/forceScheduling/);
    expect(conversation).toMatch(/composeReply/);
    expect(conversation).toMatch(/bookAppointment/);
    expect(conversation).toMatch(/findNextAvailableOptions/);
    expect(conversation).toMatch(/origin: "CONTRACTORYOU_AUTOMATION"/);
  });

  it("keeps agent-tools and does not send SMS from those endpoints", () => {
    const book = readFileSync(resolve("src/lib/agent-tools/book-appointment.ts"), "utf8");
    const check = readFileSync(resolve("src/lib/agent-tools/check-availability.ts"), "utf8");
    expect(book).toMatch(/sendConfirmation: false/);
    expect(check).not.toMatch(/sendCompanyCommunication/);
    expect(readFileSync(resolve("src/app/api/agent-tools/check-availability/route.ts"), "utf8")).toMatch(
      /checkAvailabilityTool/
    );
  });

  it("does not log secrets and records safe receptionist diagnostics", () => {
    const log = readFileSync(resolve("src/lib/intelligence/receptionist/log.ts"), "utf8");
    const inbound = readFileSync(resolve("src/lib/intelligence/receptionist/inbound.ts"), "utf8");
    expect(log).not.toMatch(/OPENAI_API_KEY|authorization|Bearer |cyat_/);
    expect(inbound).not.toMatch(/OPENAI_API_KEY|ghp_/);
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logReceptionistTurn({
      companyId: "co",
      threadId: "th",
      inboundMessageId: "msg",
      intent: "schedule_service",
      availabilityCount: 2,
      bookingResult: null,
    });
    expect(spy.mock.calls[0]?.[1]).not.toMatch(/Bearer|sk-|cyat_/);
    spy.mockRestore();
  });

  it("covers existing/new customer property cases in the identity services it reuses", () => {
    const identity = readFileSync(resolve("src/lib/scheduling/conversation-identity.ts"), "utf8");
    expect(identity).toMatch(/resolveSchedulingCustomer/);
    expect(identity).toMatch(/createCustomerForConversation/);
    expect(identity).toMatch(/createPropertyForConversation/);
    expect(identity).toMatch(/matchPropertyFromText/);
    const inbound = readFileSync(resolve("src/lib/intelligence/receptionist/inbound.ts"), "utf8");
    expect(inbound).toMatch(/ReceptionistTurn/);
  });
});

function baseSettings() {
  return { ...DEFAULT_RECEPTIONIST_SETTINGS, enabled: true };
}
