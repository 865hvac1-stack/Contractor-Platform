import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { QBO_HISTORICAL_CATEGORIES, previewQuickBooksHistorical } from "@/lib/quickbooks/historical-import";
import { QBO_RESET_CONFIRMATION } from "@/lib/imports/provenance";
import { ENTITY_DEFAULT_ITEM, ENTITY_SERVICE_ITEM } from "@/lib/quickbooks/mappings";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import {
  decideQboHistoricalCustomer,
  decideQboHistoricalInvoice,
  decideQboHistoricalPayment,
  dryRunQuickBooksHistoricalReset,
  executeQuickBooksHistoricalReset,
  historicalImportMappingMetadata,
  isProtectedLiveMappingType,
  isQuickBooksHistoricalImportRecord,
  mappingEligibleForHistoricalDelete,
  realmMismatch,
} from "@/lib/quickbooks/historical-reset";

describe("quickbooks historical reset eligibility", () => {
  it("identifies historical QuickBooks invoices and payments from importer provenance only", () => {
    expect(
      isQuickBooksHistoricalImportRecord({ sourceSystem: "QUICKBOOKS", importMode: "HISTORICAL" })
    ).toBe(true);
    expect(
      isQuickBooksHistoricalImportRecord({ sourceSystem: "QUICKBOOKS", importMode: "REFERENCE" })
    ).toBe(true);
    expect(decideQboHistoricalInvoice({
      sourceSystem: "QUICKBOOKS",
      importMode: "HISTORICAL",
      hasStripePayment: false,
      hasPreservedPayment: false,
      attachedToLiveJob: false,
    }).action).toBe("delete");
    expect(decideQboHistoricalPayment({
      sourceSystem: "QUICKBOOKS",
      importMode: "HISTORICAL",
      provider: "QUICKBOOKS",
    }).action).toBe("delete");
  });

  it("does not treat native ContractorYou invoices or payments as historical import data", () => {
    expect(isQuickBooksHistoricalImportRecord({ sourceSystem: null, importMode: "LIVE" })).toBe(false);
    expect(decideQboHistoricalInvoice({
      sourceSystem: null,
      importMode: "LIVE",
      hasStripePayment: false,
      hasPreservedPayment: false,
      attachedToLiveJob: false,
    }).action).toBe("skip");
    expect(decideQboHistoricalPayment({
      sourceSystem: null,
      importMode: "LIVE",
      provider: "MANUAL",
    }).action).toBe("skip");
  });

  it("never treats a QuickBooks mapping alone as deletion evidence", () => {
    expect(
      mappingEligibleForHistoricalDelete({
        entityType: "INVOICE",
        internalId: "native-inv",
        metadata: { historicalImport: false },
        deletedIds: {
          customers: new Set(),
          invoices: new Set(),
          payments: new Set(),
          expenses: new Set(),
        },
      })
    ).toBe(false);
  });

  it("preserves Stripe payments and native customers / mixed customers", () => {
    expect(decideQboHistoricalPayment({
      sourceSystem: "QUICKBOOKS",
      importMode: "HISTORICAL",
      provider: "STRIPE",
    }).action).toBe("skip");
    expect(decideQboHistoricalCustomer({
      sourceSystem: null,
      importMode: "LIVE",
      hasLiveRelationship: false,
    }).action).toBe("skip");
    expect(decideQboHistoricalCustomer({
      sourceSystem: "QUICKBOOKS",
      importMode: "HISTORICAL",
      hasLiveRelationship: true,
    }).action).toBe("mixed");
  });

  it("blocks realm mismatches and does not guess when a stored realm disagrees", () => {
    expect(realmMismatch("sandbox-1", "prod-865")).toBe(true);
    expect(realmMismatch(null, "sandbox-1")).toBe(false);
    expect(realmMismatch("sandbox-1", "sandbox-1")).toBe(false);
    expect(decideQboHistoricalInvoice({
      sourceSystem: "QUICKBOOKS",
      importMode: "HISTORICAL",
      mappingRealmId: "other-realm",
      currentRealmId: "current-realm",
      hasStripePayment: false,
      hasPreservedPayment: false,
      attachedToLiveJob: false,
    }).action).toBe("block");
  });

  it("protects DEFAULT_ITEM and SERVICE_ITEM live mappings", () => {
    expect(isProtectedLiveMappingType(ENTITY_DEFAULT_ITEM)).toBe(true);
    expect(isProtectedLiveMappingType(ENTITY_SERVICE_ITEM)).toBe(true);
    expect(
      mappingEligibleForHistoricalDelete({
        entityType: ENTITY_DEFAULT_ITEM,
        internalId: "default",
        metadata: historicalImportMappingMetadata({ realmId: "x" }),
        deletedIds: {
          customers: new Set(["default"]),
          invoices: new Set(),
          payments: new Set(),
          expenses: new Set(),
        },
      })
    ).toBe(false);
  });

  it("blocks historical invoices that would cascade-delete a native or Stripe payment", () => {
    expect(decideQboHistoricalInvoice({
      sourceSystem: "QUICKBOOKS",
      importMode: "HISTORICAL",
      hasStripePayment: true,
      hasPreservedPayment: false,
      attachedToLiveJob: false,
    }).action).toBe("block");
    expect(decideQboHistoricalInvoice({
      sourceSystem: "QUICKBOOKS",
      importMode: "HISTORICAL",
      hasStripePayment: false,
      hasPreservedPayment: true,
      attachedToLiveJob: false,
    }).action).toBe("block");
  });

  it("keeps the historical importer workflow available after reset tooling is added", () => {
    expect(QBO_RESET_CONFIRMATION).toBe("DELETE QUICKBOOKS HISTORY");
    expect(QBO_HISTORICAL_CATEGORIES).toEqual(["customers", "invoices", "payments", "items", "expenses"]);
  });
});

