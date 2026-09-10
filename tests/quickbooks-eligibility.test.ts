import { describe, expect, it } from "vitest";
import {
  assessInvoicePaymentSafety,
  describeInvoicePaidSource,
  evaluateInvoiceEligibility,
  evaluatePaymentEligibility,
  overpaymentReviewMessage,
  parentInvoiceNotSyncedMessage,
  reviewItemFromPaymentEligibility,
} from "@/lib/quickbooks/eligibility";
import { previewQuickBooksSync } from "@/lib/quickbooks/preview";
import { persistInvoiceMapping } from "@/lib/quickbooks/mappings";
import { syncPaymentToQuickBooks } from "@/lib/quickbooks/sync";
import { syncPaymentWithInvoiceDependency } from "@/lib/quickbooks/engine";
import type { PrismaClient, QuickBooksMapping } from "@prisma/client";
import type { QboTransport } from "@/lib/quickbooks/client";

const start = new Date("2026-09-01");
const inScope = new Date("2026-09-10");
const outOfScope = new Date("2026-08-01");

const invoice00003 = {
  id: "cmtvxeg4k001pp51yr3w5tuak",
  invoiceNumber: "INV-00003",
  status: "PAID",
  issueDate: inScope,
  importMode: "LIVE",
  totalCents: 1000,
};

const invoice00001 = {
  id: "cmthl4qvy000tmw1yajqz22c3",
  invoiceNumber: "INV-00001",
  status: "PAID",
  issueDate: outOfScope,
  importMode: "LIVE",
  totalCents: 1000,
};

function mapping(internalId: string, entityType = "INVOICE", quickbooksId = "145") {
  return { entityType, internalId, quickbooksId, status: "SYNCED" as const };
}

