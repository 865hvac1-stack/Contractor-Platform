import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY, SMS_DEFAULT_CHANNEL } from "@/lib/highlevel/config";
import { parseHighLevelActiveNumbers, resolveApprovedSenderNumber } from "@/lib/highlevel/phone-numbers";
import { processHighLevelWebhook } from "@/lib/highlevel/webhooks";
import { extractHighLevelRecordingHint } from "@/lib/highlevel/attachments";
import { sendCompanyCommunication } from "@/lib/comms/provider";

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
});