const dbConfigured = Boolean(process.env.DATABASE_URL);

describe.skipIf(!dbConfigured)("quickbooks historical reset database safety", () => {
  const prisma = new PrismaClient();
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    nativeCustomer: "",
    mixedCustomer: "",
    qboOnlyCustomer: "",
    unknownCustomer: "",
    otherTenantCustomer: "",
    nativeJob: "",
    nativeInvoice: "",
    nativePayment: "",
    stripePayment: "",
    historicalInvoice: "",
    historicalPayment: "",
    mismatchedInvoice: "",
    historicalRef: "",
    connectionId: "",
  };

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new Error("Postgres unavailable — DB-backed QuickBooks reset tests did not run.");
    }
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const userA = await prisma.user.create({
      data: { email: `qbo-reset-a-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "A" },
    });
    const userB = await prisma.user.create({
      data: { email: `qbo-reset-b-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "B" },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: {
        businessName: `QBO Reset A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: userA.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `QBO Reset B ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: userB.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const native = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "TJ", lastName: "Hurst", email: "tj-qbo-reset@test.local", importMode: "LIVE" },
    });
    const mixed = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Mixed",
        lastName: "Qbo",
        email: "mixed-qbo@test.local",
        sourceSystem: "QUICKBOOKS",
        externalId: "qbo-mixed",
        importMode: "HISTORICAL",
      },
    });
    const qboOnly = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Sandbox",
        lastName: "Only",
        email: "qbo-only@test.local",
        sourceSystem: "QUICKBOOKS",
        externalId: "qbo-only",
        importMode: "HISTORICAL",
      },
    });
    const unknown = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Unknown", lastName: "History", importMode: "HISTORICAL" },
    });
    const otherTenant = await prisma.customer.create({
      data: {
        companyId: companyB.id,
        firstName: "Other",
        lastName: "Tenant",
        sourceSystem: "QUICKBOOKS",
        importMode: "HISTORICAL",
      },
    });
    ids.nativeCustomer = native.id;
    ids.mixedCustomer = mixed.id;
    ids.qboOnlyCustomer = qboOnly.id;
    ids.unknownCustomer = unknown.id;
    ids.otherTenantCustomer = otherTenant.id;

    const nativeProperty = await prisma.property.create({
      data: { companyId: companyA.id, customerId: native.id, address: "1 Live St", city: "Knoxville", state: "TN", zip: "37902" },
    });
    const mixedProperty = await prisma.property.create({
      data: { companyId: companyA.id, customerId: mixed.id, address: "2 Mix St", city: "Knoxville", state: "TN", zip: "37902" },
    });
    const nativeJob = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: mixed.id,
        propertyId: mixedProperty.id,
        jobNumber: `QBO-LIVE-${stamp}`,
        status: "SCHEDULED",
        importMode: "LIVE",
      },
    });
    const isolatedJob = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: native.id,
        propertyId: nativeProperty.id,
        jobNumber: `QBO-NATIVE-${stamp}`,
        status: "COMPLETED",
        importMode: "LIVE",
      },
    });
    ids.nativeJob = isolatedJob.id;

    const nativeInvoice = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: native.id,
        jobId: isolatedJob.id,
        invoiceNumber: `INV-00001-${stamp}`,
        status: "PAID",
        totalCents: 1000,
        amountPaidCents: 1000,
        importMode: "LIVE",
      },
    });
    ids.nativeInvoice = nativeInvoice.id;
    const nativePayment = await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: nativeInvoice.id,
        amountCents: 1000,
        provider: "MANUAL",
        providerPaymentId: `manual_${stamp}`,
        status: "RECORDED",
        importMode: "LIVE",
      },
    });
    const stripePayment = await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: nativeInvoice.id,
        amountCents: 1000,
        provider: "STRIPE",
        providerPaymentId: `pi_qbo_${stamp}`,
        status: "SUCCEEDED",
        importMode: "LIVE",
      },
    });
    ids.nativePayment = nativePayment.id;
    ids.stripePayment = stripePayment.id;

    const historicalInvoice = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: native.id,
        invoiceNumber: `QBO-145-${stamp}`,
        status: "PAID",
        totalCents: 25000,
        amountPaidCents: 25000,
        sourceSystem: "QUICKBOOKS",
        externalId: "145",
        importMode: "HISTORICAL",
      },
    });
    const historicalPayment = await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: historicalInvoice.id,
        customerId: native.id,
        amountCents: 25000,
        provider: "QUICKBOOKS",
        providerPaymentId: `qbo-pay-${stamp}`,
        status: "RECORDED",
        sourceSystem: "QUICKBOOKS",
        externalId: "99",
        importMode: "HISTORICAL",
      },
    });
    ids.historicalInvoice = historicalInvoice.id;
    ids.historicalPayment = historicalPayment.id;

    const mismatched = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: qboOnly.id,
        invoiceNumber: `QBO-OTHER-REALM-${stamp}`,
        status: "PAID",
        sourceSystem: "QUICKBOOKS",
        externalId: "realm-mismatch",
        importMode: "HISTORICAL",
      },
    });
    ids.mismatchedInvoice = mismatched.id;

    await prisma.quickBooksMapping.createMany({
      data: [
        { companyId: companyA.id, entityType: "CUSTOMER", internalId: native.id, quickbooksId: "cust-native", status: "SYNCED" },
        { companyId: companyA.id, entityType: "INVOICE", internalId: nativeInvoice.id, quickbooksId: "inv-live", status: "SYNCED" },
        {
          companyId: companyA.id,
          entityType: "INVOICE",
          internalId: historicalInvoice.id,
          quickbooksId: "inv-hist",
          status: "SYNCED",
          metadata: { historicalImport: true },
        },
        {
          companyId: companyA.id,
          entityType: "PAYMENT",
          internalId: historicalPayment.id,
          quickbooksId: "pay-hist",
          status: "SYNCED",
          metadata: { historicalImport: true },
        },
        {
          companyId: companyA.id,
          entityType: "INVOICE",
          internalId: mismatched.id,
          quickbooksId: "inv-other-realm",
          status: "SYNCED",
          metadata: { historicalImport: true, realmId: "future-865-realm" },
        },
        { companyId: companyA.id, entityType: ENTITY_DEFAULT_ITEM, internalId: "default", quickbooksId: "item-1", status: "SYNCED" },
        { companyId: companyA.id, entityType: ENTITY_SERVICE_ITEM, internalId: "svc-1", quickbooksId: "item-2", status: "SYNCED" },
      ],
    });

    const ref = await prisma.importExternalRef.create({
      data: {
        companyId: companyA.id,
        sourceSystem: "QUICKBOOKS",
        recordType: "INVOICES",
        externalId: `qbo-ref-${stamp}`,
        targetRecordId: historicalInvoice.id,
      },
    });
    ids.historicalRef = ref.id;

    const connection = await prisma.integrationConnection.create({
      data: {
        companyId: companyA.id,
        providerKey: QUICKBOOKS_PROVIDER_KEY,
        status: "CONNECTED",
        externalAccountId: "sandbox-realm-1",
        accountLabel: "Sandbox Co",
      },
    });
    ids.connectionId = connection.id;
    await prisma.quickBooksSettings.create({
      data: { companyId: companyA.id, qboCompanyName: "Sandbox Co", appEnvironment: "sandbox" },
    });
    await prisma.communicationThread.create({
      data: {
        companyId: companyA.id,
        provider: "highlevel",
        externalId: `qbo-thread-${stamp}`,
        channel: "SMS",
        customerId: native.id,
        lastActivityAt: new Date(),
      },
    });
    await prisma.billingWatchdogSettings.create({
      data: { companyId: companyA.id, startDate: new Date("2026-09-01"), morningSummaryEnabled: true },
    });
    await prisma.companyAiReceptionistSetting.create({
      data: { companyId: companyA.id, enabled: true, assistantName: "Regina" },
    });
    void nativeJob;
  });

  afterAll(async () => {
    const companyIds = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.importResetOperation.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.importExternalRef.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.billingWatchdogSettings.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.companyAiReceptionistSetting.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.communicationThread.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.quickBooksMapping.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.quickBooksSettings.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.integrationConnection.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.payment.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.invoice.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.property.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "qbo-reset-" } } });
    await prisma.$disconnect();
  });

  it("dry run performs no mutation and counts historical QuickBooks invoices and payments", async () => {
    const beforeInvoices = await prisma.invoice.count({ where: { companyId: ids.companyA } });
    const beforePayments = await prisma.payment.count({ where: { companyId: ids.companyA } });
    const result = await dryRunQuickBooksHistoricalReset({ prisma, companyId: ids.companyA, actorId: ids.userA });
    expect(result.executed).toBe(false);
    expect(result.counts.invoices).toBe(1);
    expect(result.counts.payments).toBe(1);
    expect(result.mixed.some((row) => row.id === ids.mixedCustomer)).toBe(true);
    expect(result.blocked.some((row) => row.id === ids.mismatchedInvoice)).toBe(true);
    expect(await prisma.invoice.count({ where: { companyId: ids.companyA } })).toBe(beforeInvoices);
    expect(await prisma.payment.count({ where: { companyId: ids.companyA } })).toBe(beforePayments);
  });

  it("execute deletes confirmed historical QBO records and preserves live ContractorYou data", async () => {
    await expect(
      executeQuickBooksHistoricalReset({
        prisma,
        companyId: ids.companyA,
        actorId: ids.userA,
        confirmation: "nope",
      })
    ).rejects.toThrow(/Nothing was deleted/);

    const result = await executeQuickBooksHistoricalReset({
      prisma,
      companyId: ids.companyA,
      actorId: ids.userA,
      confirmation: QBO_RESET_CONFIRMATION,
    });
    expect(result.executed).toBe(true);
    expect(await prisma.invoice.findUnique({ where: { id: ids.historicalInvoice } })).toBeNull();
    expect(await prisma.payment.findUnique({ where: { id: ids.historicalPayment } })).toBeNull();
    expect(await prisma.importExternalRef.findUnique({ where: { id: ids.historicalRef } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: ids.nativeInvoice } })).toBeTruthy();
    expect(await prisma.payment.findUnique({ where: { id: ids.nativePayment } })).toBeTruthy();
    expect(await prisma.payment.findUnique({ where: { id: ids.stripePayment } })).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: ids.nativeCustomer } })).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: ids.mixedCustomer } })).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: ids.unknownCustomer } })).toBeTruthy();
    expect(await prisma.job.findUnique({ where: { id: ids.nativeJob } })).toBeTruthy();
    expect(await prisma.invoice.findUnique({ where: { id: ids.mismatchedInvoice } })).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: ids.otherTenantCustomer } })).toBeTruthy();
    expect(await prisma.quickBooksMapping.findFirst({
      where: { companyId: ids.companyA, entityType: "INVOICE", internalId: ids.nativeInvoice },
    })).toBeTruthy();
    expect(await prisma.quickBooksMapping.findFirst({
      where: { companyId: ids.companyA, entityType: ENTITY_DEFAULT_ITEM },
    })).toBeTruthy();
    expect(await prisma.quickBooksMapping.findFirst({
      where: { companyId: ids.companyA, entityType: ENTITY_SERVICE_ITEM },
    })).toBeTruthy();
    expect(await prisma.integrationConnection.findUnique({ where: { id: ids.connectionId } })).toBeTruthy();
    expect(await prisma.quickBooksSettings.findUnique({ where: { companyId: ids.companyA } })).toBeTruthy();
    expect(await prisma.communicationThread.count({ where: { companyId: ids.companyA } })).toBe(1);
    expect(await prisma.billingWatchdogSettings.findUnique({ where: { companyId: ids.companyA } })).toBeTruthy();
    expect(await prisma.companyAiReceptionistSetting.findUnique({ where: { companyId: ids.companyA } })).toBeTruthy();
  });

  it("second reset is idempotent and the historical importer still works", async () => {
    const again = await executeQuickBooksHistoricalReset({
      prisma,
      companyId: ids.companyA,
      actorId: ids.userA,
      confirmation: QBO_RESET_CONFIRMATION,
    });
    expect(again.idempotent).toBe(true);
    expect(again.executed).toBe(false);
    expect(await prisma.invoice.findUnique({ where: { id: ids.nativeInvoice } })).toBeTruthy();
    expect(await prisma.integrationConnection.findUnique({ where: { id: ids.connectionId } })).toBeTruthy();
    const preview = await previewQuickBooksHistorical(prisma, ids.companyA);
    expect(preview.connected).toBe(false);
    expect(QBO_HISTORICAL_CATEGORIES.includes("invoices")).toBe(true);
  });
});