describe("QuickBooks payment eligibility", () => {
  it("1. payment whose parent invoice is already mapped is pending and can sync", () => {
    const result = evaluatePaymentEligibility({
      payment: {
        id: "pay-mapped",
        invoiceId: invoice00003.id,
        paidAt: inScope,
        importMode: "LIVE",
        status: "SUCCEEDED",
        amountCents: 1000,
        provider: "STRIPE",
        providerPaymentId: "pi_1",
      },
      invoice: invoice00003,
      invoiceMapping: mapping(invoice00003.id),
      syncStartDate: start,
    });
    expect(result.state).toBe("PENDING");
    expect(result.canAutoSync).toBe(true);
    expect(result.pending).toBe(true);
  });

  it("2. eligible invoice + eligible payment can sync invoice as a dependency", () => {
    const invoice = { ...invoice00003, id: "inv-new", invoiceNumber: "INV-00004", status: "SENT" };
    const invoiceElig = evaluateInvoiceEligibility(invoice, { syncStartDate: start });
    const paymentElig = evaluatePaymentEligibility({
      payment: {
        id: "pay-new",
        invoiceId: invoice.id,
        paidAt: inScope,
        importMode: "LIVE",
        status: "RECORDED",
        amountCents: 1000,
        provider: "MANUAL",
      },
      invoice,
      syncStartDate: start,
    });
    expect(invoiceElig.canSyncAsDependency).toBe(true);
    expect(invoiceElig.hasValidMapping).toBe(false);
    expect(paymentElig.canAutoSync).toBe(true);
    expect(paymentElig.messages.join(" ")).toMatch(/invoice will sync/i);
  });

  it("3. payment outside cutoff is not queued", () => {
    const result = evaluatePaymentEligibility({
      payment: {
        id: "pay-old",
        invoiceId: invoice00003.id,
        paidAt: outOfScope,
        importMode: "LIVE",
        status: "SUCCEEDED",
        amountCents: 1000,
      },
      invoice: invoice00003,
      invoiceMapping: mapping(invoice00003.id),
      syncStartDate: start,
    });
    expect(result.state).toBe("OUT_OF_SCOPE");
    expect(result.pending).toBe(false);
    expect(result.canAutoSync).toBe(false);
  });

  it("4. payment whose parent invoice is outside cutoff is not normal pending", () => {
    const result = evaluatePaymentEligibility({
      payment: {
        id: "cmthl4tz40010mw1ym62jcatf",
        invoiceId: invoice00001.id,
        paidAt: inScope,
        importMode: "LIVE",
        status: "SUCCEEDED",
        amountCents: 1000,
        provider: "STRIPE",
        providerPaymentId: "pi_inv1",
      },
      invoice: invoice00001,
      siblingPayments: [
        {
          id: "manual-1",
          invoiceId: invoice00001.id,
          paidAt: inScope,
          importMode: "LIVE",
          status: "RECORDED",
          amountCents: 1000,
          provider: "MANUAL",
        },
        {
          id: "cmthl4tz40010mw1ym62jcatf",
          invoiceId: invoice00001.id,
          paidAt: inScope,
          importMode: "LIVE",
          status: "SUCCEEDED",
          amountCents: 1000,
          provider: "STRIPE",
          providerPaymentId: "pi_inv1",
        },
      ],
      syncStartDate: start,
    });
    expect(result.pending).toBe(false);
    expect(result.canAutoSync).toBe(false);
    expect(result.needsReview).toBe(true);
    expect(result.messages).toContain(parentInvoiceNotSyncedMessage("INV-00001"));
    expect(result.messages).toContain(
      overpaymentReviewMessage({
        invoiceNumber: "INV-00001",
        verifiedPaymentCents: 2000,
        invoiceTotalCents: 1000,
      })
    );
  });

  it("5. parent invoice missing QBO mapping but eligible stays pending for dependency sync", () => {
    const invoice = { ...invoice00003, id: "inv-dep", invoiceNumber: "INV-00005", status: "SENT" };
    const result = evaluatePaymentEligibility({
      payment: {
        id: "pay-dep",
        invoiceId: invoice.id,
        paidAt: inScope,
        importMode: "LIVE",
        status: "SUCCEEDED",
        amountCents: 1000,
      },
      invoice,
      syncStartDate: start,
    });
    expect(result.state).toBe("PENDING");
    expect(evaluateInvoiceEligibility(invoice, { syncStartDate: start }).canSyncAsDependency).toBe(true);
  });

  it("6. parent invoice intentionally excluded is not pending", () => {
    const historical = { ...invoice00001, importMode: "HISTORICAL", issueDate: inScope };
    const result = evaluatePaymentEligibility({
      payment: {
        id: "pay-hist",
        invoiceId: historical.id,
        paidAt: inScope,
        importMode: "LIVE",
        status: "SUCCEEDED",
        amountCents: 1000,
      },
      invoice: historical,
      syncStartDate: start,
    });
    expect(result.pending).toBe(false);
    expect(result.canAutoSync).toBe(false);
    expect(result.state).toBe("HISTORICAL");
  });

  it("7. duplicate payment protection flags manual + Stripe for the same $10 invoice", () => {
    const safety = assessInvoicePaymentSafety({
      invoiceNumber: "INV-00001",
      invoiceTotalCents: 1000,
      payments: [
        { id: "manual", status: "RECORDED", amountCents: 1000, provider: "MANUAL" },
        { id: "stripe", status: "SUCCEEDED", amountCents: 1000, provider: "STRIPE", providerPaymentId: "pi_x" },
      ],
      candidatePaymentId: "stripe",
    });
    expect(safety.ok).toBe(false);
    expect(safety.possibleDuplicate).toBe(true);
    expect(safety.code).toBe("possible_duplicate");
    expect(safety.verifiedPaymentCents).toBe(2000);
  });

  it("8. overpayment detection blocks a $20 recorded total on a $10 invoice", () => {
    const safety = assessInvoicePaymentSafety({
      invoiceNumber: "INV-00001",
      invoiceTotalCents: 1000,
      payments: [
        { id: "a", status: "RECORDED", amountCents: 1000, provider: "MANUAL" },
        { id: "b", status: "SUCCEEDED", amountCents: 1000, provider: "STRIPE", providerPaymentId: "pi_y" },
      ],
    });
    expect(safety.ok).toBe(false);
    expect(safety.messages[0]).toBe(
      overpaymentReviewMessage({
        invoiceNumber: "INV-00001",
        verifiedPaymentCents: 2000,
        invoiceTotalCents: 1000,
      })
    );
  });

  it("10. INV-00003-style mapped invoice stays untouched when it has no payment", () => {
    const paid = describeInvoicePaidSource({ amountPaidCents: 1000, payments: [] });
    expect(paid.source).toBe("INVOICE_STATUS_WITHOUT_PAYMENT_RECORD");
    const invoiceElig = evaluateInvoiceEligibility(invoice00003, {
      syncStartDate: start,
      mapping: mapping(invoice00003.id),
    });
    expect(invoiceElig.hasValidMapping).toBe(true);
    expect(invoiceElig.canSyncAsDependency).toBe(false);
  });

  it("11. INV-00001-style orphan payment does not contaminate INV-00003 status", () => {
    const orphan = evaluatePaymentEligibility({
      payment: {
        id: "cmthl4tz40010mw1ym62jcatf",
        invoiceId: invoice00001.id,
        paidAt: inScope,
        importMode: "LIVE",
        status: "SUCCEEDED",
        amountCents: 1000,
        provider: "STRIPE",
        providerPaymentId: "pi_inv1",
      },
      invoice: invoice00001,
      siblingPayments: [
        {
          id: "manual-1",
          invoiceId: invoice00001.id,
          paidAt: inScope,
          status: "RECORDED",
          amountCents: 1000,
          provider: "MANUAL",
          importMode: "LIVE",
        },
        {
          id: "cmthl4tz40010mw1ym62jcatf",
          invoiceId: invoice00001.id,
          paidAt: inScope,
          status: "SUCCEEDED",
          amountCents: 1000,
          provider: "STRIPE",
          providerPaymentId: "pi_inv1",
          importMode: "LIVE",
        },
      ],
      syncStartDate: start,
    });
    const mapped = evaluatePaymentEligibility({
      payment: {
        id: "pay-00003",
        invoiceId: invoice00003.id,
        paidAt: inScope,
        importMode: "LIVE",
        status: "SUCCEEDED",
        amountCents: 1000,
      },
      invoice: invoice00003,
      invoiceMapping: mapping(invoice00003.id),
      syncStartDate: start,
    });
    expect(orphan.invoiceNumber).toBe("INV-00001");
    expect(orphan.needsReview).toBe(true);
    expect(mapped.invoiceNumber).toBe("INV-00003");
    expect(mapped.canAutoSync).toBe(true);
    expect(orphan.invoiceId).not.toBe(mapped.invoiceId);
  });
});

