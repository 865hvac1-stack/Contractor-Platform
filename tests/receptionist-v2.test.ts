import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    companyAiReceptionistSetting: { findUnique: vi.fn() },
    company: { findFirst: vi.fn() },
    receptionistTurn: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    communicationMessage: { findMany: vi.fn() },
    conversationSchedulingState: { findFirst: vi.fn() },
    aIUsageEvent: { create: vi.fn(), aggregate: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/comms/conversation-owner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/comms/conversation-owner")>("@/lib/comms/conversation-owner");
  return {
    ...actual,
    loadCustomerConversationOwner: vi.fn(async () => "HIGHLEVEL_AI"),
  };
});
import { DEFAULT_RECEPTIONIST_SETTINGS } from "@/lib/intelligence/receptionist/settings";
import {
  parseReceptionistV2Mode,
  receptionistV2MaySendLive,
  receptionistV2ShouldObserve,
} from "@/lib/intelligence/receptionist/v2/types";
import { fallbackClassifyReceptionistV2, capabilityAllowsIntent } from "@/lib/intelligence/receptionist/v2/intent";
import { assertResponseUsesOnlyVerifiedFacts, composeVerifiedReceptionistSms } from "@/lib/intelligence/receptionist/v2/compose";
import {
  answerFromCompanyKnowledge,
  faqsFromFormText,
  loadCompanyKnowledgeFromSettings,
} from "@/lib/intelligence/receptionist/v2/knowledge";
import { actionForIntent, isMutatingReceptionistAction } from "@/lib/intelligence/receptionist/v2/tools";
import { boundConversationHistory, historyUnderTokenBudget, RECEPTIONIST_HISTORY_LIMIT } from "@/lib/intelligence/receptionist/v2/context";
import {
  FallbackReceptionistProvider,
  OpenAiReceptionistProvider,
  parseReceptionistStructuredOutput,
} from "@/lib/intelligence/receptionist/v2/provider";
import { processReceptionistV2, attachOutboundToLatestShadowTurn } from "@/lib/intelligence/receptionist/v2/inbound";
import { decideSchedulingNextStep } from "@/lib/agent-tools/scheduling-session";
import { resolveOfferedSlotSelection } from "@/lib/scheduling/conversation-turn";

const settings = DEFAULT_RECEPTIONIST_SETTINGS;
const personality = { assistantName: "Regina", tone: "warm", responseLength: "short", useCustomerFirstName: true };

function classify(text: string, hasActiveScheduling = false) {
  return fallbackClassifyReceptionistV2({ text, hasActiveScheduling, assistantName: "Regina" });
}

