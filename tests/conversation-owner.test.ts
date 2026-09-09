import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  contractorYouMayAutoreply,
  parseCustomerConversationOwner,
} from "@/lib/comms/conversation-owner";

vi.mock("@/lib/demo/guard", () => ({
  demoOutboundBlock: async () => ({ blocked: false }),
}));
vi.mock("@/lib/highlevel/connection", () => ({
  isHighLevelConnected: async () => false,
}));
vi.mock("@/lib/comms/conversation-owner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/comms/conversation-owner")>(
    "@/lib/comms/conversation-owner"
  );
  return {
    ...actual,
    loadCustomerConversationOwner: vi.fn(),
  };
});

import { loadCustomerConversationOwner } from "@/lib/comms/conversation-owner";
import { sendCompanyCommunication } from "@/lib/comms/provider";

describe("customer conversation owner", () => {
  it("only lets ContractorYou auto-reply when it owns the conversation", () => {
    expect(contractorYouMayAutoreply("CONTRACTORYOU")).toBe(true);
    expect(contractorYouMayAutoreply("HIGHLEVEL_AI")).toBe(false);
    expect(contractorYouMayAutoreply("MANUAL")).toBe(false);
    expect(parseCustomerConversationOwner("HIGHLEVEL_AI")).toBe("HIGHLEVEL_AI");
    expect(parseCustomerConversationOwner("HIGHLEVEL")).toBe("HIGHLEVEL_AI");
    expect(parseCustomerConversationOwner("OFFICE_ONLY")).toBe("MANUAL");
    expect(parseCustomerConversationOwner("nope")).toBe("CONTRACTORYOU");
  });

  it("keeps HighLevel inbound ingest and stops before autonomous scheduling send", () => {
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(webhook).toMatch(/upsertConversationMessage/);
    expect(webhook).toMatch(/contractorYouMayAutoreply/);
    expect(webhook).toMatch(/loadCustomerConversationOwner/);
    expect(webhook).toMatch(/processInboundReceptionist/);
    expect(webhook).toMatch(/processInboundScheduling/);
    expect(webhook).toMatch(/processSchedulingSessionInbound/);
    const sessionCheck = webhook.indexOf("processSchedulingSessionInbound");
    const ownerCheck = webhook.indexOf("contractorYouMayAutoreply(conversationOwner)");
    const receptionistCall = webhook.indexOf("processInboundReceptionist(inbound)");
    const processCall = webhook.indexOf("processInboundScheduling(inbound)");
    expect(sessionCheck).toBeGreaterThan(0);
    expect(ownerCheck).toBeGreaterThan(sessionCheck);
    expect(receptionistCall).toBeGreaterThan(ownerCheck);
    expect(processCall).toBeGreaterThan(receptionistCall);
  });

  it("does not create scheduling state or send when HighLevel AI or Manual owns the conversation", async () => {
    const conversation = readFileSync(resolve("src/lib/scheduling/conversation.ts"), "utf8");
    expect(conversation).toMatch(/reason: "conversation_owner"/);
    expect(conversation.indexOf("contractorYouMayAutoreply")).toBeLessThan(
      conversation.indexOf("ensureSchedulingSetup")
    );
    expect(conversation).toMatch(/origin: "CONTRACTORYOU_AUTOMATION"/);
    expect(conversation).toMatch(/bookAppointment/);
    expect(conversation).toMatch(/findNextAvailableOptions/);

    vi.mocked(loadCustomerConversationOwner).mockResolvedValue("HIGHLEVEL_AI");
    const blocked = await sendCompanyCommunication({
      companyId: "865",
      channel: "SMS",
      to: "+18655550100",
      body: "Happy to get you on the calendar. What day works best?",
      origin: "CONTRACTORYOU_AUTOMATION",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/not the customer conversation owner/);

    vi.mocked(loadCustomerConversationOwner).mockResolvedValue("MANUAL");
    const manualOwner = await sendCompanyCommunication({
      companyId: "865",
      channel: "SMS",
      to: "+18655550100",
      body: "Happy to get you on the calendar. What day works best?",
      origin: "CONTRACTORYOU_AUTOMATION",
    });
    expect(manualOwner.ok).toBe(false);
    if (!manualOwner.ok) expect(manualOwner.error).toMatch(/not the customer conversation owner/);
  });

  it("still allows office SMS and keeps scheduling services callable", async () => {
    vi.mocked(loadCustomerConversationOwner).mockResolvedValue("HIGHLEVEL_AI");
    const manual = await sendCompanyCommunication({
      companyId: "865",
      channel: "SMS",
      to: "+18655550100",
      body: "We can get you on Wednesday between 9 and 11.",
      origin: "MANUAL_OFFICE",
    });
    expect(manual.ok).toBe(false);
    if (!manual.ok) expect(manual.error).not.toMatch(/conversation owner/);

    const inbox = readFileSync(resolve("src/server/actions/highlevel.ts"), "utf8");
    expect(inbox).toMatch(/origin: "MANUAL_OFFICE"/);
    expect(inbox).toMatch(/saveCustomerConversationOwnerAction/);

    const engine = readFileSync(resolve("src/lib/scheduling/index.ts"), "utf8");
    expect(engine).toMatch(/getAvailability/);
    expect(engine).toMatch(/findNextAvailableOptions/);
    expect(engine).toMatch(/bookAppointment/);
    expect(engine).toMatch(/evaluateCapacity/);

    const booking = readFileSync(resolve("src/lib/scheduling/booking.ts"), "utf8");
    expect(booking).toMatch(/pg_advisory_xact_lock/);
    expect(booking).toMatch(/SCHEDULING_CONFIRMATION/);
  });

  it("sets only 865 HVAC to HighLevel AI and defaults other companies to ContractorYou", () => {
    const migration = readFileSync(
      resolve("prisma/migrations/20260908172000_customer_conversation_owner/migration.sql"),
      "utf8"
    );
    expect(migration).toMatch(/DEFAULT 'CONTRACTORYOU'/);
    expect(migration).toMatch(/businessName" = '865 HVAC'/);
    expect(migration).toMatch(/isDemo" = false/);
    expect(migration).toMatch(/HIGHLEVEL_AI/);
    expect(migration).not.toMatch(/SET "customerConversationOwner" = 'HIGHLEVEL_AI';\s*$/m);
  });

  it("moves 865 HVAC receptionist ownership back to ContractorYou Regina", () => {
    const migration = readFileSync(
      resolve("prisma/migrations/20260908190000_ai_receptionist_foundation/migration.sql"),
      "utf8"
    );
    expect(migration).toMatch(/customerConversationOwner" = 'CONTRACTORYOU'/);
    expect(migration).toMatch(/assistantName/);
    expect(migration).toMatch(/Regina/);
    expect(migration).toMatch(/businessName" = '865 HVAC'/);
  });

  it("sets 865 HVAC hybrid conversation owner to HighLevel Regina", () => {
    const migration = readFileSync(
      resolve("prisma/migrations/20260908193000_hybrid_conversation_owner/migration.sql"),
      "utf8"
    );
    expect(migration).toMatch(/HIGHLEVEL_AI/);
    expect(migration).toMatch(/businessName" = '865 HVAC'/);
  });
});