describe("QuickBooks Sync Center payment counts", () => {
  function previewMemory(input: {
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      status: string;
      issueDate: Date;
      importMode: string;
      totalCents: number;
    }>;
    payments: Array<{
      id: string;
      invoiceId: string;
      paidAt: Date;
      importMode: string;
      status: string;
      amountCents: number;
      refundedCents?: number;
      provider?: string;
      providerPaymentId?: string | null;
    }>;
    mappings: Array<{ entityType: string; internalId: string; quickbooksId: string; status: string }>;
  }) {
    return {
      quickBooksSettings: {
        async findUnique() {
          return { syncStartDate: start, syncActivated: true };
        },
      },
      customer: { async findMany() { return [{ id: "cust-1" }]; } },
      invoice: { async findMany() { return input.invoices; } },
      payment: { async findMany() { return input.payments.map((row) => ({ refundedCents: 0, provider: "MANUAL", providerPaymentId: null, ...row })); } },
      expense: { async findMany() { return []; } },
      quickBooksMapping: {
        async findMany() {
          return input.mappings;
        },
      },
    } as unknown as PrismaClient;
  }

  it("shows 0 pending and 1 needs review for the INV-00001 orphan Stripe payment", async () => {
    const preview = await previewQuickBooksSync(
      previewMemory({
        invoices: [invoice00003, invoice00001],
        payments: [
          {
            id: "cmthl4tz40010mw1ym62jcatf",
            invoiceId: invoice00001.id,
            paidAt: inScope,
            importMode: "LIVE",
            status: "SUCCEEDED",
            amountCents: 1000,
            provider: "STRIPE",
            providerPaymentId: "pi_inv1",
          },
          {
            id: "manual-1",
            invoiceId: invoice00001.id,
            paidAt: inScope,
            importMode: "LIVE",
            status: "RECORDED",
            amountCents: 1000,
            provider: "MANUAL",
          },
        ],
        mappings: [mapping(invoice00003.id)],
      }),
      "co-a"
    );
    expect(preview.paymentsSynced).toBe(0);
    expect(preview.paymentsPending).toBe(0);
    expect(preview.paymentsEligible).toBe(0);
    expect(preview.paymentsNeedsReview).toBe(2);
    expect(preview.invoicesSynced).toBe(1);
    expect(preview.paymentReviews[0]?.error).toContain("Payment belongs to INV-00001");
    expect(preview.paymentReviews[0]?.href).toBe(`/invoices/${invoice00001.id}`);
    const review = reviewItemFromPaymentEligibility(preview.paymentReviews[0]!.internalId, preview.paymentEligibility[0]);
    expect(review?.hrefLabel).toMatch(/INV-00001/);
  });
});

