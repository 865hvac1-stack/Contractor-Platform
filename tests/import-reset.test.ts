import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { buildIdentityIndex, resolveCanonicalCustomer } from "@/lib/imports/identity";
import { classifyProvenance, isAuthoritativeHousecallPro, HCP_RESET_CONFIRMATION } from "@/lib/imports/provenance";
import { isNonOperationalImport, operationalRecordWhere } from "@/lib/imports/modes";
import { readyToInvoiceWhere } from "@/lib/finance/definitions";
import { getJobBillingReadiness } from "@/lib/billing-watchdog/readiness";
import { evaluateInvoiceEligibility } from "@/lib/quickbooks/eligibility";
import { dryRunHousecallProReset, executeHousecallProReset, canManageImportReset } from "@/lib/imports/reset";
import { detectDuplicate, buildCustomerIndex } from "@/lib/imports/duplicates";
import { matchCustomerFromIndex, type CompanyLinkIndex } from "@/lib/imports/resolve";

describe("provenance is authoritative", () => {
  it("identifies Housecall Pro only from source, session, or external ref", () => {
    expect(isAuthoritativeHousecallPro({ sourceSystem: "HOUSECALL_PRO" })).toBe(true);
    expect(isAuthoritativeHousecallPro({ importSessionSource: "HOUSECALL_PRO" })).toBe(true);
    expect(isAuthoritativeHousecallPro({ hasHousecallProRef: true })).toBe(true);
    expect(isAuthoritativeHousecallPro({ importMode: "HISTORICAL" })).toBe(false);
    expect(classifyProvenance({ importMode: "HISTORICAL" })).toBe("UNKNOWN");
    expect(classifyProvenance({ sourceSystem: null, importMode: "LIVE" })).toBe("NATIVE_LIVE");
    expect(classifyProvenance({ provider: "STRIPE" })).toBe("STRIPE");
    expect(classifyProvenance({ sourceSystem: "QUICKBOOKS" })).toBe("QUICKBOOKS");
  });
});

describe("customer identity matching", () => {
  const index = buildIdentityIndex([
    {
      id: "c1",
      firstName: "TJ",
      lastName: "Hurst",
      email: "tj@865hvac.com",
      phone: "(865) 555-0100",
      properties: [{ address: "10 Oak St", city: "Knoxville", zip: "37902" }],
    },
  ]);

  it("auto-matches verified email or phone plus name", () => {
    expect(resolveCanonicalCustomer(index, { email: "tj@865hvac.com" }).confidence).toBe("AUTO_MATCH");
    expect(resolveCanonicalCustomer(index, { phone: "8655550100", lastName: "Hurst", firstName: "TJ" }).confidence).toBe(
      "AUTO_MATCH"
    );
  });

  it("sends name-only and phone-only matches to review", () => {
    expect(resolveCanonicalCustomer(index, { firstName: "TJ", lastName: "Hurst" }).confidence).toBe("REVIEW");
    expect(resolveCanonicalCustomer(index, { phone: "8655550100" }).confidence).toBe("REVIEW");
  });

  it("creates a new customer when there is no strong identity", () => {
    expect(resolveCanonicalCustomer(index, { firstName: "Nobody", lastName: "Here" }).confidence).toBe("NEW");
  });

  it("keeps import duplicate detection on the same rules", () => {
    const existing = buildCustomerIndex([
      {
        id: "c1",
        firstName: "Existing",
        lastName: "Person",
        businessName: null,
        email: "dup@example.com",
        phone: "(423) 555-7777",
        sourceSystem: null,
        externalId: null,
        properties: [],
      },
    ]);
    const hit = detectDuplicate(
      {
        firstName: "Existing",
        lastName: "Person",
        businessName: null,
        email: "dup@example.com",
        phone: "(423) 555-7777",
        secondaryPhone: null,
        notes: null,
        tags: [],
        source: null,
        status: "ACTIVE",
        externalId: null,
        properties: [],
        extras: {},
      },
      existing
    );
    expect(hit.verdict).toBe("EXACT_MATCH");
    const nameOnly = detectDuplicate(
      {
        firstName: "Existing",
        lastName: "Person",
        businessName: null,
        email: null,
        phone: null,
        secondaryPhone: null,
        notes: null,
        tags: [],
        source: null,
        status: "ACTIVE",
        externalId: null,
        properties: [],
        extras: {},
      },
      existing
    );
    expect(nameOnly.verdict).toBe("NEEDS_REVIEW");
  });
});

