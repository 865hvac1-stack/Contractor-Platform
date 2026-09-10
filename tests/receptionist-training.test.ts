import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { can } from "@/lib/permissions";
import {
  buildTrainingContext,
  customerDeclinedOpportunity,
  exampleConflictsVerifiedData,
  qualifyOpportunity,
  retrieveRelevantExamples,
  retrieveRelevantKnowledge,
  STARTER_MAINTENANCE_OPPORTUNITY,
  STARTER_SERVICE_CONCERN_OPPORTUNITY,
  trainingContextIsBounded,
} from "@/lib/intelligence/receptionist/v2/training";
import { composeVerifiedReceptionistSms } from "@/lib/intelligence/receptionist/v2/compose";
import { decideSchedulingNextStep } from "@/lib/agent-tools/scheduling-session";

const maintenanceRule = {
  id: "opp_1",
  type: "MAINTENANCE",
  title: "Maintenance plan",
  triggerText: STARTER_MAINTENANCE_OPPORTUNITY.triggerText,
  verifiedRequirement: STARTER_MAINTENANCE_OPPORTUNITY.verifiedRequirement,
  suggestedBehavior: STARTER_MAINTENANCE_OPPORTUNITY.suggestedBehavior,
  cta: STARTER_MAINTENANCE_OPPORTUNITY.cta,
  active: true,
  priority: 10,
};

