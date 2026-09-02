import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY, SMS_DEFAULT_CHANNEL } from "@/lib/highlevel/config";
import { parseHighLevelActiveNumbers, resolveApprovedSenderNumber } from "@/lib/highlevel/phone-numbers";
import {
  normalizeHighLevelInboundEvent,
  parseCallDurationSeconds,
  processHighLevelWebhook,
} from "@/lib/highlevel/webhooks";
import { extractHighLevelRecordingHint } from "@/lib/highlevel/attachments";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { HIGHLEVEL_WEBHOOK_LOG_EVENT, logHighLevelWebhook } from "@/lib/highlevel/webhook-log";
import { highlevelLeadSource } from "@/lib/highlevel/leads";

const prisma = new PrismaClient();

describe("HighLevel phone, SMS sender, and call attribution", () => {
  const ids = { companyA: "", companyB: "", connectionA: "", customerA: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const a = await prisma.company.create({ data: { businessName: `HL Phone A ${stamp}`, status: "ACTIVE" } });
    const b = await prisma.company.create({ data: { businessName: `HL Phone B ${stamp}`, status: "ACTIVE" } });
    ids.companyA = a.id;
    ids.companyB = b.id;
    const connection = await prisma.integrationConnection.create({
      data: {
        companyId: a.id,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
        status: "CONNECTED",
        externalAccountId: `loc_phone_${stamp}`,
        scopes: ["phonenumbers.read", "conversations/message.write"],
      },
    });
    ids.connectionA = connection.id;
    const customer = await prisma.customer.create({
      data: { companyId: a.id, firstName: "Pat", lastName: "Caller", phone: "+18655550199" },
    });
    ids.customerA = customer.id;
  });

  afterAll(async () => {
    if (ids.companyA) await prisma.company.delete({ where: { id: ids.companyA } }).catch(() => undefined);
    if (ids.companyB) await prisma.company.delete({ where: { id: ids.companyB } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("parses v3 active-number envelopes from public LC Phone docs", () => {
    const numbers = parseHighLevelActiveNumbers({
      status: "success",
      data: {
        numbers: [{ phoneNumber: "+17745678902", friendlyName: "Main line", countryCode: "US", isDefaultNumber: true }],
        isUnderLc: true,
        total: 1,
      },
    });
    expect(numbers).toHaveLength(1);
    expect(numbers[0]?.phoneNumber).toBe("+17745678902");
    expect(numbers[0]?.isDefaultNumber).toBe(true);
  });

  it("never selects an SMS sender at random", async () => {
    expect(await resolveApprovedSenderNumber(prisma, ids.companyA)).toBeNull();
    await prisma.trackingNumber.create({
      data: {
        companyId: ids.companyA,
        phoneNumber: "+18655550111",
        source: "HIGHLEVEL",
        provider: HIGHLEVEL_PROVIDER_KEY,
        status: "ACTIVE",
      },
    });
    expect(await resolveApprovedSenderNumber(prisma, ids.companyA)).toBeNull();
    await prisma.trackingNumber.create({
      data: {
        companyId: ids.companyA,
        phoneNumber: "+18655550100",
        source: "GOOGLE_LSA",
        campaign: "LSA Knoxville",
        channel: SMS_DEFAULT_CHANNEL,
        provider: HIGHLEVEL_PROVIDER_KEY,
        status: "ACTIVE",
      },
    });
    const sender = await resolveApprovedSenderNumber(prisma, ids.companyA);
    expect(sender?.phoneNumber).toBe("+18655550100");
    expect(sender?.reason).toBe("company_default");
  });

  it("maps inbound CALL to-number to a tracking source and does not store raw recording URLs", async () => {
    const result = await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload: {
        type: "InboundMessage",
        locationId: "loc_phone_test",
        webhookId: "wh_call_lsa_1",
        contactId: "hl_new_caller",
        conversationId: "conv_lsa_1",
        messageId: "msg_call_lsa_1",
        dateAdded: "2026-09-02T12:00:00.000Z",
        direction: "inbound",
        messageType: "CALL",
        status: "completed",
        callDuration: 95,
        callStatus: "completed",
        from: "+18655550999",
        to: "+18655550100",
        attachments: ["https://example.invalid/protected-recording"],
      },
    });
    expect(result.processed).toBe(true);
    const call = await prisma.callRecord.findFirst({
      where: { companyId: ids.companyA, recordingRef: "msg_call_lsa_1" },
    });
    expect(call?.trackingNumber).toBe("+18655550100");
    expect(call?.source).toBe("GOOGLE_LSA");
    expect(call?.caller).toBe("+18655550999");
    expect(call?.recordingRef).toBe("msg_call_lsa_1");
    expect(call?.recordingRef).not.toContain("http");
    const lead = await prisma.lead.findFirst({
      where: { companyId: ids.companyA, phone: { contains: "8655550999" } },
    });
    expect(lead?.source).toBe("GOOGLE_LSA");
    const attribution = await prisma.attributionEvent.findFirst({
      where: { companyId: ids.companyA, source: "GOOGLE_LSA" },
    });
    expect(attribution?.revenueCents).toBeNull();
    const thread = await prisma.communicationThread.findFirst({
      where: { companyId: ids.companyA, externalId: "conv_lsa_1" },
    });
    expect(thread).toBeTruthy();
    const leaked = await prisma.callRecord.findFirst({
      where: { companyId: ids.companyB, recordingRef: "msg_call_lsa_1" },
    });
    expect(leaked).toBeNull();
  });

  it("refuses SMS without an approved sender and never purchases numbers from tests", async () => {
    await prisma.trackingNumber.deleteMany({
      where: { companyId: ids.companyB },
    });
    const result = await sendCompanyCommunication({
      companyId: ids.companyB,
      channel: "SMS",
      to: "+18655550199",
      body: "Should not send",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.provider === "none" || result.error.includes("approved") || result.error.includes("not connected")).toBe(true);
    }
    const purchaseSource = require("node:fs").readFileSync("src/server/actions/highlevel.ts", "utf8");
    expect(purchaseSource).toMatch(/confirm !== "PURCHASE"/);
    expect(purchaseSource).not.toMatch(/purchaseHighLevelNumberAction\(\s*null/);
  });

  it("uses the documented LC Phone v3 active-numbers path", () => {
    const source = require("node:fs").readFileSync("src/lib/highlevel/client.ts", "utf8");
    expect(source).toMatch(/\/phone-system\/numbers\/location\/\$\{input\.locationId\}/);
    expect(source).toMatch(/HIGHLEVEL_PHONE_API_VERSION/);
    expect(source).toMatch(/fromNumber: input.fromNumber/);
  });

  it("treats recording attachments as presence-only", () => {
    const hint = extractHighLevelRecordingHint(["https://example.invalid/voicemail.mp3"]);
    expect(hint.hasRecording).toBe(true);
    expect(hint.recordingUrl).toContain("example.invalid");
  });

  it("normalizes a documented HighLevel CALL payload without inventing missing fields", () => {
    const fields = normalizeHighLevelInboundEvent({
      type: "InboundMessage",
      locationId: "0d48aEf7q67DAu134bpy",
      attachments: ["call recording url"],
      contactId: "gblakL5aYQC4glDtP1r2t3",
      conversationId: "SGDqZrzmwTr19d10aHkt9F",
      dateAdded: "2024-05-08T11:57:42.250Z",
      direction: "inbound",
      messageType: "CALL",
      messageId: "tyW42xCD0HQpb3hhfLcx",
      status: "completed",
      callDuration: "120",
      callStatus: "completed",
      from: "+15551234567",
      to: "+15559876543",
      messageTypeString: "TYPE_CALL",
    });
    expect(fields.locationId).toBe("0d48aEf7q67DAu134bpy");
    expect(fields.contactId).toBe("gblakL5aYQC4glDtP1r2t3");
    expect(fields.conversationId).toBe("SGDqZrzmwTr19d10aHkt9F");
    expect(fields.messageId).toBe("tyW42xCD0HQpb3hhfLcx");
    expect(fields.from).toBe("+15551234567");
    expect(fields.to).toBe("+15559876543");
    expect(fields.direction).toBe("inbound");
    expect(fields.status).toBe("completed");
    expect(fields.callStatus).toBe("completed");
    expect(fields.callDuration).toBe(120);
    expect(fields.channel).toBe("CALL");
    expect(fields.hasRecording).toBe(true);
    expect(fields.body).toBeNull();
    expect(fields.contactName).toBeNull();
    expect(parseCallDurationSeconds("95")).toBe(95);
    expect(parseCallDurationSeconds(undefined)).toBeNull();
  });

  it("maps Google LSA Test to the Google LSA lead source without inventing revenue", () => {
    expect(highlevelLeadSource("Google LSA Test")).toBe("GOOGLE_LSA");
  });

  it("logs a stable highlevel.webhook event and never includes secrets", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((value: unknown) => {
      lines.push(String(value));
    });
    logHighLevelWebhook({
      stage: "processed",
      eventType: "InboundMessage",
      locationMapped: true,
      locationId: "loc_summit_test",
      companyId: "company_summit",
      from: "+18655550123",
      to: "+18655550999",
      idempotency: "new",
    });
    logHighLevelWebhook({
      stage: "processed",
      authorization: "Bearer secret-token",
      token: "pit-should-not-log",
    } as never);
    spy.mockRestore();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const raw = lines.join("\n");
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed.event).toBe(HIGHLEVEL_WEBHOOK_LOG_EVENT);
    expect(parsed.provider).toBe("highlevel");
    expect(parsed.stage).toBe("processed");
    expect(raw.toLowerCase()).not.toContain("bearer");
    expect(raw).not.toContain("secret-token");
    expect(raw).not.toContain("pit-should-not");
  });

  it("links a matched Summit-style caller to the existing customer and does not create another customer", async () => {
    const customersBefore = await prisma.customer.count({ where: { companyId: ids.companyA } });
    const result = await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload: {
        type: "InboundMessage",
        webhookId: "wh_call_matched_1",
        locationId: "loc_phone_test",
        contactId: "hl_pat_existing",
        conversationId: "conv_pat_1",
        messageId: "msg_call_pat_1",
        dateAdded: "2026-09-02T13:00:00.000Z",
        direction: "inbound",
        messageType: "TYPE_CALL",
        status: "completed",
        callDuration: 42,
        callStatus: "completed",
        from: "+18655550199",
        to: "+18655550100",
      },
    });
    expect(result.processed).toBe(true);
    expect(result.customerMatched).toBe(true);
    expect(result.callRecordCreated).toBe(true);
    expect(result.leadCreated).toBe(false);
    const customersAfter = await prisma.customer.count({ where: { companyId: ids.companyA } });
    expect(customersAfter).toBe(customersBefore);
    const call = await prisma.callRecord.findFirst({
      where: { companyId: ids.companyA, recordingRef: "msg_call_pat_1" },
    });
    expect(call?.customerId).toBe(ids.customerA);
    expect(call?.source).toBe("GOOGLE_LSA");
  });

  it("keeps unmatched callers as a lead candidate and does not create a customer", async () => {
    const customersBefore = await prisma.customer.count({ where: { companyId: ids.companyA } });
    await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload: {
        type: "InboundMessage",
        webhookId: "wh_call_unknown_1",
        locationId: "loc_phone_test",
        contactId: "hl_unknown_live",
        conversationId: "conv_unknown_1",
        messageId: "msg_call_unknown_1",
        direction: "inbound",
        messageType: "CALL",
        from: "+18655550888",
        to: "+18655550100",
      },
    });
    const customersAfter = await prisma.customer.count({ where: { companyId: ids.companyA } });
    expect(customersAfter).toBe(customersBefore);
    const customer = await prisma.customer.findFirst({
      where: { companyId: ids.companyA, phone: { contains: "8655550888" } },
    });
    expect(customer).toBeNull();
    const lead = await prisma.lead.findFirst({
      where: { companyId: ids.companyA, phone: { contains: "8655550888" } },
    });
    expect(lead).toBeTruthy();
  });

  it("maps Google LSA Test tracking source onto the call record", async () => {
    await prisma.trackingNumber.create({
      data: {
        companyId: ids.companyA,
        phoneNumber: "+18655550777",
        source: "Google LSA Test",
        campaign: "Summit live webhook test",
        provider: HIGHLEVEL_PROVIDER_KEY,
        status: "ACTIVE",
      },
    });
    const result = await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload: {
        type: "InboundMessage",
        webhookId: "wh_call_lsa_test_1",
        locationId: "loc_phone_test",
        contactId: "hl_lsa_test_caller",
        conversationId: "conv_lsa_test_1",
        messageId: "msg_call_lsa_test_1",
        direction: "inbound",
        messageType: "CALL",
        from: "+18655550666",
        to: "+18655550777",
        callDuration: 18,
        callStatus: "completed",
      },
    });
    expect(result.trackingSource).toBe("Google LSA Test");
    const call = await prisma.callRecord.findFirst({
      where: { companyId: ids.companyA, recordingRef: "msg_call_lsa_test_1" },
    });
    expect(call?.source).toBe("Google LSA Test");
    expect(call?.trackingNumber).toBe("+18655550777");
    const attribution = await prisma.attributionEvent.findFirst({
      where: { companyId: ids.companyA, source: "Google LSA Test" },
    });
    expect(attribution?.revenueCents).toBeNull();
  });

  it("does not create a second call when the same HighLevel event is retried", async () => {
    const payload = {
      type: "InboundMessage",
      webhookId: "wh_call_dup_1",
      locationId: "loc_phone_test",
      contactId: "hl_dup_caller",
      conversationId: "conv_dup_1",
      messageId: "msg_call_dup_1",
      direction: "inbound",
      messageType: "CALL",
      from: "+18655550444",
      to: "+18655550100",
    };
    const first = await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload,
    });
    const second = await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload,
    });
    expect(first.processed).toBe(true);
    expect(second.duplicate).toBe(true);
    const calls = await prisma.callRecord.findMany({
      where: { companyId: ids.companyA, recordingRef: "msg_call_dup_1" },
    });
    expect(calls).toHaveLength(1);
  });

  it("does not leak a Summit-style call into another company", async () => {
    const leaked = await prisma.callRecord.findFirst({
      where: { companyId: ids.companyB, recordingRef: { startsWith: "msg_call_" } },
    });
    expect(leaked).toBeNull();
    const routeSource = require("node:fs").readFileSync("src/app/api/webhooks/highlevel/route.ts", "utf8");
    const logSource = require("node:fs").readFileSync("src/lib/highlevel/webhook-log.ts", "utf8");
    expect(logSource).toContain('HIGHLEVEL_WEBHOOK_LOG_EVENT = "highlevel.webhook"');
    expect(routeSource).toContain("logHighLevelWebhook");
    expect(routeSource).not.toMatch(/logHighLevelWebhook\([\s\S]*ghlSignature/);
    expect(routeSource).not.toMatch(/console\.(?:log|info|error)\([^)]*headers/);
  });
});