function dependencyMemory() {
  const mappings: QuickBooksMapping[] = [];
  const events: unknown[] = [];
  const invoiceCreates: string[] = [];
  const paymentCreates: string[] = [];
  const invoice = {
    id: "inv-dep",
    companyId: "co-a",
    invoiceNumber: "INV-00005",
    status: "SENT",
    balanceCents: 1000,
    amountPaidCents: 0,
    totalCents: 1000,
    issueDate: inScope,
    dueDate: inScope,
    notes: null,
    serviceTypeId: null,
    importMode: "LIVE",
    customer: {
      id: "cust-1",
      firstName: "Pat",
      lastName: "Rivera",
      businessName: "Rivera Home",
      email: "pat@example.com",
      phone: "555-0100",
      externalId: "QB-CUST-1",
      sourceSystem: "quickbooks_online",
    },
    job: { jobNumber: "JOB-1" },
    lineItems: [{ description: "Service call", name: "Service call", quantity: 1, unitPriceCents: 1000 }],
  };
  const payment = {
    id: "pay-dep",
    companyId: "co-a",
    invoiceId: "inv-dep",
    amountCents: 1000,
    paidAt: inScope,
    externalRef: "ref",
    importMode: "LIVE",
    status: "SUCCEEDED",
    provider: "STRIPE",
    providerPaymentId: "pi_dep",
    refundedCents: 0,
    invoice,
  };
  const now = () => new Date();
  const client = {
    company: { async findFirst() { return { isDemo: false }; } },
    invoice: {
      async findFirst({ where }: { where: { id: string; companyId?: string } }) {
        if (where.id !== invoice.id) return null;
        if (where.companyId && where.companyId !== invoice.companyId) return null;
        return invoice;
      },
    },
    payment: {
      async findFirst({ where }: { where: { id: string; companyId: string } }) {
        return where.id === payment.id && where.companyId === payment.companyId ? payment : null;
      },
      async findMany({ where }: { where: { companyId?: string; invoiceId?: string } }) {
        if (where.invoiceId && where.invoiceId !== payment.invoiceId) return [];
        return [payment];
      },
    },
    integrationConnection: {
      async findFirst() { return { externalAccountId: "realm-a" }; },
      async updateMany() { return { count: 1 }; },
    },
    quickBooksSyncEvent: {
      async create({ data }: { data: unknown }) {
        events.push(data);
        return data;
      },
      async findFirst() { return null; },
    },
    quickBooksMapping: {
      async findMany({
        where,
      }: {
        where: { companyId: string; entityType?: string | { in: string[] }; status?: string };
      }) {
        return mappings.filter((row) => {
          if (row.companyId !== where.companyId) return false;
          if (typeof where.entityType === "string" && row.entityType !== where.entityType) return false;
          if (where.entityType && typeof where.entityType === "object" && !where.entityType.in.includes(row.entityType)) {
            return false;
          }
          if (where.status && row.status !== where.status) return false;
          return true;
        });
      },
      async findUnique({
        where,
      }: {
        where: { companyId_entityType_internalId: { companyId: string; entityType: string; internalId: string } };
      }) {
        const key = where.companyId_entityType_internalId;
        return (
          mappings.find(
            (row) =>
              row.companyId === key.companyId && row.entityType === key.entityType && row.internalId === key.internalId
          ) ?? null
        );
      },
      async findFirst({
        where,
      }: {
        where: { companyId: string; entityType: string; internalId?: string };
      }) {
        return (
          mappings.find(
            (row) =>
              row.companyId === where.companyId &&
              row.entityType === where.entityType &&
              (where.internalId ? row.internalId === where.internalId : true)
          ) ?? null
        );
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { companyId_entityType_internalId: { companyId: string; entityType: string; internalId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) {
        const key = where.companyId_entityType_internalId;
        const existing = mappings.find(
          (row) =>
            row.companyId === key.companyId && row.entityType === key.entityType && row.internalId === key.internalId
        );
        if (!existing) {
          const created = {
            id: `map_${mappings.length + 1}`,
            lastSyncedAt: now(),
            syncToken: null,
            createdAt: now(),
            updatedAt: now(),
            lastSyncError: null,
            metadata: null,
            status: "SYNCED",
            ...create,
          } as QuickBooksMapping;
          mappings.push(created);
          return created;
        }
        Object.assign(existing, update, { updatedAt: now() });
        return existing;
      },
    },
  } as unknown as PrismaClient;
  const transport: QboTransport = async ({ path, body }) => {
    if (path === "/query") return { ok: true, status: 200, json: { QueryResponse: {} } };
    if (path === "/customer") return { ok: true, status: 200, json: { Customer: { Id: "QB-CUST-1" } } };
    if (path.startsWith("/invoice/")) {
      return { ok: true, status: 200, json: { Invoice: { Id: path.split("/").pop(), SyncToken: "1", Balance: 10, TotalAmt: 10 } } };
    }
    if (path === "/invoice") {
      invoiceCreates.push("invoice");
      return { ok: true, status: 200, json: { Invoice: { Id: "QB-NEW-1" } } };
    }
    if (path === "/payment") {
      paymentCreates.push("payment");
      return { ok: true, status: 200, json: { Payment: { Id: "QB-PAY-NEW" } } };
    }
    return { ok: true, status: 200, json: { Item: [] } };
  };
  return { client, mappings, invoice, payment, invoiceCreates, paymentCreates, transport, events };
}

describe("QuickBooks dependency-order payment sync", () => {
  it("2b. Sync Now syncs the eligible invoice first, then the payment", async () => {
    const db = dependencyMemory();
    const { persistItemMapping } = await import("@/lib/quickbooks/mappings");
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
      name: "Services",
    });
    const result = await syncPaymentWithInvoiceDependency(db.client, db.transport, {
      companyId: "co-a",
      actorId: "owner",
      paymentId: "pay-dep",
      invoiceId: "inv-dep",
      invoiceCanSyncAsDependency: true,
      invoiceHasValidMapping: false,
    });
    expect(result.ok).toBe(true);
    expect(result.pushedInvoice).toBe(true);
    expect(result.pushedPayment).toBe(true);
    expect(db.invoiceCreates).toHaveLength(1);
    expect(db.paymentCreates).toHaveLength(1);
    expect(db.mappings.some((row) => row.entityType === "INVOICE" && row.quickbooksId === "QB-NEW-1")).toBe(true);
    expect(db.mappings.some((row) => row.entityType === "PAYMENT" && row.quickbooksId === "QB-PAY-NEW")).toBe(true);
  });

  it("6b. never pulls an out-of-scope invoice in just because a payment references it", async () => {
    const db = dependencyMemory();
    const result = await syncPaymentWithInvoiceDependency(db.client, db.transport, {
      companyId: "co-a",
      actorId: "owner",
      paymentId: "pay-dep",
      invoiceId: "inv-dep",
      invoiceCanSyncAsDependency: false,
      invoiceHasValidMapping: false,
    });
    expect(result.skipped).toBe(true);
    expect(db.invoiceCreates).toHaveLength(0);
    expect(db.paymentCreates).toHaveLength(0);
  });

  it("9. retry is idempotent for a mapped payment", async () => {
    const db = dependencyMemory();
    const { persistItemMapping } = await import("@/lib/quickbooks/mappings");
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
    });
    await persistInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "inv-dep",
      quickbooksId: "145",
    });
    const first = await syncPaymentToQuickBooks(db.client, db.transport, { companyId: "co-a", paymentId: "pay-dep" });
    const second = await syncPaymentToQuickBooks(db.client, db.transport, { companyId: "co-a", paymentId: "pay-dep" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.quickbooksId).toBe(second.quickbooksId);
    expect(db.paymentCreates).toHaveLength(1);
  });

  it("8b. overpayment guard blocks QuickBooks payment create", async () => {
    const db = dependencyMemory();
    const extra = {
      id: "manual-dup",
      status: "RECORDED",
      amountCents: 1000,
      refundedCents: 0,
      provider: "MANUAL",
      providerPaymentId: null,
    };
    (db.client.payment as { findMany: (args: unknown) => Promise<unknown[]> }).findMany = async () => [
      db.payment,
      extra,
    ];
    await persistInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "inv-dep",
      quickbooksId: "145",
    });
    const result = await syncPaymentToQuickBooks(db.client, db.transport, { companyId: "co-a", paymentId: "pay-dep" });
    expect(result.ok).toBe(false);
    expect(result.review).toBe(true);
    expect(result.error).toMatch(/\$20 in recorded payments against a \$10 invoice/);
    expect(db.paymentCreates).toHaveLength(0);
  });

  it("does not fabricate a QuickBooks payment for a mapped paid invoice with no payment row", async () => {
    const db = dependencyMemory();
    await persistInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: invoice00003.id,
      quickbooksId: "145",
    });
    const missing = await syncPaymentToQuickBooks(db.client, db.transport, {
      companyId: "co-a",
      paymentId: "missing-pay",
    });
    expect(missing.ok).toBe(false);
    expect(db.paymentCreates).toHaveLength(0);
    expect(describeInvoicePaidSource({ amountPaidCents: 1000, payments: [] }).source).toBe(
      "INVOICE_STATUS_WITHOUT_PAYMENT_RECORD"
    );
  });
});