describe("AI Receptionist Training Center", () => {
  it("keeps training tenant-scoped in queries and migrations", () => {
    const store = readFileSync(resolve("src/lib/intelligence/receptionist/v2/training-store.ts"), "utf8");
    const actions = readFileSync(resolve("src/server/actions/receptionist-training.ts"), "utf8");
    const migration = readFileSync(resolve("prisma/migrations/20260910023000_receptionist_training_center/migration.sql"), "utf8");
    expect(store).toMatch(/where: \{ companyId/);
    expect(actions).toMatch(/companyId: ctx.company.id/);
    expect(actions).toMatch(/where: \{ id, companyId: ctx.company.id \}/);
    expect(migration).toMatch(/businessName" = '865 HVAC' AND "isDemo" = false/);
    expect(migration).not.toMatch(/Summit/);
    expect(migration).not.toMatch(/customerConversationOwner/);
    expect(migration).not.toMatch(/CONTRACTORYOU_AI|HIGHLEVEL_REGINA/);
    const understanding = readFileSync(
      resolve("prisma/migrations/20260910033000_conversation_understanding_training/migration.sql"),
      "utf8"
    );
    expect(understanding).toMatch(/businessName" = '865 HVAC' AND "isDemo" = false/);
    expect(understanding).toMatch(/actual HVAC problem that likely requires service/);
    expect(understanding).toMatch(/SERVICE_CONCERN/);
    expect(understanding).not.toMatch(/Summit/);
    expect(understanding).not.toMatch(/customerConversationOwner|CONTRACTORYOU_AI/);
  });

  it("retrieves only relevant knowledge for the inbound question", () => {
    const hits = retrieveRelevantKnowledge({
      items: [
        { id: "k1", question: "Do you work on Trane?", answer: "Yes, we service Trane and most major HVAC brands.", category: "FAQ", active: true },
        { id: "k2", question: "Do you clean pools?", answer: "No.", category: "FAQ", active: true },
        { id: "k3", question: "Inactive", answer: "Hidden", category: "FAQ", active: false },
      ],
      text: "Do you guys work on Trane?",
      intent: "SERVICE_QUESTION",
    });
    expect(hits.map((row) => row.id)).toEqual(["k1"]);
  });

  it("injects conversation rules into bounded training context", () => {
    const packed = buildTrainingContext({
      text: "thanks",
      intent: "GREETING",
      facts: { assistantName: "Regina" },
      knowledge: [],
      rules: [
        { id: "r1", body: "Stay on the active workflow after thanks.", active: true, priority: 10 },
        { id: "r2", body: "Off", active: false, priority: 1 },
      ],
      opportunities: [],
      examples: [],
      declinedTypes: [],
      offeredTypes: [],
    });
    expect(packed.rules.map((row) => row.id)).toEqual(["r1"]);
    expect(trainingContextIsBounded(packed)).toBe(true);
  });

  it("offers maintenance only when membership is verified missing", () => {
    const question = "Am I currently set up on a maintenance agreement with you guys?";
    const none = qualifyOpportunity({
      rules: [maintenanceRule],
      text: question,
      intent: "MEMBERSHIP",
      facts: { hasActiveMembership: false, membershipStatus: "I don't see an active maintenance plan on your account right now." },
      declinedTypes: [],
      offeredTypes: [],
    });
    expect(none?.id).toBe("opp_1");
    const copy = composeVerifiedReceptionistSms({
      text: question,
      classification: {
        intent: "MEMBERSHIP",
        confidence: 0.9,
        extractedContext: {},
        shouldHandoff: false,
      },
      facts: {
        assistantName: "Regina",
        hasActiveMembership: false,
        membershipStatus: "I don't see an active maintenance plan on your account right now.",
        opportunityOffer:
          "I don't see an active maintenance plan on your account right now. We do offer one though — want me to send you the details?",
      },
      personality: { assistantName: "Regina", tone: "warm", responseLength: "short", useCustomerFirstName: true },
    });
    expect(copy.toLowerCase()).toMatch(/don't see an active maintenance plan/);
    expect(copy.toLowerCase()).toMatch(/offer one|details/);
    expect(
      qualifyOpportunity({
        rules: [maintenanceRule],
        text: question,
        intent: "MEMBERSHIP",
        facts: { hasActiveMembership: true, membershipStatus: "I show an active maintenance plan on your account." },
        declinedTypes: [],
        offeredTypes: [],
      })
    ).toBeNull();
    expect(
      qualifyOpportunity({
        rules: [maintenanceRule],
        text: question,
        intent: "MEMBERSHIP",
        facts: { hasActiveMembership: null },
        declinedTypes: [],
        offeredTypes: [],
      })
    ).toBeNull();
  });

  it("does not repeat an opportunity after the customer declines in the same conversation", () => {
    expect(customerDeclinedOpportunity("No thanks")).toBe(true);
    expect(
      qualifyOpportunity({
        rules: [maintenanceRule],
        text: "Am I on a maintenance plan?",
        intent: "MEMBERSHIP",
        facts: { hasActiveMembership: false },
        declinedTypes: ["MAINTENANCE"],
        offeredTypes: ["MAINTENANCE"],
      })
    ).toBeNull();
  });

  it("retrieves only relevant approved examples and drops ones that fight verified data", () => {
    const examples = retrieveRelevantExamples({
      examples: [
        {
          id: "e1",
          customerMessage: "Am I currently set up on a maintenance agreement?",
          preferredResponse: "I don't see an active maintenance plan on your account right now. We do offer one though.",
          intent: "MEMBERSHIP",
          active: true,
        },
        {
          id: "e2",
          customerMessage: "What is your warranty?",
          preferredResponse: "Let me have the office confirm warranty coverage.",
          intent: "GENERAL_QUESTION",
          active: true,
        },
      ],
      text: "Am I currently set up on a maintenance agreement with you guys?",
      intent: "MEMBERSHIP",
      facts: { hasActiveMembership: false },
    });
    expect(examples.map((row) => row.id)).toEqual(["e1"]);
    expect(
      exampleConflictsVerifiedData({
        preferredResponse: "I don't see an active plan",
        facts: { hasActiveMembership: true },
      })
    ).toBe(true);
    const blocked = retrieveRelevantExamples({
      examples: [
        {
          id: "e1",
          customerMessage: "maintenance agreement",
          preferredResponse: "I don't see an active maintenance plan on your account right now.",
          intent: "MEMBERSHIP",
          active: true,
        },
      ],
      text: "Am I on a maintenance agreement?",
      intent: "MEMBERSHIP",
      facts: { hasActiveMembership: true },
    });
    expect(blocked).toEqual([]);
  });

  it("requires a human review save before a reply becomes training", () => {
    const actions = readFileSync(resolve("src/server/actions/receptionist-training.ts"), "utf8");
    expect(actions).toMatch(/reviewReceptionistTurnAction/);
    expect(actions).toMatch(/saveAs === "example"/);
    expect(actions).toMatch(/receptionistApprovedExample.create/);
    expect(actions).not.toMatch(/fine-tun|fineTune|upload.*transcript/);
    expect(readFileSync(resolve("src/lib/intelligence/receptionist/v2/inbound.ts"), "utf8")).not.toMatch(
      /ensureReceptionistTrainingStarter|createMany\(\{[\s\S]*customerMessage/
    );
  });

  it("does not let training invent prices or benefits", () => {
    expect(
      composeVerifiedReceptionistSms({
        text: "How much is the plan?",
        classification: { intent: "MEMBERSHIP", confidence: 0.8, extractedContext: {}, shouldHandoff: false },
        facts: { assistantName: "Regina", hasActiveMembership: false, membershipStatus: "I don't see an active maintenance plan on your account right now." },
        personality: { assistantName: "Regina", tone: "warm", responseLength: "short", useCustomerFirstName: false },
      })
    ).not.toMatch(/\$\d|save \d+%/i);
  });

  it("limits training edits to owner, admin, and manager", () => {
    expect(can("COMPANY_OWNER", "receptionist:train")).toBe(true);
    expect(can("ADMIN", "receptionist:train")).toBe(true);
    expect(can("MANAGER", "receptionist:train")).toBe(true);
    expect(can("OFFICE", "receptionist:train")).toBe(false);
    expect(can("TECHNICIAN", "receptionist:train")).toBe(false);
  });

  it("offers a service visit from Training Center only for a real service concern", () => {
    const rule = {
      id: "opp_svc",
      ...STARTER_SERVICE_CONCERN_OPPORTUNITY,
      active: true,
      priority: 5,
    };
    expect(
      qualifyOpportunity({
        rules: [rule],
        text: "My AC has been running nonstop.",
        intent: "SERVICE_CONCERN",
        facts: { offerScheduling: true, serviceConcernActive: true, hasActiveAppointment: false, activeSchedulingSession: false },
        declinedTypes: [],
        offeredTypes: [],
      })?.id
    ).toBe("opp_svc");
    expect(
      qualifyOpportunity({
        rules: [rule],
        text: "Do you work on Trane?",
        intent: "SERVICE_QUESTION",
        facts: { offerScheduling: false, serviceConcernActive: false },
        declinedTypes: [],
        offeredTypes: [],
      })
    ).toBeNull();
    expect(
      qualifyOpportunity({
        rules: [rule],
        text: "My Trane is making another noise",
        intent: "SERVICE_CONCERN",
        facts: { offerScheduling: true, serviceConcernActive: true, hasActiveAppointment: true },
        declinedTypes: [],
        offeredTypes: [],
      })
    ).toBeNull();
  });

  it("does not change the scheduling state machine", () => {
    expect(
      decideSchedulingNextStep({
        hasReliableName: true,
        propertyCount: 1,
        hasAddress: true,
        hasConcern: true,
        offeredCount: 0,
        selectedSlot: null,
      }).action
    ).toBe("offer_slots");
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(webhook.indexOf("processSchedulingSessionInbound")).toBeLessThan(webhook.indexOf("maybeRunReceptionistV2"));
  });
});
