import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { can } from "@/lib/permissions";
import { canAutoSyncInvoice, syncInvoiceToQuickBooks, syncPaymentToQuickBooks } from "@/lib/quickbooks/sync";
import { publicQuickBooksStatus } from "@/lib/quickbooks/status";
import { quickbooksSetupSnapshot, resolveQuickBooksApp } from "@/lib/quickbooks/config";
import { decryptCompanyQuickBooksApp, describeSavedQuickBooksApp, saveCompanyQuickBooksApp } from "@/lib/quickbooks/app";
import { quickbooksAuthorizeHref } from "@/lib/quickbooks/oauth";
import type { QboTransport } from "@/lib/quickbooks/client";

const prisma = new PrismaClient();

function mockTransport(calls: { path: string; body?: unknown }[]): QboTransport {
  let invoiceId = "QB-INV-1";
  return async ({ method, path, body }) => {
    calls.push({ path, body });
    if (path === "/query") return { ok: true, status: 200, json: { QueryResponse: {} } };
    if (path === "/customer") return { ok: true, status: 200, json: { Customer: { Id: "QB-CUST-1" } } };
    if (path.startsWith("/invoice/") && method === "GET") {
      return { ok: true, status: 200, json: { Invoice: { Id: path.split("/").pop(), SyncToken: "1" } } };
    }
    if (path === "/invoice") {
      const existing = body && typeof body === "object" && "Id" in body ? String((body as { Id?: string }).Id) : null;
      if (existing) invoiceId = existing;
      return { ok: true, status: 200, json: { Invoice: { Id: invoiceId } } };
    }
    if (path === "/payment") return { ok: true, status: 200, json: { Payment: { Id: "QB-PAY-1" } } };
    return { ok: false, status: 404, json: {} };
  };
}

describe("QuickBooks gates and status", () => {
  it("never shows Connected without a realm id", () => {
    expect(publicQuickBooksStatus(null)).toBe("NOT_CONNECTED");
    expect(publicQuickBooksStatus({ status: "CONNECTED", externalAccountId: null })).toBe("ERROR");
    expect(publicQuickBooksStatus({ status: "CONNECTED", externalAccountId: "123" })).toBe("CONNECTED");
    expect(publicQuickBooksStatus({ status: "REAUTH_REQUIRED", externalAccountId: "123" })).toBe("REAUTH_REQUIRED");
  });

  it("blocks historical invoices from auto-sync", () => {
    expect(
      canAutoSyncInvoice({ trigger: "WHEN_CREATED", event: "created", importMode: "HISTORICAL" }).allowed
    ).toBe(false);
    expect(
      canAutoSyncInvoice({ trigger: "WHEN_PAYMENT_RECEIVED", event: "payment_received", importMode: "HISTORICAL" }).allowed
    ).toBe(false);
    expect(canAutoSyncInvoice({ trigger: "MANUAL_ONLY", event: "created", importMode: "LIVE" }).allowed).toBe(false);
    expect(canAutoSyncInvoice({ trigger: "WHEN_SENT", event: "sent", importMode: "LIVE" }).allowed).toBe(true);
    expect(canAutoSyncInvoice({ trigger: "MANUAL_ONLY", event: "manual" }).allowed).toBe(true);
  });

  it("setup snapshot never includes secrets", () => {
    const prevId = process.env.QUICKBOOKS_CLIENT_ID;
    const prevSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    process.env.QUICKBOOKS_CLIENT_ID = "cid-public";
    process.env.QUICKBOOKS_CLIENT_SECRET = "super-secret-value";
    const snap = quickbooksSetupSnapshot();
    expect(snap.hasEnvClientId).toBe(true);
    expect(snap.hasEnvClientSecret).toBe(true);
    expect(snap.configured).toBe(true);
    expect(JSON.stringify(snap)).not.toMatch(/super-secret-value/);
    if (prevId == null) delete process.env.QUICKBOOKS_CLIENT_ID;
    else process.env.QUICKBOOKS_CLIENT_ID = prevId;
    if (prevSecret == null) delete process.env.QUICKBOOKS_CLIENT_SECRET;
    else process.env.QUICKBOOKS_CLIENT_SECRET = prevSecret;
  });

  it("prefers company Intuit keys over empty env", () => {
    const resolved = resolveQuickBooksApp({
      clientId: "company-cid",
      clientSecret: "company-secret",
      environment: "sandbox",
      source: "company",
    });
    expect(resolved?.source).toBe("company");
    expect(resolved?.clientId).toBe("company-cid");
    expect(
      quickbooksAuthorizeHref("state-test", resolved).includes("client_id=company-cid")
    ).toBe(true);
  });

  it("keeps QuickBooks management off technician roles", () => {
    expect(can("TECHNICIAN", "accounting:manage")).toBe(false);
    expect(can("TECHNICIAN", "job_costs:view")).toBe(false);
    expect(can("INSTALLER", "job_costs:view")).toBe(false);
    expect(can("OFFICE", "accounting:view")).toBe(true);
    expect(can("COMPANY_OWNER", "accounting:manage")).toBe(true);
  });
});

