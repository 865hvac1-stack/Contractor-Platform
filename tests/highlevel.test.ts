import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptProviderTokens, decryptProviderTokens } from "@/lib/integrations/crypto";
import { deleteConnectionCredentials, getCompanyConnection, getValidAccessToken, saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { matchHighLevelContact, mapContactToCustomer } from "@/lib/highlevel/contacts";
import { highlevelLeadSource } from "@/lib/highlevel/leads";
import { processHighLevelWebhook, resolveHighLevelConnectionByLocation, verifyHighLevelWebhookSignature } from "@/lib/highlevel/webhooks";
import { upsertConversationMessage } from "@/lib/highlevel/conversations";
import { highlevelCapabilities } from "@/lib/highlevel/capabilities";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { getChannelCards } from "@/lib/integrations/connections";
import { getProvider, INTEGRATION_PROVIDERS } from "@/lib/integrations/catalog";
import { getProviderEnv } from "@/lib/integrations/env";
import { resolveCommunicationProvider, sendCompanyCommunication } from "@/lib/comms/provider";
import { maybeSendOnMyWayMessage } from "@/lib/communications/on-my-way";
import { emailConfigured, sendTransactionalEmail } from "@/lib/email/resend";
import { previewHighLevelContactSync } from "@/lib/highlevel/sync";
import * as highlevelClient from "@/lib/highlevel/client";
import * as highlevelOAuth from "@/lib/highlevel/oauth";
import { assignPlaybookToJob } from "@/lib/playbooks/assign";
import { getStarterTemplate } from "@/lib/playbooks/templates";

const prisma = new PrismaClient();

describe("HighLevel capabilities and catalog", () => {
  it("does not mark capabilities CONNECTED unless ContractorYou verified them", () => {
    const available = highlevelCapabilities({
      connected: true,
      scopes: ["contacts.readonly", "conversations.write"],
    });
    expect(available.find((row) => row.key === "contacts")?.status).toBe("AVAILABLE");
    expect(available.find((row) => row.key === "reviews")?.status).toBe("NOT_AUTHORIZED");
    const verified = highlevelCapabilities({
      connected: true,
      scopes: ["contacts.readonly"],
      verifiedKeys: ["contacts"],
    });
    expect(verified.find((row) => row.key === "contacts")?.status).toBe("CONNECTED");
    expect(highlevelCapabilities({ connected: false, scopes: [] })[0]?.status).toBe("NOT_CONFIGURED");
  });

  it("keeps every previous channel catalog entry and adds HighLevel", () => {
    const keys = INTEGRATION_PROVIDERS.map((row) => row.key);
    expect(keys).toContain("highlevel");
    expect(keys).toContain("google_ads");
    expect(keys).toContain("google_business_profile");
    expect(keys).toContain("facebook");
    expect(keys).toContain("sms");
    expect(keys).toContain("email");
    expect(getProvider("highlevel")?.family).toBe("highlevel");
  });

  it("maps HighLevel sources without inventing new attribution", () => {
    expect(highlevelLeadSource("Facebook Lead Form")).toBe("FACEBOOK");
    expect(highlevelLeadSource("Google Ads")).toBe("GOOGLE_ADS");
    expect(highlevelLeadSource("Missed call")).toBe("PHONE");
    expect(highlevelLeadSource("unknown-widget")).toBe("OTHER");
  });

  it("rejects unsigned or garbage webhook signatures", () => {
    expect(verifyHighLevelWebhookSignature({ rawBody: "{}", ghlSignature: "not-valid" })).toBe(false);
    expect(verifyHighLevelWebhookSignature({ rawBody: "{}" })).toBe(false);
  });
});

describe("HighLevel connection, mapping, leads, and webhooks", () => {
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    customerA: "",
    propertyA: "",
    jobA: "",
    historicalJob: "",
    connectionA: "",
    playbookA: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const userA = await prisma.user.create({
      data: {
        email: `hl-a-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Ann",
        lastName: "Owner",
      },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: { businessName: `HL A ${stamp}`, industry: "HVAC", status: "ACTIVE", phone: "8655550100" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `HL B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const customer = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Casey",
        lastName: "Rivera",
        email: "casey@865hvac.test",
        phone: "(865) 555-0199",
        status: "ACTIVE",
      },
    });
    ids.customerA = customer.id;
    const property = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        address: "100 Oak St",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
      },
    });
    ids.propertyA = property.id;
    const job = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        propertyId: property.id,
        jobNumber: `JOB-HL-${stamp}`,
        status: "SCHEDULED",
      },
    });
    ids.jobA = job.id;
    const historical = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        propertyId: property.id,
        jobNumber: `JOB-HL-HIST-${stamp}`,
        status: "COMPLETED",
        importMode: "HISTORICAL",
        sourceSystem: "SERVICE_TITAN",
      },
    });
    ids.historicalJob = historical.id;

    const playbook = await prisma.playbook.create({
      data: { companyId: companyA.id, name: "HL Service", status: "ACTIVE", sortOrder: 1 },
    });
    const definition = getStarterTemplate("residential_service")!.definition;
    const version = await prisma.playbookVersion.create({
      data: {
        companyId: companyA.id,
        playbookId: playbook.id,
        versionNumber: 1,
        definition,
        createdById: userA.id,
      },
    });
    await prisma.playbook.update({
      where: { id: playbook.id },
      data: { currentVersionId: version.id },
    });
    ids.playbookA = playbook.id;
    await assignPlaybookToJob({ companyId: companyA.id, jobId: job.id, playbookId: playbook.id });
    await assignPlaybookToJob({ companyId: companyA.id, jobId: historical.id, playbookId: playbook.id });

    const connection = await upsertConnection({
      companyId: companyA.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      accountLabel: "865 HVAC",
      externalAccountId: "loc_865_hvac",
      scopes: ["private_token"],
      healthMessage: "Test connection",
    });
    ids.connectionA = connection.id;
    await saveConnectionTokens({
      companyId: companyA.id,
      connectionId: connection.id,
      tokens: { accessToken: "hl-secret-token-do-not-log", scopes: ["private_token"] },
    });
  });

  afterAll(async () => {
    const companyIds = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.communicationMessage.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.communicationThread.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.callRecord.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.providerIdentityMap.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationSync.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationCredential.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationConnection.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.leadActivity.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.lead.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.jobWorkflowEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.jobChecklistItem.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.jobPlaybookSnapshot.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.playbookVersion.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.playbook.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.property.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("A. company can connect a HighLevel location", async () => {
    const connection = await getCompanyConnection(ids.companyA, HIGHLEVEL_PROVIDER_KEY);
    expect(connection?.status).toBe("CONNECTED");
    expect(connection?.externalAccountId).toBe("loc_865_hvac");
    expect(connection?.accountLabel).toBe("865 HVAC");
  });

  it("B. connection is tenant scoped", async () => {
    const a = await getCompanyConnection(ids.companyA, HIGHLEVEL_PROVIDER_KEY);
    const b = await getCompanyConnection(ids.companyB, HIGHLEVEL_PROVIDER_KEY);
    expect(a?.id).toBe(ids.connectionA);
    expect(b).toBeNull();
  });

  it("C. company A cannot access company B location and location resolution stays tenant-bound", async () => {
    const resolved = await resolveHighLevelConnectionByLocation(prisma, "loc_865_hvac");
    expect(resolved?.companyId).toBe(ids.companyA);
    const hijack = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.companyB, externalAccountId: "loc_865_hvac" },
    });
    expect(hijack).toBeNull();
    const bTokens = await getValidAccessToken({
      companyId: ids.companyB,
      connectionId: ids.connectionA,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
    });
    expect(bTokens).toBeNull();
  });

  it("D. tokens are encrypted at rest and never stored as plaintext", async () => {
    const stored = await prisma.integrationCredential.findFirst({
      where: { companyId: ids.companyA, connectionId: ids.connectionA },
    });
    expect(stored).toBeTruthy();
    const blob = Buffer.concat([Buffer.from(stored!.ciphertext), Buffer.from(stored!.iv)]);
    expect(blob.includes(Buffer.from("hl-secret-token-do-not-log"))).toBe(false);
    const decoded = decryptProviderTokens({
      ciphertext: Buffer.from(stored!.ciphertext),
      iv: Buffer.from(stored!.iv),
      authTag: Buffer.from(stored!.authTag),
      keyVersion: stored!.keyVersion,
    });
    expect(decoded.accessToken).toBe("hl-secret-token-do-not-log");
    const roundTrip = encryptProviderTokens({ accessToken: "another-secret" });
    expect(roundTrip.ciphertext.includes(Buffer.from("another-secret"))).toBe(false);
  });

  it("E. contact maps to existing customer by external ID", async () => {
    await mapContactToCustomer(prisma, {
      companyId: ids.companyA,
      customerId: ids.customerA,
      contactId: "hl_contact_casey",
    });
    const match = await matchHighLevelContact(prisma, {
      companyId: ids.companyA,
      contactId: "hl_contact_casey",
      email: "other@example.com",
      phone: "0000000000",
      name: "Someone Else",
    });
    expect(match.kind).toBe("external_id");
    expect(match.customerId).toBe(ids.customerA);
  });

  it("F. conservative phone and email matching works", async () => {
    const byEmail = await matchHighLevelContact(prisma, {
      companyId: ids.companyA,
      email: "Casey@865hvac.test",
      name: "Casey Rivera",
    });
    expect(byEmail.kind).toBe("email");
    expect(byEmail.customerId).toBe(ids.customerA);
    const byPhone = await matchHighLevelContact(prisma, {
      companyId: ids.companyA,
      phone: "8655550199",
      name: "Casey Rivera",
    });
    expect(byPhone.kind).toBe("phone");
    expect(byPhone.customerId).toBe(ids.customerA);
  });

  it("G. name-only match does not auto-merge", async () => {
    const match = await matchHighLevelContact(prisma, {
      companyId: ids.companyA,
      name: "Casey Rivera",
    });
    expect(match.kind).toBe("name_only_ignored");
    expect(match.customerId).toBeNull();
  });

  it("H and I. duplicate webhook does not duplicate a HighLevel lead", async () => {
    const payload = {
      type: "ContactCreate",
      webhookId: "wh_lead_1",
      locationId: "loc_865_hvac",
      id: "hl_new_lead_1",
      firstName: "Pat",
      lastName: "New",
      email: "pat-new@example.com",
      phone: "8655550111",
      source: "Website Form",
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
    const leads = await prisma.lead.findMany({
      where: { companyId: ids.companyA, provider: HIGHLEVEL_PROVIDER_KEY, externalLeadId: "hl_new_lead_1" },
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]?.source).toBe("WEBSITE");
  });

  it("J. existing customer receives the correct external mapping from a matching webhook", async () => {
    await processHighLevelWebhook(prisma, {
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      payload: {
        type: "ContactUpdate",
        webhookId: "wh_casey_update",
        locationId: "loc_865_hvac",
        id: "hl_contact_casey",
        email: "casey@865hvac.test",
        firstName: "Casey",
        lastName: "Rivera",
      },
    });
    const mapped = await prisma.providerIdentityMap.findFirst({
      where: {
        companyId: ids.companyA,
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: ids.customerA,
      },
    });
    expect(mapped?.externalId).toBe("hl_contact_casey");
  });

  it("K and L. SMS uses HighLevel when connected and does not also send Twilio", async () => {
    expect(await resolveCommunicationProvider(ids.companyA)).toBe("highlevel");
    const previousTwilio = {
      sid: process.env.TWILIO_ACCOUNT_SID,
      token: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_FROM_NUMBER,
    };
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_AUTH_TOKEN = "twilio-token";
    process.env.TWILIO_FROM_NUMBER = "+18655550100";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url.includes("api.twilio.com")).toBe(false);
      return {
        ok: true,
        status: 200,
        json: async () => ({ contact: { id: "hl_contact_casey" }, messageId: "msg_1" }),
      } as Response;
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const result = await sendCompanyCommunication({
        companyId: ids.companyA,
        channel: "SMS",
        to: "8655550199",
        body: "On my way.",
        customerId: ids.customerA,
      });
      expect(result.provider).toBe("highlevel");
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      process.env.TWILIO_ACCOUNT_SID = previousTwilio.sid;
      process.env.TWILIO_AUTH_TOKEN = previousTwilio.token;
      process.env.TWILIO_FROM_NUMBER = previousTwilio.from;
    }
  });

  it("M. imported historical jobs do not trigger HighLevel messages", async () => {
    const result = await maybeSendOnMyWayMessage({
      companyId: ids.companyA,
      jobId: ids.historicalJob,
      actorId: ids.userA,
      actorFirstName: "Ann",
      actorLastName: "Owner",
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("historical");
  });

  it("N and O. On My Way requests one communication and does not pretend a failed send succeeded", async () => {
    const originalFetch = globalThis.fetch;
    let sends = 0;
    globalThis.fetch = (async () => {
      sends += 1;
      return {
        ok: false,
        status: 500,
        json: async () => ({ message: "HighLevel rejected the SMS." }),
      } as Response;
    }) as typeof fetch;
    try {
      const failed = await maybeSendOnMyWayMessage({
        companyId: ids.companyA,
        jobId: ids.jobA,
        actorId: ids.userA,
        actorFirstName: "Ann",
        actorLastName: "Owner",
      });
      expect(failed.sent).toBe(false);
      expect(failed.reason).toBe("provider_failed");
      expect(sends).toBeGreaterThan(0);
      const events = await prisma.jobWorkflowEvent.findMany({
        where: { companyId: ids.companyA, jobId: ids.jobA, note: { contains: "sms:" } },
      });
      expect(events).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () => {
      sends += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ contact: { id: "hl_contact_casey" }, messageId: "msg_omy" }),
      } as Response;
    }) as typeof fetch;
    try {
      sends = 0;
      const first = await maybeSendOnMyWayMessage({
        companyId: ids.companyA,
        jobId: ids.jobA,
        actorId: ids.userA,
        actorFirstName: "Ann",
        actorLastName: "Owner",
      });
      const second = await maybeSendOnMyWayMessage({
        companyId: ids.companyA,
        jobId: ids.jobA,
        actorId: ids.userA,
        actorFirstName: "Ann",
        actorLastName: "Owner",
      });
      expect(first.sent).toBe(true);
      expect(second.sent).toBe(false);
      expect(second.reason).toBe("already_sent");
      expect(sends).toBeLessThan(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("P. disconnect preserves ContractorYou operational history", async () => {
    await deleteConnectionCredentials(ids.companyA, ids.connectionA);
    await upsertConnection({
      companyId: ids.companyA,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "DISABLED",
      healthMessage: "Disconnected. ContractorYou customers, jobs, and invoices were not changed.",
    });
    const customer = await prisma.customer.findFirst({ where: { id: ids.customerA, companyId: ids.companyA } });
    const job = await prisma.job.findFirst({ where: { id: ids.jobA, companyId: ids.companyA } });
    const historical = await prisma.job.findFirst({ where: { id: ids.historicalJob, companyId: ids.companyA } });
    const creds = await prisma.integrationCredential.findFirst({
      where: { companyId: ids.companyA, connectionId: ids.connectionA },
    });
    expect(customer?.email).toBe("casey@865hvac.test");
    expect(job?.jobNumber).toContain("JOB-HL-");
    expect(historical?.importMode).toBe("HISTORICAL");
    expect(creds).toBeNull();
    await upsertConnection({
      companyId: ids.companyA,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      externalAccountId: "loc_865_hvac",
      scopes: ["private_token"],
    });
    await saveConnectionTokens({
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      tokens: { accessToken: "hl-secret-token-do-not-log", refreshToken: "hl-refresh", expiresAt: new Date(Date.now() - 60_000).toISOString(), scopes: ["private_token"] },
    });
  });

  it("Q. reauthorization state is recorded when refresh fails", async () => {
    const spy = vi.spyOn(highlevelOAuth, "refreshHighLevelToken").mockRejectedValue(new Error("expired"));
    const tokens = await getValidAccessToken({
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
    });
    expect(tokens).toBeNull();
    const connection = await prisma.integrationConnection.findFirst({
      where: { id: ids.connectionA, companyId: ids.companyA },
    });
    expect(connection?.status).toBe("REAUTH_REQUIRED");
    spy.mockRestore();
    await upsertConnection({
      companyId: ids.companyA,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      externalAccountId: "loc_865_hvac",
      scopes: ["private_token"],
    });
    await saveConnectionTokens({
      companyId: ids.companyA,
      connectionId: ids.connectionA,
      tokens: { accessToken: "hl-secret-token-do-not-log", scopes: ["private_token"] },
    });
  });

  it("R. large contact sets use pagination", async () => {
    let pages = 0;
    const spy = vi.spyOn(highlevelClient, "searchHighLevelContacts").mockImplementation(async (input) => {
      pages += 1;
      if (!input.startAfterId) {
        return {
          contacts: [{ id: "c1", firstName: "A", lastName: "One", email: "a1@example.com" }],
          meta: { startAfterId: "c1" },
        };
      }
      if (input.startAfterId === "c1") {
        return {
          contacts: [{ id: "c2", firstName: "B", lastName: "Two", phone: "8655550002" }],
          meta: { startAfterId: "c2" },
        };
      }
      return { contacts: [] };
    });
    const preview = await previewHighLevelContactSync(prisma, ids.companyA);
    expect(pages).toBeGreaterThan(1);
    expect(preview.contactsFound).toBe(2);
    spy.mockRestore();
  });

  it("S. existing Stripe payment flow is untouched by HighLevel", async () => {
    const { collectedAmountCents } = await import("@/lib/payments/record");
    expect(collectedAmountCents({ status: "SUCCEEDED", amountCents: 5000, refundedCents: 0 })).toBe(5000);
  });

  it("T. imported historical jobs remain intact after HighLevel activity", async () => {
    const historical = await prisma.job.findFirst({ where: { id: ids.historicalJob, companyId: ids.companyA } });
    expect(historical?.importMode).toBe("HISTORICAL");
    expect(historical?.sourceSystem).toBe("SERVICE_TITAN");
    expect(historical?.status).toBe("COMPLETED");
  });

  it("U. Resend remains the platform email provider", async () => {
    expect(emailConfigured()).toBe(Boolean(process.env.RESEND_API_KEY?.trim()));
    const previous = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const result = await sendTransactionalEmail({
      to: "owner@example.com",
      subject: "Invite",
      html: "<p>Invite</p>",
      text: "Invite",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.configured).toBe(false);
    process.env.RESEND_API_KEY = previous;
  });

  it("HighLevel-managed channels do not require direct Google or Twilio OAuth", async () => {
    const cards = await getChannelCards(ids.companyA);
    const facebook = cards.find((card) => card.provider.key === "facebook");
    const sms = cards.find((card) => card.provider.key === "sms");
    const google = cards.find((card) => card.provider.key === "google_ads");
    expect(facebook?.managedThroughHighLevel).toBe(true);
    expect(sms?.managedThroughHighLevel).toBe(true);
    expect(facebook?.action).toBe("MANAGE");
    expect(sms?.action).toBe("MANAGE");
    expect(getProviderEnv("google_ads").missing.includes("GOOGLE_CLIENT_ID") || getProviderEnv("google_ads").configured).toBe(true);
    expect(google?.provider.key).toBe("google_ads");
  });

  it("duplicate conversation events do not duplicate call records", async () => {
    const first = await upsertConversationMessage(prisma, {
      companyId: ids.companyA,
      conversationId: "conv_1",
      messageId: "call_1",
      contactId: "hl_contact_casey",
      phone: "8655550199",
      kind: "CALL",
      channel: "CALL",
      direction: "inbound",
      callStatus: "voicemail",
      occurredAt: new Date("2026-09-01T12:00:00Z"),
    });
    await upsertConversationMessage(prisma, {
      companyId: ids.companyA,
      conversationId: "conv_1",
      messageId: "call_1",
      contactId: "hl_contact_casey",
      phone: "8655550199",
      kind: "CALL",
      channel: "CALL",
      direction: "inbound",
      callStatus: "voicemail",
      occurredAt: new Date("2026-09-01T12:00:00Z"),
    });
    const calls = await prisma.callRecord.findMany({
      where: { companyId: ids.companyA, recordingRef: "call_1" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.missed).toBe(true);
    expect(first.customerId).toBe(ids.customerA);
  });
});