describe("ContractorYou AI Receptionist V2", () => {
  it("keeps HighLevel Regina as the default and only observes in shadow or live AI mode", () => {
    expect(parseReceptionistV2Mode(undefined)).toBe("HIGHLEVEL_REGINA");
    expect(receptionistV2ShouldObserve("HIGHLEVEL_REGINA")).toBe(false);
    expect(receptionistV2ShouldObserve("CONTRACTORYOU_SHADOW")).toBe(true);
    expect(receptionistV2ShouldObserve("CONTRACTORYOU_AI")).toBe(true);
    expect(receptionistV2MaySendLive({ mode: "CONTRACTORYOU_SHADOW", conversationOwner: "HIGHLEVEL_AI" })).toBe(false);
    expect(receptionistV2MaySendLive({ mode: "CONTRACTORYOU_AI", conversationOwner: "HIGHLEVEL_AI" })).toBe(false);
    expect(receptionistV2MaySendLive({ mode: "CONTRACTORYOU_AI", conversationOwner: "CONTRACTORYOU" })).toBe(true);
  });

  it("writes friendly SMS from verified scheduling state", () => {
    expect(
      composeVerifiedReceptionistSms({
        text: "I need someone to come out",
        classification: classify("I need someone to come out"),
        facts: { assistantName: "Regina", nextWorkflowAsk: "What's going on with the system?" },
        personality,
      })
    ).toBe("Absolutely. What's going on with the system?");
    expect(
      composeVerifiedReceptionistSms({
        text: "Yes",
        classification: classify("Yes", true),
        facts: {
          assistantName: "Regina",
          schedulingPhase: "NEED_PROPERTY",
          properties: [{ id: "p1", address: "701 Morganton Square Drive", isPrimary: true }],
        },
        personality,
      })
    ).toContain("701 Morganton Square Drive");
    expect(
      composeVerifiedReceptionistSms({
        text: "Tuesday morning",
        classification: classify("Tuesday morning", true),
        facts: {
          assistantName: "Regina",
          offeredSlots: ["Mon, Sep 21 from 9–11 AM", "Tue, Sep 22 from 9–11 AM"],
        },
        personality,
      })
    ).toMatch(/Mon, Sep 21 from 9–11 AM/);
  });

  it("keeps company knowledge tenant-scoped and does not invent answers", () => {
    const a = loadCompanyKnowledgeFromSettings({
      businessName: "865 HVAC",
      settings: { ...settings, servicesOffered: "Yep, we do. We service Trane and most major brands." },
    });
    const b = loadCompanyKnowledgeFromSettings({
      businessName: "Summit Home Services",
      settings: { ...settings, servicesOffered: null, knowledgeJson: { faqs: [] } },
    });
    expect(answerFromCompanyKnowledge({ question: "Do you guys work on Trane?", knowledge: a })).toMatch(/Trane/);
    expect(answerFromCompanyKnowledge({ question: "Do you guys work on Trane?", knowledge: b })).toBeNull();
    expect(a.companyName).not.toBe(b.companyName);
  });

  it("bounds conversation history so pronouns can resolve without sending the whole thread", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      direction: i % 2 ? "OUTBOUND" : "INBOUND",
      body: i === 0 ? "It's not cooling." : `older message ${i} ${"x".repeat(400)}`,
    }));
    const bounded = boundConversationHistory(rows, { newestFirst: true });
    expect(bounded).toHaveLength(RECEPTIONIST_HISTORY_LIMIT);
    expect(bounded.at(-1)?.body).toBe("It's not cooling.");
    expect(historyUnderTokenBudget(bounded)).toBe(true);
    const understood = classify("It's not cooling.", true);
    expect(understood.extractedContext.concern?.toLowerCase()).toMatch(/cool/);
  });

  it("classifies the initial intent set", () => {
    expect(classify("Hey there").intent).toBe("GREETING");
    expect(classify("I need someone to come out, it's not cooling").intent).toBe("SCHEDULING");
    expect(classify("Please reschedule my appointment").intent).toBe("RESCHEDULE");
    expect(classify("Cancel my appointment").intent).toBe("CANCEL_APPOINTMENT");
    expect(classify("Where is my technician?").intent).toBe("JOB_STATUS");
    expect(classify("Did you guys order that part?").intent).toBe("WAITING_PART_STATUS");
    expect(classify("What's the status of my estimate?").intent).toBe("ESTIMATE_STATUS");
    expect(classify("What's my balance?").intent).toBe("INVOICE_BALANCE");
    expect(classify("Can I pay over the phone?").intent).toBe("PAYMENT_QUESTION");
    expect(classify("Do I have a membership?").intent).toBe("MEMBERSHIP");
    expect(["MAINTENANCE", "SCHEDULING"]).toContain(classify("I need a maintenance tune-up").intent);
    expect(classify("Do you guys work on Trane?").intent).toBe("SERVICE_QUESTION");
    expect(classify("Can I talk to a real person?").intent).toBe("HUMAN_REQUEST");
    expect(classify("This is ridiculous, I want a lawsuit").intent).toBe("COMPLAINT");
    expect(classify("I smell gas").intent).toBe("EMERGENCY");
    expect(classify("asdf qwerty").intent).toBe("UNKNOWN");
    expect(classify("What's my balance?").confidence).toBeGreaterThan(0.8);
    expect(classify("What's my balance?").extractedContext).toBeTruthy();
  });

  it("acknowledges a casual SMS without abandoning the scheduling workflow", () => {
    const text = composeVerifiedReceptionistSms({
      text: "Ok thanks",
      classification: classify("Ok thanks", true),
      facts: { assistantName: "Regina", schedulingPhase: "NEED_SERVICE_CONTEXT", nextWorkflowAsk: "What's going on with the system?" },
      personality,
    });
    expect(text).toMatch(/Of course! What's going on with the system\?/);
    expect(text).not.toMatch(/let me know if you need anything else/i);
  });

  it("answers a verified question during scheduling, then returns to the outstanding ask", () => {
    const text = composeVerifiedReceptionistSms({
      text: "Do you guys work on Trane?",
      classification: classify("Do you guys work on Trane?", true),
      facts: {
        assistantName: "Regina",
        nextWorkflowAsk: "What's the address where you're needing service?",
        knowledgeAnswers: ["Yep, we do."],
      },
      personality,
    });
    expect(text).toMatch(/Yep, we do/);
    expect(text).toMatch(/address where you're needing service/);
  });

  it("does not guess when company knowledge cannot verify the answer", () => {
    const text = composeVerifiedReceptionistSms({
      text: "Do you guys work on geothermal?",
      classification: classify("Do you guys work on geothermal?"),
      facts: { assistantName: "Regina", nextWorkflowAsk: "What's the address where you're needing service?" },
      personality,
    });
    expect(text).toMatch(/don't want to guess|office/i);
    expect(text).not.toMatch(/yes we (do|install geothermal)/i);
  });

  it("uses existing vs new customer and single vs multiple properties from verified facts only", () => {
    const existingSingle = composeVerifiedReceptionistSms({
      text: "Need service",
      classification: classify("Need service"),
      facts: {
        assistantName: "Regina",
        customerFirstName: "Alex",
        customerId: "cust_1",
        schedulingPhase: "NEED_PROPERTY",
        properties: [{ id: "p1", address: "701 Morganton Square Drive", isPrimary: true }],
      },
      personality,
    });
    expect(existingSingle).toContain("701 Morganton Square Drive");
    const multiple = composeVerifiedReceptionistSms({
      text: "The other address",
      classification: classify("The other address", true),
      facts: {
        assistantName: "Regina",
        schedulingPhase: "NEED_PROPERTY",
        nextWorkflowAsk: "Which property do you need service at?",
        properties: [
          { id: "p1", address: "701 Morganton Square Drive", isPrimary: true },
          { id: "p2", address: "100 Main Street", isPrimary: false },
        ],
      },
      personality,
    });
    expect(multiple).toMatch(/Which property/);
    const brandNew = composeVerifiedReceptionistSms({
      text: "I need a service call",
      classification: classify("I need a service call"),
      facts: { assistantName: "Regina", schedulingPhase: "NEED_PROPERTY", nextWorkflowAsk: "What's the address where you're needing service?", properties: [] },
      personality,
    });
    expect(brandNew).toMatch(/address where you're needing service/);
  });

  it("only offers real verified availability and refuses invented booking copy", () => {
    const slots = ["Mon, Sep 21 from 9–11 AM"];
    const offered = composeVerifiedReceptionistSms({
      text: "What times do you have?",
      classification: classify("What times do you have?", true),
      facts: { assistantName: "Regina", offeredSlots: slots },
      personality,
    });
    expect(offered).toContain("Mon, Sep 21 from 9–11 AM");
    expect(offered).not.toContain("Tuesday at 2");
    expect(
      assertResponseUsesOnlyVerifiedFacts({
        responseText: "Perfect — you're all set for Monday at 9.",
        facts: { assistantName: "Regina", bookingConfirmed: false },
      }).ok
    ).toBe(false);
    expect(
      composeVerifiedReceptionistSms({
        text: "Book it",
        classification: classify("Book it", true),
        facts: {
          assistantName: "Regina",
          bookingConfirmed: true,
          appointmentDisplay: "Monday, September 21 from 9–11 AM",
          serviceAddress: "701 Morganton Square Drive",
        },
        personality,
      })
    ).toMatch(/all set for Monday, September 21 from 9–11 AM at 701 Morganton Square Drive/);
  });

  it("treats an ambiguous slot as a clarification, not a booking", () => {
    const picked = resolveOfferedSlotSelection("Tuesday works", [
      { date: "2026-09-15", windowId: "w2", startMinutes: 9 * 60, endMinutes: 11 * 60 },
      { date: "2026-09-15", windowId: "w3", startMinutes: 13 * 60, endMinutes: 15 * 60 },
    ]);
    expect(picked.kind === "ambiguous" || picked.kind === "match").toBe(true);
    expect(actionForIntent("SCHEDULING")).not.toBe("bookAppointment");
  });

  it("hands off humans, complaints, emergencies, and disabled capabilities", () => {
    expect(classify("Can I speak to someone in the office?").shouldHandoff).toBe(true);
    expect(classify("This is unacceptable").shouldHandoff).toBe(true);
    expect(classify("carbon monoxide alarm").shouldHandoff).toBe(true);
    expect(
      capabilityAllowsIntent({
        intent: "INVOICE_BALANCE",
        allowScheduling: true,
        allowRescheduling: true,
        allowCancellations: true,
        allowJobStatus: true,
        allowInvoiceQuestions: false,
        allowEstimateQuestions: true,
        allowMembershipQuestions: true,
        allowWaitingQuestions: true,
      })
    ).toBe(false);
  });

  it("marks mutating tools so shadow mode cannot book or hand off", () => {
    expect(isMutatingReceptionistAction("startScheduling")).toBe(true);
    expect(isMutatingReceptionistAction("selectOfferedSlot")).toBe(true);
    expect(isMutatingReceptionistAction("bookAppointment")).toBe(true);
    expect(isMutatingReceptionistAction("checkAvailability")).toBe(true);
    expect(isMutatingReceptionistAction("requestHumanHandoff")).toBe(true);
    expect(isMutatingReceptionistAction("getInvoiceBalance")).toBe(false);
    expect(actionForIntent("SCHEDULING")).toBe("startScheduling");
  });

  it("falls back when the AI provider is unavailable and rejects invalid structured output", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAiReceptionistProvider();
    const classified = await provider.classifyIntent({
      text: "I need service",
      history: [],
      hasActiveScheduling: false,
      assistantName: "Regina",
    });
    expect(classified.usedAi).toBe(false);
    expect(classified.errorCode).toBe("MISSING_AI_KEY");
    expect(parseReceptionistStructuredOutput({ nope: true }).ok).toBe(false);
    expect(parseReceptionistStructuredOutput("not-json").ok).toBe(false);
    expect(parseReceptionistStructuredOutput({ responseText: "Absolutely. What's going on with the system?" }).ok).toBe(true);
    const fallback = new FallbackReceptionistProvider();
    const generated = await fallback.generateResponse({
      text: "I need service",
      classification: classify("I need service"),
      facts: { assistantName: "Regina", nextWorkflowAsk: "What's going on with the system?" },
      history: [],
      personality,
    });
    expect(generated.usedAi).toBe(false);
    expect(generated.data.responseText).toMatch(/system/);
    if (previous) process.env.OPENAI_API_KEY = previous;
  });

  it("stores company FAQs without leaking another tenant's copy", () => {
    const faqs = faqsFromFormText("Do you work on Trane? | Yep, we service Trane.\nHours? | 8 to 5");
    expect(faqs).toHaveLength(2);
    const knowledge = loadCompanyKnowledgeFromSettings({
      businessName: "865 HVAC",
      settings: { ...settings, knowledgeJson: { faqs } },
    });
    expect(knowledge.faqs[0]?.answer).toMatch(/Trane/);
    const other = loadCompanyKnowledgeFromSettings({
      businessName: "Other Co",
      settings: { ...settings, knowledgeJson: null },
    });
    expect(other.faqs).toEqual([]);
  });

  it("wires V2 after the working scheduling session and never replaces that machine", () => {
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    const inbound = readFileSync(resolve("src/lib/intelligence/receptionist/v2/inbound.ts"), "utf8");
    const tools = readFileSync(resolve("src/lib/intelligence/receptionist/v2/tools.ts"), "utf8");
    expect(webhook.indexOf("processSchedulingSessionInbound")).toBeLessThan(webhook.indexOf("maybeRunReceptionistV2"));
    expect(webhook.indexOf("processInboundReceptionist")).toBeLessThan(webhook.indexOf("maybeRunReceptionistV2"));
    expect(webhook).toMatch(/attachOutboundToLatestShadowTurn/);
    expect(webhook).toMatch(/skipLiveSend: session.handled/);
    expect(inbound).toMatch(/startSchedulingTool/);
    expect(inbound).toMatch(/shadow_no_mutation|shadow/);
    expect(tools).not.toMatch(/findNextAvailableOptions/);
    expect(tools).not.toMatch(/bookAppointment\(/);
    expect(decideSchedulingNextStep({
      hasReliableName: true,
      propertyCount: 1,
      hasAddress: true,
      hasConcern: true,
      offeredCount: 0,
      selectedSlot: null,
    }).action).toBe("offer_slots");
  });

  it("limits the live switch to production 865 HVAC and never prints the OpenAI key", () => {
    const migration = readFileSync(
      resolve("prisma/migrations/20260910020600_865_hvac_contractoryou_ai_live/migration.sql"),
      "utf8"
    );
    expect(migration).toMatch(/businessName" = '865 HVAC' AND "isDemo" = false/);
    expect(migration).toMatch(/CONTRACTORYOU_AI/);
    expect(migration).toMatch(/customerConversationOwner" = 'CONTRACTORYOU'/);
    expect(migration).not.toMatch(/Summit/);
    expect(migration).not.toMatch(/OPENAI_API_KEY|sk-/);
    const health = readFileSync(resolve("src/app/api/health/route.ts"), "utf8");
    expect(health).toMatch(/openaiConfigured/);
    expect(health).not.toMatch(/getOpenAIApiKey\(\)|OPENAI_API_KEY/);
    expect(readFileSync(resolve("src/lib/intelligence/config.ts"), "utf8")).not.toMatch(
      /console\.(log|info|debug).*OPENAI|console\.(log|info|debug).*apiKey/
    );
  });
});

describe("Receptionist V2 inbound shadow safety", () => {
  it("does not send SMS or run mutating actions in shadow, and ignores duplicate inbounds", async () => {
    mockPrisma.companyAiReceptionistSetting.findUnique.mockResolvedValue({
      ...DEFAULT_RECEPTIONIST_SETTINGS,
      mode: "CONTRACTORYOU_SHADOW",
      enabled: true,
    });
    mockPrisma.company.findFirst.mockResolvedValue({
      businessName: "865 HVAC",
      timezone: "America/New_York",
      hoursNote: "8-5",
      serviceArea: "Knoxville",
      description: null,
      phone: "865",
      customerConversationOwner: "HIGHLEVEL_AI",
    });
    mockPrisma.receptionistTurn.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      proposedResponse: "Absolutely. What's going on with the system?",
      mode: "CONTRACTORYOU_SHADOW",
      intent: "SCHEDULING",
    });
    mockPrisma.communicationMessage.findMany.mockResolvedValue([]);
    mockPrisma.conversationSchedulingState.findFirst.mockResolvedValue({
      id: "st1",
      status: "OPEN",
      lastAiAction: "NEED_SERVICE_CONTEXT",
      offeredSlots: null,
      requestedDate: null,
      requestedWindowId: null,
      bookedJobId: null,
      intake: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.receptionistTurn.create.mockResolvedValue({ id: "turn_1" });
    mockPrisma.aIUsageEvent.create.mockResolvedValue({ id: "u1" });

    const send = vi.fn();
    const startScheduling = vi.fn();
    const handoff = vi.fn();
    const runTool = vi.fn(async () => ({
      action: "startScheduling" as const,
      facts: { customerFirstName: "Alex", customerId: "c1", properties: [] },
      skipped: "shadow_no_mutation",
    }));

    const first = await processReceptionistV2(
      {
        companyId: "co_865",
        threadId: "th1",
        messageId: "msg1",
        body: "Ok thanks",
        phone: "+18653858079",
      },
      { send, startScheduling, handoff, runTool }
    );
    expect(first.shadow).toBe(true);
    expect(first.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(startScheduling).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
    expect(first.proposedResponse).toMatch(/Of course! What's going on with the system/);

    const dup = await processReceptionistV2({
      companyId: "co_865",
      threadId: "th1",
      messageId: "msg1",
      body: "Ok thanks",
    });
    expect(dup.duplicate).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("records a tool failure without inventing status and does not send in shadow", async () => {
    mockPrisma.companyAiReceptionistSetting.findUnique.mockResolvedValue({
      ...DEFAULT_RECEPTIONIST_SETTINGS,
      mode: "CONTRACTORYOU_SHADOW",
    });
    mockPrisma.company.findFirst.mockResolvedValue({
      businessName: "865 HVAC",
      timezone: "America/New_York",
    });
    mockPrisma.receptionistTurn.findUnique.mockResolvedValue(null);
    mockPrisma.communicationMessage.findMany.mockResolvedValue([]);
    mockPrisma.conversationSchedulingState.findFirst.mockResolvedValue(null);
    mockPrisma.receptionistTurn.create.mockResolvedValue({ id: "turn_2" });
    mockPrisma.aIUsageEvent.create.mockResolvedValue({ id: "u2" });
    const send = vi.fn();
    const result = await processReceptionistV2(
      {
        companyId: "co_865",
        threadId: "th2",
        messageId: "msg2",
        body: "What's my balance?",
        phone: "+18653858079",
      },
      {
        send,
        runTool: async () => ({ action: "getInvoiceBalance", facts: {}, skipped: "tool_failure" }),
      }
    );
    expect(result.sent).toBeFalsy();
    expect(send).not.toHaveBeenCalled();
    expect(result.proposedResponse).not.toMatch(/\$\d/);
  });

  it("attaches Regina's later outbound to the latest shadow turn only for that company/thread", async () => {
    mockPrisma.receptionistTurn.findFirst.mockResolvedValue({ id: "turn_3" });
    mockPrisma.receptionistTurn.update.mockResolvedValue({ id: "turn_3" });
    const attached = await attachOutboundToLatestShadowTurn({
      companyId: "co_865",
      threadId: "th1",
      body: "Sure — what's going on with the system?",
    });
    expect(attached.attached).toBe(true);
    expect(mockPrisma.receptionistTurn.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "co_865", threadId: "th1", shadow: true }),
      })
    );
  });
});
