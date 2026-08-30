import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptSecret, decryptSecret } from "@/lib/integrations/crypto";
import { classifyTrend, percentChange } from "@/lib/intelligence/trends";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";
import { matchCustomerForLead, findDuplicateLead } from "@/lib/leads/matching";
import { getMarketingHubMetrics } from "@/lib/marketing/metrics";
import { can } from "@/lib/permissions";

const prisma = new PrismaClient();

describe("integration credential encryption", () => {
  it("round-trips tokens and never returns plaintext in the blob", () => {
    const secret = "sk-live-example-token-do-not-log";
    const enc = encryptSecret(secret);
    expect(enc.ciphertext.includes(Buffer.from(secret))).toBe(false);
    expect(decryptSecret(enc)).toBe(secret);
  });
});

describe("trend classification", () => {
  it("refuses to label tiny samples", () => {
    expect(classifyTrend({ current: 20, previous: 10, sampleSize: 2 })).toBe("INSUFFICIENT");
  });

  it("labels rising, declining, and stable from sufficient data", () => {
    expect(classifyTrend({ current: 120, previous: 100, sampleSize: 20 })).toBe("RISING");
    expect(classifyTrend({ current: 80, previous: 100, sampleSize: 20 })).toBe("DECLINING");
    expect(classifyTrend({ current: 102, previous: 100, sampleSize: 20 })).toBe("STABLE");
  });

  it("does not invent a percent when previous is zero", () => {
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe("permissions for marketing", () => {
  it("gives owners marketing manage and technicians none", () => {
    expect(can("COMPANY_OWNER", "marketing:manage")).toBe(true);
    expect(can("SALES", "leads:manage")).toBe(true);
    expect(can("TECHNICIAN", "marketing:view")).toBe(false);
  });
});

describe("marketing tenant isolation", () => {
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    userB: "",
    leadA: "",
    insightA: "",
    connectionA: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const userA = await prisma.user.create({
      data: {
        email: `mkt-a-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Ava",
        lastName: "A",
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `mkt-b-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Ben",
        lastName: "B",
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    const companyA = await prisma.company.create({
      data: {
        businessName: `Mkt A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: {
          create: { userId: userA.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() },
        },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Mkt B ${stamp}`,
        industry: "PLUMBING",
        status: "ACTIVE",
        memberships: {
          create: { userId: userB.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() },
        },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const customerA = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Pat",
        lastName: "Owner",
        email: `pat-${stamp}@test.local`,
        phone: "8655550100",
      },
    });

    const leadA = await prisma.lead.create({
      data: {
        companyId: companyA.id,
        firstName: "Lee",
        lastName: "A",
        email: `lee-a-${stamp}@test.local`,
        phone: "8655550100",
        source: "MANUAL",
        status: "NEW",
      },
    });
    ids.leadA = leadA.id;

    const insight = await prisma.insight.create({
      data: {
        companyId: companyA.id,
        insightType: "GROWING",
        category: "MARKETING",
        severity: "INFO",
        title: "Test insight",
        summary: "Must stay in company A",
        dataSource: "lead.count",
        metricDefinition: "New leads in period",
        calculation: "count(leads)",
      },
    });
    ids.insightA = insight.id;

    const connection = await prisma.integrationConnection.create({
      data: {
        companyId: companyA.id,
        providerKey: "google_ads",
        status: "NOT_CONNECTED",
      },
    });
    ids.connectionA = connection.id;

    const match = await matchCustomerForLead(companyA.id, {
      email: customerA.email,
      phone: customerA.phone,
    });
    expect(match?.customer.id).toBe(customerA.id);

    const crossMatch = await matchCustomerForLead(companyB.id, {
      email: customerA.email,
      phone: customerA.phone,
    });
    expect(crossMatch).toBeNull();
  });

  afterAll(async () => {
    const companyIds = [ids.companyA, ids.companyB].filter(Boolean);
    if (companyIds.length) {
      await prisma.leadActivity.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.formSubmission.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.attributionEvent.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.insight.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.integrationCredential.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.integrationConnection.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.lead.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.membership.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    const userIds = [ids.userA, ids.userB].filter(Boolean);
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("Company A cannot read Company B leads, insights, or connections", async () => {
    const leakedLead = await prisma.lead.findFirst({
      where: scopedCompanyWhere(ids.companyB, { id: ids.leadA }),
    });
    expect(leakedLead).toBeNull();

    const leakedInsight = await prisma.insight.findFirst({
      where: scopedCompanyWhere(ids.companyB, { id: ids.insightA }),
    });
    expect(leakedInsight).toBeNull();

    const leakedConnection = await prisma.integrationConnection.findFirst({
      where: scopedCompanyWhere(ids.companyB, { id: ids.connectionA }),
    });
    expect(leakedConnection).toBeNull();
  });

  it("Company B cannot mutate Company A leads", async () => {
    const updated = await prisma.lead.updateMany({
      where: { id: ids.leadA, companyId: ids.companyB },
      data: { status: "WON" },
    });
    expect(updated.count).toBe(0);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadA } });
    expect(lead.status).toBe("NEW");
    expect(lead.companyId).toBe(ids.companyA);
  });

  it("duplicate matching stays inside the company", async () => {
    const dup = await findDuplicateLead(ids.companyA, {
      email: (await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadA } })).email,
    });
    expect(dup?.id).toBe(ids.leadA);

    const other = await findDuplicateLead(ids.companyB, {
      email: (await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadA } })).email,
    });
    expect(other).toBeNull();
  });

  it("hub metrics are zeros, not fabricated channel performance", async () => {
    const metrics = await getMarketingHubMetrics(ids.companyB, "30d");
    expect(metrics.newLeads).toBe(0);
    expect(metrics.bookingRate).toBeNull();
    expect(metrics.attributedRevenueCents).toBeNull();
    expect(metrics.roas).toBeNull();
    expect(metrics.missedCalls).toBeNull();
    expect(metrics.reviewsGenerated).toBeNull();
  });
});