describe("historical isolation", () => {
  it("keeps Ready to Invoice on live jobs only", () => {
    const where = readyToInvoiceWhere("co1");
    expect(where.importMode).toEqual({ notIn: ["HISTORICAL", "REFERENCE"] });
    expect(where.status).toBe("COMPLETED");
  });

  it("does not treat historical jobs as billing-ready or watchdog work", () => {
    const readiness = getJobBillingReadiness({
      id: "job1",
      jobNumber: "JOB-1",
      status: "COMPLETED",
      importMode: "HISTORICAL",
      customerId: "c1",
      invoices: [],
    });
    expect(readiness.state).toBe("NOT_REQUIRED");
    expect(isNonOperationalImport("REFERENCE")).toBe(true);
    expect(operationalRecordWhere()).toEqual({ importMode: { notIn: ["HISTORICAL", "REFERENCE"] } });
  });

  it("does not push historical QuickBooks invoices back to QBO", () => {
    const eligibility = evaluateInvoiceEligibility(
      {
        id: "inv1",
        invoiceNumber: "145",
        status: "PAID",
        issueDate: new Date(),
        importMode: "HISTORICAL",
      },
      { mapping: null, syncStartDate: null }
    );
    expect(eligibility.state).toBe("HISTORICAL");
  });

  it("restricts reset execution to owners and platform admins", () => {
    expect(canManageImportReset("COMPANY_OWNER", false)).toBe(true);
    expect(canManageImportReset("ADMIN", false)).toBe(true);
    expect(canManageImportReset("OFFICE", false)).toBe(false);
    expect(canManageImportReset("OFFICE", true)).toBe(true);
  });
});

describe("link matching no longer auto-merges on name", () => {
  it("returns NEEDS_REVIEW for name-only customer links", () => {
    const customer = {
      id: "c1",
      firstName: "Pat",
      lastName: "Smith",
      businessName: null,
      email: "pat@test.local",
      phone: "(865) 555-0100",
      externalId: null,
    };
    const index: CompanyLinkIndex = {
      refs: new Map(),
      customersById: new Map([["c1", customer]]),
      customersByExternalId: new Map(),
      customersByEmail: new Map([["pat@test.local", "c1"]]),
      customers: [customer],
      propertiesByCustomerId: new Map(),
      propertiesByExternalId: new Map(),
      jobsByKey: new Map(),
      estimatesByKey: new Map(),
      invoicesByKey: new Map(),
      team: [],
    };
    expect(matchCustomerFromIndex(index, { email: "pat@test.local" }).verdict).toBe("MATCHED");
    expect(matchCustomerFromIndex(index, { phone: "8655550100" }).verdict).toBe("NEEDS_REVIEW");
    expect(matchCustomerFromIndex(index, { firstName: "Pat", lastName: "Smith" }).verdict).toBe("NEEDS_REVIEW");
  });
});

