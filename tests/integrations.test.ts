import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptProviderTokens, decryptProviderTokens } from "@/lib/integrations/crypto";
import { consumeOAuthState, createOAuthState } from "@/lib/integrations/oauth/state";
import { upsertExternalLead } from "@/lib/integrations/ingest";
import { createLeadFromWebsiteForm, DEFAULT_FORM_FIELDS } from "@/lib/integrations/forms";
import { getProviderEnv } from "@/lib/integrations/env";
import { getProvider } from "@/lib/integrations/catalog";
import { getCompanyConnection } from "@/lib/integrations/store";
import { can } from "@/lib/permissions";

const prisma = new PrismaClient();

describe("integration encryption", () => {
  it("round-trips provider tokens and never stores plaintext fields", () => {
    const stored = encryptProviderTokens({
      accessToken: "tok-live-do-not-log",
      refreshToken: "ref-live-do-not-log",
      scopes: ["email"],
    });
    expect(stored.ciphertext.includes(Buffer.from("tok-live-do-not-log"))).toBe(false);
    const decoded = decryptProviderTokens(stored);
    expect(decoded.accessToken).toBe("tok-live-do-not-log");
    expect(decoded.refreshToken).toBe("ref-live-do-not-log");
  });
});

describe("oauth state", () => {
  it("rejects a reused or unknown state", async () => {
    const company = await prisma.company.create({
      data: { businessName: `OAuth ${Date.now()}`, industry: "HVAC", status: "ACTIVE" },
    });
    const user = await prisma.user.create({
      data: {
        email: `oauth-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash("TestPassword-123!", 10),
        firstName: "O",
        lastName: "Auth",
      },
    });
    const row = await createOAuthState({
      companyId: company.id,
      userId: user.id,
      providerKey: "google_ads",
      codeVerifier: "verifier",
    });
    const first = await consumeOAuthState(row.state);
    const second = await consumeOAuthState(row.state);
    expect(first?.providerKey).toBe("google_ads");
    expect(second).toBeNull();
    expect(await consumeOAuthState("not-a-real-state")).toBeNull();
    await prisma.oAuthState.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe("provider env honesty", () => {
  it("does not claim Google is configured without client credentials", () => {
    const env = getProviderEnv("google_ads");
    if (!process.env.GOOGLE_CLIENT_ID) {
      expect(env.configured).toBe(false);
      expect(env.missing).toContain("GOOGLE_CLIENT_ID");
    }
    expect(getProvider("website_forms")?.internalLive).toBe(true);
    expect(can("TECHNICIAN", "marketing:manage")).toBe(false);
  });
});

describe("integration tenant isolation", () => {
  const ids = { companyA: "", companyB: "", formA: "", userA: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const userA = await prisma.user.create({
      data: {
        email: `int-a-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Ann",
        lastName: "A",
      },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: { businessName: `Int A ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `Int B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    await prisma.integrationConnection.create({
      data: {
        companyId: companyA.id,
        providerKey: "google_ads",
        status: "CONNECTED",
        accountLabel: "A Ads",
      },
    });
    const form = await prisma.websiteForm.create({
      data: {
        companyId: companyA.id,
        name: "Service request",
        slug: `service-${stamp}`,
        fields: DEFAULT_FORM_FIELDS,
      },
    });
    ids.formA = form.id;
  });

  afterAll(async () => {
    await prisma.formSubmission.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.lead.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.websiteForm.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.integrationCredential.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.integrationConnection.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("Company B cannot read Company A connections or forms", async () => {
    const connection = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.companyB, providerKey: "google_ads" },
    });
    const form = await prisma.websiteForm.findFirst({
      where: { id: ids.formA, companyId: ids.companyB },
    });
    expect(connection).toBeNull();
    expect(form).toBeNull();
  });

  it("Company B cannot load Company A credentials or connection via store helpers", async () => {
    const a = await getCompanyConnection(ids.companyA, "google_ads");
    const b = await getCompanyConnection(ids.companyB, "google_ads");
    expect(a?.accountLabel).toBe("A Ads");
    expect(b).toBeNull();
  });

  it("Company B cannot mutate Company A connections", async () => {
    const result = await prisma.integrationConnection.updateMany({
      where: { companyId: ids.companyB, providerKey: "google_ads" },
      data: { accountLabel: "Hijacked" },
    });
    expect(result.count).toBe(0);
  });

  it("website form submissions create a real lead with UTMs", async () => {
    const result = await createLeadFromWebsiteForm({
      formId: ids.formA,
      values: {
        firstName: "Casey",
        lastName: "Rivera",
        phone: "8655550100",
        email: "casey@example.com",
        message: "AC not cooling",
      },
      utm: {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring-tuneup",
        landingPage: "https://example.com/tuneup",
        referrer: "https://google.com",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lead = await prisma.lead.findFirst({
      where: { id: result.leadId, companyId: ids.companyA },
    });
    const leaked = await prisma.lead.findFirst({
      where: { id: result.leadId, companyId: ids.companyB },
    });
    expect(lead?.utmSource).toBe("google");
    expect(lead?.utmCampaign).toBe("spring-tuneup");
    expect(lead?.source).toBe("WEBSITE");
    expect(leaked).toBeNull();
  });

  it("external lead upsert is idempotent per provider id", async () => {
    const first = await upsertExternalLead({
      companyId: ids.companyA,
      provider: "google_lsa",
      externalLeadId: "lsa-1",
      source: "GOOGLE_LSA",
      firstName: "Lee",
      lastName: "Smith",
      phone: "8655550199",
    });
    const second = await upsertExternalLead({
      companyId: ids.companyA,
      provider: "google_lsa",
      externalLeadId: "lsa-1",
      source: "GOOGLE_LSA",
      firstName: "Lee",
      lastName: "Smith",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
  });
});