describe("QuickBooks sync isolation and idempotency", () => {
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    customerA: "",
    invoiceA: "",
    paymentA: "",
    historicalInvoice: "",
    historicalPayment: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const userA = await prisma.user.create({
      data: { email: `qbo-a-${stamp}@test.local`, passwordHash: hash, firstName: "Q", lastName: "A" },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: { businessName: `QBO A ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `QBO B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Pat", lastName: "Smith", status: "ACTIVE" },
    });
    ids.customerA = customerA.id;
    const invoice = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        invoiceNumber: `INV-Q-${stamp}`,
        status: "SENT",
        totalCents: 950000,
        balanceCents: 950000,
        importMode: "LIVE",
        lineItems: { create: [{ name: "Changeout", quantity: 1, unitPriceCents: 950000 }] },
      },
    });
    ids.invoiceA = invoice.id;
    const payment = await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: invoice.id,
        amountCents: 950000,
        method: "CHECK",
        importMode: "LIVE",
      },
    });
    ids.paymentA = payment.id;
    const historical = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        invoiceNumber: `INV-H-${stamp}`,
        status: "PAID",
        totalCents: 10000,
        amountPaidCents: 10000,
        importMode: "HISTORICAL",
        sourceSystem: "QUICKBOOKS",
      },
    });
    ids.historicalInvoice = historical.id;
    const histPay = await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: historical.id,
        amountCents: 10000,
        method: "OTHER",
        importMode: "HISTORICAL",
      },
    });
    ids.historicalPayment = histPay.id;
    await prisma.quickBooksMapping.create({
      data: {
        companyId: companyB.id,
        entityType: "INVOICE",
        internalId: "secret-b",
        quickbooksId: "QB-B-SECRET",
      },
    });
  });

  afterAll(async () => {
    const companyIds = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.quickBooksSyncEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.quickBooksMapping.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.quickBooksSettings.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.payment.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.invoice.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } });
    await prisma.$disconnect();
  });

  it("encrypts company Intuit keys and never stores the secret in plaintext", async () => {
    await saveCompanyQuickBooksApp(prisma, ids.companyA, {
      clientId: "intuit-cid",
      clientSecret: "intuit-secret",
      environment: "sandbox",
    });
    const settings = await prisma.quickBooksSettings.findUnique({ where: { companyId: ids.companyA } });
    const described = describeSavedQuickBooksApp(settings);
    expect(described.hasClientId).toBe(true);
    expect(described.hasSecret).toBe(true);
    expect(JSON.stringify(settings)).not.toMatch(/intuit-secret/);
    const decrypted = decryptCompanyQuickBooksApp(settings);
    expect(decrypted?.clientSecret).toBe("intuit-secret");
    expect(decrypted?.clientId).toBe("intuit-cid");
  });

  it("Company A cannot read Company B QuickBooks mappings", async () => {
    const leaked = await prisma.quickBooksMapping.findMany({ where: { companyId: ids.companyA } });
    expect(leaked.find((row) => row.quickbooksId === "QB-B-SECRET")).toBeUndefined();
    const byId = await prisma.quickBooksMapping.findFirst({
      where: { companyId: ids.companyA, quickbooksId: "QB-B-SECRET" },
    });
    expect(byId).toBeNull();
  });

  it("retrying invoice sync updates the same QuickBooks invoice", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const transport = mockTransport(calls);
    const first = await syncInvoiceToQuickBooks(prisma, transport, {
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
      actorId: ids.userA,
    });
    const second = await syncInvoiceToQuickBooks(prisma, transport, {
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
      actorId: ids.userA,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.quickbooksId).toBe(second.quickbooksId);
    const mappings = await prisma.quickBooksMapping.findMany({
      where: { companyId: ids.companyA, entityType: "INVOICE", internalId: ids.invoiceA },
    });
    expect(mappings).toHaveLength(1);
    const creates = calls.filter((call) => call.path === "/invoice" && !(call.body as { Id?: string } | undefined)?.Id);
    const updates = calls.filter((call) => call.path === "/invoice" && (call.body as { Id?: string } | undefined)?.Id);
    expect(creates.length).toBe(1);
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it("retrying payment sync does not create a second QuickBooks payment", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const transport = mockTransport(calls);
    const first = await syncPaymentToQuickBooks(prisma, transport, {
      companyId: ids.companyA,
      paymentId: ids.paymentA,
    });
    const second = await syncPaymentToQuickBooks(prisma, transport, {
      companyId: ids.companyA,
      paymentId: ids.paymentA,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.quickbooksId).toBe(second.quickbooksId);
    expect(calls.filter((call) => call.path === "/payment")).toHaveLength(1);
    const mappings = await prisma.quickBooksMapping.findMany({
      where: { companyId: ids.companyA, entityType: "PAYMENT", internalId: ids.paymentA },
    });
    expect(mappings).toHaveLength(1);
  });

  it("does not auto-sync imported historical invoices or payments", () => {
    expect(
      canAutoSyncInvoice({
        trigger: "WHEN_CREATED",
        event: "created",
        importMode: "HISTORICAL",
      }).allowed
    ).toBe(false);
  });

  it("historical payment sync is refused", async () => {
    const result = await syncPaymentToQuickBooks(prisma, mockTransport([]), {
      companyId: ids.companyA,
      paymentId: ids.historicalPayment,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/historical/i);
  });
});