describe("housecall pro reset safety", () => {
  const prisma = new PrismaClient();
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    nativeCustomer: "",
    mixedCustomer: "",
    hcpCustomer: "",
    unknownCustomer: "",
    nativeJob: "",
    mixedLiveJob: "",
    hcpJob: "",
    nativeInvoice: "",
    stripePayment: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const userA = await prisma.user.create({
      data: { email: `reset-a-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "A" },
    });
    const userB = await prisma.user.create({
      data: { email: `reset-b-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "B" },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: {
        businessName: `Reset A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: userA.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Reset B ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: userB.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const native = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Native", lastName: "Live", email: "native@test.local", importMode: "LIVE" },
    });
    const mixed = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Mixed",
        lastName: "Parent",
        email: "mixed@test.local",
        sourceSystem: "HOUSECALL_PRO",
        externalId: "hcp-mixed",
        importMode: "HISTORICAL",
      },
    });
    const hcp = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Housecall",
        lastName: "Only",
        email: "hcp@test.local",
        sourceSystem: "HOUSECALL_PRO",
        externalId: "hcp-only",
        importMode: "HISTORICAL",
      },
    });
    const unknown = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Unknown",
        lastName: "History",
        importMode: "HISTORICAL",
      },
    });
    const otherTenant = await prisma.customer.create({
      data: {
        companyId: companyB.id,
        firstName: "Other",
        lastName: "Tenant",
        sourceSystem: "HOUSECALL_PRO",
        importMode: "HISTORICAL",
      },
    });
    ids.nativeCustomer = native.id;
    ids.mixedCustomer = mixed.id;
    ids.hcpCustomer = hcp.id;
    ids.unknownCustomer = unknown.id;

    const nativeProperty = await prisma.property.create({
      data: { companyId: companyA.id, customerId: native.id, address: "1 Live St", city: "Knoxville", state: "TN", zip: "37902" },
    });
    const mixedProperty = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: mixed.id,
        address: "2 Mix St",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
        sourceSystem: "HOUSECALL_PRO",
        importMode: "HISTORICAL",
      },
    });
    const hcpProperty = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: hcp.id,
        address: "3 Hcp St",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
        sourceSystem: "HOUSECALL_PRO",
        importMode: "HISTORICAL",
      },
    });
    await prisma.property.create({
      data: { companyId: companyB.id, customerId: otherTenant.id, address: "9 Other St", city: "Knoxville", state: "TN", zip: "37902" },
    });

    const nativeJob = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: native.id,
        propertyId: nativeProperty.id,
        jobNumber: `LIVE-${stamp}`,
        status: "COMPLETED",
        importMode: "LIVE",
      },
    });
    const mixedLiveJob = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: mixed.id,
        propertyId: mixedProperty.id,
        jobNumber: `MIXLIVE-${stamp}`,
        status: "SCHEDULED",
        importMode: "LIVE",
      },
    });
    const hcpJob = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: hcp.id,
        propertyId: hcpProperty.id,
        jobNumber: `HCP-${stamp}`,
        status: "COMPLETED",
        sourceSystem: "HOUSECALL_PRO",
        importMode: "HISTORICAL",
      },
    });
    ids.nativeJob = nativeJob.id;
    ids.mixedLiveJob = mixedLiveJob.id;
    ids.hcpJob = hcpJob.id;

    const invoice = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: native.id,
        jobId: nativeJob.id,
        invoiceNumber: `INV-LIVE-${stamp}`,
        status: "PAID",
        totalCents: 1000,
        amountPaidCents: 1000,
        importMode: "LIVE",
      },
    });
    ids.nativeInvoice = invoice.id;
    const payment = await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: invoice.id,
        amountCents: 1000,
        provider: "STRIPE",
        providerPaymentId: `pi_${stamp}`,
        status: "SUCCEEDED",
        importMode: "LIVE",
      },
    });
    ids.stripePayment = payment.id;
    await prisma.quickBooksMapping.create({
      data: { companyId: companyA.id, entityType: "CUSTOMER", internalId: native.id, quickbooksId: "99", status: "SYNCED" },
    });
    await prisma.communicationThread.create({
      data: {
        companyId: companyA.id,
        provider: "highlevel",
        externalId: `thread-${stamp}`,
        channel: "SMS",
        customerId: native.id,
        lastActivityAt: new Date(),
      },
    });
    await prisma.companyAiReceptionistSetting.create({
      data: { companyId: companyA.id, enabled: true, assistantName: "Regina" },
    });
    await prisma.billingWatchdogSettings.create({
      data: { companyId: companyA.id, startDate: new Date("2026-09-01"), morningSummaryEnabled: true },
    });
  });

  afterAll(async () => {
    await prisma.importResetOperation.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.billingWatchdogSettings.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.companyAiReceptionistSetting.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.communicationThread.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.quickBooksMapping.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.payment.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.invoice.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.job.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.property.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "reset-" } } });
    await prisma.$disconnect();
  });

  it("dry run changes nothing and counts only confirmed Housecall Pro records", async () => {
    const beforeJobs = await prisma.job.count({ where: { companyId: ids.companyA } });
    const result = await dryRunHousecallProReset({ prisma, companyId: ids.companyA, actorId: ids.userA });
    const afterJobs = await prisma.job.count({ where: { companyId: ids.companyA } });
    expect(afterJobs).toBe(beforeJobs);
    expect(result.executed).toBe(false);
    expect(result.counts.jobs).toBe(1);
    expect(result.counts.customers).toBe(1);
    expect(result.mixed.some((row) => row.id === ids.mixedCustomer)).toBe(true);
    expect(await prisma.customer.findUnique({ where: { id: ids.unknownCustomer } })).toBeTruthy();
  });

  it("execute removes confirmed HCP history and preserves live, mixed, stripe, qbo, highlevel, and the other tenant", async () => {
    await expect(
      executeHousecallProReset({
        prisma,
        companyId: ids.companyA,
        actorId: ids.userA,
        confirmation: "nope",
      })
    ).rejects.toThrow(/Nothing was deleted/);

    const result = await executeHousecallProReset({
      prisma,
      companyId: ids.companyA,
      actorId: ids.userA,
      confirmation: HCP_RESET_CONFIRMATION,
    });
    expect(result.executed).toBe(true);
    expect(await prisma.job.findUnique({ where: { id: ids.hcpJob } })).toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: ids.hcpCustomer } })).toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: ids.nativeCustomer } })).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: ids.mixedCustomer } })).toBeTruthy();
    expect(await prisma.job.findUnique({ where: { id: ids.nativeJob } })).toBeTruthy();
    expect(await prisma.job.findUnique({ where: { id: ids.mixedLiveJob } })).toBeTruthy();
    expect(await prisma.invoice.findUnique({ where: { id: ids.nativeInvoice } })).toBeTruthy();
    expect(await prisma.payment.findUnique({ where: { id: ids.stripePayment } })).toBeTruthy();
    expect(await prisma.quickBooksMapping.count({ where: { companyId: ids.companyA } })).toBe(1);
    expect(await prisma.communicationThread.count({ where: { companyId: ids.companyA } })).toBe(1);
    expect(await prisma.companyAiReceptionistSetting.findUnique({ where: { companyId: ids.companyA } })).toBeTruthy();
    expect(await prisma.billingWatchdogSettings.findUnique({ where: { companyId: ids.companyA } })).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: ids.unknownCustomer } })).toBeTruthy();
    expect(await prisma.customer.count({ where: { companyId: ids.companyB, sourceSystem: "HOUSECALL_PRO" } })).toBe(1);
  });

  it("second reset is idempotent", async () => {
    const again = await executeHousecallProReset({
      prisma,
      companyId: ids.companyA,
      actorId: ids.userA,
      confirmation: HCP_RESET_CONFIRMATION,
    });
    expect(again.idempotent).toBe(true);
    expect(again.executed).toBe(false);
    expect(await prisma.customer.findUnique({ where: { id: ids.nativeCustomer } })).toBeTruthy();
  });
});
