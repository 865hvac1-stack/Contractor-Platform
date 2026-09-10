import { describe, expect, it } from "vitest";
import type { PrismaClient, QuickBooksMapping } from "@prisma/client";
import {
  ENTITY_INVOICE,
  ENTITY_PAYMENT,
  invoiceMappingIdentity,
  listCompanyItemMappings,
  persistInvoiceMapping,
  persistItemMapping,
  persistPaymentMapping,
  resolveInvoiceItemMapping,
  resolveQuickBooksInvoiceMapping,
  saveCompanyItemMappings,
} from "@/lib/quickbooks/mappings";
import { qboCreateOrUpdateInvoice, qboCreatePayment, qboListItems, type QboTransport } from "@/lib/quickbooks/client";
import { canAutoSyncInvoice, syncInvoiceToQuickBooks, syncPaymentToQuickBooks } from "@/lib/quickbooks/sync";

type Row = QuickBooksMapping;

function memoryPrisma() {
  const rows: Row[] = [];
  const now = () => new Date();
  return {
    rows,
    client: {
      quickBooksMapping: {
        async findMany({ where }: { where: { companyId: string; entityType?: { in: string[] } } }) {
          return rows.filter(
            (row) =>
              row.companyId === where.companyId &&
              (!where.entityType?.in || where.entityType.in.includes(row.entityType))
          );
        },
        async findFirst({
          where,
        }: {
          where: { companyId: string; entityType: string; internalId?: string };
        }) {
          return (
            rows.find(
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
          create: Omit<Row, "id" | "createdAt" | "updatedAt" | "lastSyncedAt" | "syncToken"> & {
            lastSyncedAt?: Date | null;
            syncToken?: string | null;
          };
          update: Partial<Row>;
        }) {
          const key = where.companyId_entityType_internalId;
          const existing = rows.find(
            (row) =>
              row.companyId === key.companyId &&
              row.entityType === key.entityType &&
              row.internalId === key.internalId
          );
          if (!existing) {
            const created = {
              id: `map_${rows.length + 1}`,
              createdAt: now(),
              updatedAt: now(),
              ...create,
            } as Row;
            rows.push(created);
            return created;
          }
          Object.assign(existing, update, { updatedAt: now() });
          return existing;
        },
        async updateMany({
          where,
          data,
        }: {
          where: { companyId: string; entityType: string; internalId: string };
          data: Partial<Row>;
        }) {
          let count = 0;
          for (const row of rows) {
            if (
              row.companyId === where.companyId &&
              row.entityType === where.entityType &&
              row.internalId === where.internalId
            ) {
              Object.assign(row, data, { updatedAt: now() });
              count += 1;
            }
          }
          return { count };
        },
      },
    } as unknown as PrismaClient,
  };
}

describe("QuickBooks Product/Service mappings", () => {
  it("saves the default Product/Service by QuickBooks item ID and reloads it", async () => {
    const db = memoryPrisma();
    const first = await saveCompanyItemMappings(db.client, {
      companyId: "co-a",
      realmId: "realm-a",
      defaultItemId: "3",
      activeItems: [{ id: "3", name: "Services", active: true }],
    });
    expect(first.ok).toBe(true);
    const loaded = await listCompanyItemMappings(db.client, "co-a");
    expect(loaded.defaultItem?.quickbooksId).toBe("3");
    expect(loaded.defaultItem?.name).toBe("Services");
    expect(loaded.defaultItem?.realmId).toBe("realm-a");
  });

  it("rejects a save that has no Product/Service selected", async () => {
    const db = memoryPrisma();
    const result = await saveCompanyItemMappings(db.client, {
      companyId: "co-a",
      defaultItemId: "",
      serviceItems: [{ serviceTypeId: "svc-1", quickbooksId: "" }],
    });
    expect(result.ok).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it("saves a service-specific mapping without duplicating on repeat save", async () => {
    const db = memoryPrisma();
    const input = {
      companyId: "co-a",
      defaultItemId: "3",
      serviceItems: [{ serviceTypeId: "svc-1", quickbooksId: "21" }],
      activeItems: [
        { id: "3", name: "Services", active: true },
        { id: "21", name: "HVAC Installation", active: true },
      ],
    };
    await saveCompanyItemMappings(db.client, input);
    await saveCompanyItemMappings(db.client, input);
    expect(db.rows.filter((row) => row.entityType === "SERVICE_ITEM")).toHaveLength(1);
    expect(db.rows.filter((row) => row.entityType === "DEFAULT_ITEM")).toHaveLength(1);
    expect(db.rows.find((row) => row.entityType === "SERVICE_ITEM")?.quickbooksId).toBe("21");
  });

  it("uses the service mapping first and the company default as fallback", async () => {
    const db = memoryPrisma();
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
      name: "Services",
    });
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "SERVICE_ITEM",
      internalId: "svc-1",
      quickbooksId: "21",
      name: "HVAC Installation",
    });
    const specific = await resolveInvoiceItemMapping(db.client, { companyId: "co-a", serviceTypeId: "svc-1" });
    const fallback = await resolveInvoiceItemMapping(db.client, { companyId: "co-a", serviceTypeId: "svc-other" });
    expect("itemId" in specific && specific.itemId).toBe("21");
    expect("itemId" in fallback && fallback.itemId).toBe("3");
  });

  it("blocks sync when no mapping exists", async () => {
    const db = memoryPrisma();
    const result = await resolveInvoiceItemMapping(db.client, { companyId: "co-a" });
    expect(result).toMatchObject({ review: true });
    expect("error" in result && result.error).toMatch(/Product\/Service mapping is missing/);
  });

  it("blocks an inactive or missing QuickBooks item instead of substituting another", async () => {
    const db = memoryPrisma();
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
      name: "Services",
    });
    const missing = await resolveInvoiceItemMapping(db.client, {
      companyId: "co-a",
      activeItems: [{ id: "99", name: "Hours", active: true }],
    });
    expect("error" in missing && missing.error).toMatch(/missing or inactive/);
    expect(db.rows[0]?.status).toBe("NEEDS_REVIEW");
    const inactive = await resolveInvoiceItemMapping(db.client, {
      companyId: "co-a",
      activeItems: [{ id: "3", name: "Services", active: false }],
    });
    expect("error" in inactive).toBe(true);
  });

  it("keeps mappings tenant isolated", async () => {
    const db = memoryPrisma();
    await saveCompanyItemMappings(db.client, {
      companyId: "co-a",
      defaultItemId: "3",
      activeItems: [{ id: "3", name: "Services", active: true }],
    });
    const other = await resolveInvoiceItemMapping(db.client, { companyId: "co-b" });
    expect("error" in other).toBe(true);
    expect(db.rows.every((row) => row.companyId === "co-a")).toBe(true);
  });

  it("rejects a default item that is not on the connected QuickBooks company", async () => {
    const db = memoryPrisma();
    const result = await saveCompanyItemMappings(db.client, {
      companyId: "co-a",
      defaultItemId: "3",
      activeItems: [{ id: "21", name: "HVAC Installation", active: true }],
    });
    expect(result.ok).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it("normalizes a single QuickBooks Item object into a selectable ID", async () => {
    const transport: QboTransport = async () => ({
      ok: true,
      status: 200,
      json: { QueryResponse: { Item: { Id: 3, Name: "Services", Type: "Service", Active: true } } },
    });
    const items = await qboListItems(transport);
    expect(items).toEqual([{ id: "3", name: "Services", type: "Service", active: true }]);
  });

  it("reads a numeric QuickBooks Payment Id after apply", async () => {
    const transport: QboTransport = async () => ({
      ok: true,
      status: 200,
      json: { Payment: { Id: 88 } },
    });
    const id = await qboCreatePayment(transport, {
      customerId: "1",
      invoiceId: "145",
      amount: 10,
      txnDate: "2026-09-10",
    });
    expect(id).toBe("88");
  });

  it("sends the mapped QuickBooks ItemRef, not the ContractorYou service name", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const transport: QboTransport = async ({ path, body }) => {
      calls.push({ path, body });
      if (path.startsWith("/invoice/")) return { ok: true, status: 200, json: { Invoice: { Id: "77", SyncToken: "0" } } };
      return { ok: true, status: 200, json: { Invoice: { Id: "77" } } };
    };
    await qboCreateOrUpdateInvoice(transport, {
      customerId: "cust-1",
      docNumber: "INV-00003",
      txnDate: "2026-09-10",
      lines: [
        {
          description: "Service call",
          quantity: 1,
          unitPrice: 10,
          amount: 10,
          itemId: "3",
          itemName: "Services",
        },
      ],
    });
    const body = calls.find((call) => call.path === "/invoice")?.body as {
      Line: Array<{ SalesItemLineDetail?: { ItemRef?: { value?: string; name?: string } } }>;
    };
    expect(body.Line[0]?.SalesItemLineDetail?.ItemRef).toEqual({ value: "3", name: "Services" });
  });

  it("marks a mapping for review when it belongs to another QuickBooks realm", async () => {
    const db = memoryPrisma();
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
      name: "Services",
      realmId: "realm-a",
    });
    const result = await resolveInvoiceItemMapping(db.client, {
      companyId: "co-a",
      realmId: "realm-other",
    });
    expect("error" in result && result.error).toMatch(/different QuickBooks company/);
    expect(db.rows[0]?.status).toBe("NEEDS_REVIEW");
  });

  it("keeps historical invoices from auto-sync", () => {
    expect(canAutoSyncInvoice({ trigger: "WHEN_CREATED", event: "created", importMode: "HISTORICAL" }).allowed).toBe(
      false
    );
  });
});

function syncMemory() {
  const mappings: QuickBooksMapping[] = [];
  const events: unknown[] = [];
  const now = () => new Date();
  const invoice = {
    id: "inv-1",
    companyId: "co-a",
    invoiceNumber: "INV-00003",
    status: "PAID",
    balanceCents: 0,
    amountPaidCents: 1000,
    totalCents: 1000,
    issueDate: new Date("2026-09-10"),
    dueDate: new Date("2026-09-17"),
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
    id: "pay-1",
    companyId: "co-a",
    invoiceId: "inv-1",
    amountCents: 1000,
    paidAt: new Date("2026-09-10"),
    externalRef: "stripe_10",
    importMode: "LIVE",
    invoice,
  };
  const client = {
    company: {
      async findFirst() {
        return { isDemo: false };
      },
    },
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
    },
    integrationConnection: {
      async findFirst() {
        return { externalAccountId: "realm-a" };
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    quickBooksSyncEvent: {
      async create({ data }: { data: unknown }) {
        events.push(data);
        return data;
      },
      async findFirst({
        where,
      }: {
        where: {
          companyId: string;
          entityType: string;
          internalId?: string;
          status?: string;
          quickbooksId?: { not: null };
          action?: { in: string[] };
        };
      }) {
        const matches = (events as Array<Record<string, unknown>>).filter((row) => {
          if (row.companyId !== where.companyId || row.entityType !== where.entityType) return false;
          if (where.internalId && row.internalId !== where.internalId) return false;
          if (where.status && row.status !== where.status) return false;
          if (where.quickbooksId?.not === null && !row.quickbooksId) return false;
          if (where.action?.in && !where.action.in.includes(String(row.action))) return false;
          return true;
        });
        return matches[matches.length - 1] ?? null;
      },
    },
    quickBooksMapping: {
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
      async update({
        where,
        data,
      }: {
        where: { companyId_entityType_internalId: { companyId: string; entityType: string; internalId: string } };
        data: Record<string, unknown>;
      }) {
        const key = where.companyId_entityType_internalId;
        const existing = mappings.find(
          (row) =>
            row.companyId === key.companyId && row.entityType === key.entityType && row.internalId === key.internalId
        );
        if (!existing) throw new Error("missing mapping");
        Object.assign(existing, data, { updatedAt: now() });
        return existing;
      },
      async updateMany({
        where,
        data,
      }: {
        where: { companyId: string; entityType: string; internalId: string };
        data: Record<string, unknown>;
      }) {
        let count = 0;
        for (const row of mappings) {
          if (
            row.companyId === where.companyId &&
            row.entityType === where.entityType &&
            row.internalId === where.internalId
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  } as unknown as PrismaClient;
  return { client, mappings, events, invoice, payment };
}

function invoiceTransport(calls: { path: string; body?: unknown }[]): QboTransport {
  return async ({ path, body }) => {
    calls.push({ path, body });
    if (path === "/query") return { ok: true, status: 200, json: { QueryResponse: {} } };
    if (path === "/customer") return { ok: true, status: 200, json: { Customer: { Id: "QB-CUST-1" } } };
    if (path.startsWith("/invoice/")) {
      return { ok: true, status: 200, json: { Invoice: { Id: path.split("/").pop(), SyncToken: "1", Balance: 0, TotalAmt: 10 } } };
    }
    if (path === "/invoice") {
      const existing = body && typeof body === "object" && "Id" in body ? String((body as { Id?: string }).Id) : null;
      return { ok: true, status: 200, json: { Invoice: { Id: existing || "QB-INV-1" } } };
    }
    if (path === "/payment") return { ok: true, status: 200, json: { Payment: { Id: "QB-PAY-1" } } };
    return { ok: false, status: 404, json: {} };
  };
}

describe("QuickBooks invoice and payment sync with saved mappings", () => {
  it("blocks payment sync until the invoice exists in QuickBooks", async () => {
    const db = syncMemory();
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
      name: "Services",
    });
    const result = await syncPaymentToQuickBooks(db.client, invoiceTransport([]), {
      companyId: "co-a",
      paymentId: "pay-1",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invoice first|not in QuickBooks/i);
    expect(db.mappings.filter((row) => row.entityType === "PAYMENT")).toHaveLength(0);
  });

  it("creates one QuickBooks invoice from the saved mapping, then records the payment against it", async () => {
    const db = syncMemory();
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
      name: "Services",
      realmId: "realm-a",
    });
    const calls: { path: string; body?: unknown }[] = [];
    const transport = invoiceTransport(calls);
    const first = await syncInvoiceToQuickBooks(db.client, transport, {
      companyId: "co-a",
      invoiceId: "inv-1",
      actorId: "user-1",
    });
    const second = await syncInvoiceToQuickBooks(db.client, transport, {
      companyId: "co-a",
      invoiceId: "inv-1",
      actorId: "user-1",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.quickbooksId).toBe("QB-INV-1");
    expect(second.quickbooksId).toBe("QB-INV-1");
    expect(db.mappings.filter((row) => row.entityType === ENTITY_INVOICE)).toHaveLength(1);
    const invoiceIdentity = invoiceMappingIdentity({ companyId: "co-a", invoiceId: db.invoice.id });
    expect(db.mappings.find((row) => row.entityType === ENTITY_INVOICE)).toMatchObject({
      ...invoiceIdentity,
      quickbooksId: "QB-INV-1",
    });
    expect(invoiceIdentity.internalId).toBe(db.payment.invoiceId);
    expect(invoiceIdentity.internalId).toBe(db.invoice.id);
    const creates = calls.filter((call) => call.path === "/invoice" && !(call.body as { Id?: string } | undefined)?.Id);
    expect(creates).toHaveLength(1);
    const itemRef = (creates[0]?.body as { Line: Array<{ SalesItemLineDetail?: { ItemRef?: { value?: string; name?: string } } }> })
      .Line[0]?.SalesItemLineDetail?.ItemRef;
    expect(itemRef).toEqual({ value: "3", name: "Services" });

    const payFirst = await syncPaymentToQuickBooks(db.client, transport, {
      companyId: "co-a",
      paymentId: "pay-1",
    });
    const paySecond = await syncPaymentToQuickBooks(db.client, transport, {
      companyId: "co-a",
      paymentId: "pay-1",
    });
    expect(payFirst.ok).toBe(true);
    expect(paySecond.ok).toBe(true);
    expect(payFirst.quickbooksId).toBe(paySecond.quickbooksId);
    expect(calls.filter((call) => call.path === "/payment")).toHaveLength(1);
    const paymentBody = calls.find((call) => call.path === "/payment")?.body as {
      Line: Array<{ LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }> }>;
    };
    expect(paymentBody.Line[0]?.LinkedTxn?.[0]).toEqual({ TxnId: "QB-INV-1", TxnType: "Invoice" });
    expect(db.mappings.filter((row) => row.entityType === ENTITY_PAYMENT)).toHaveLength(1);
    expect(db.mappings.find((row) => row.entityType === ENTITY_PAYMENT)?.internalId).toBe(db.payment.id);
  });

  it("lets a paid ContractorYou invoice still send its $10 payment to the persisted QuickBooks invoice", async () => {
    const db = syncMemory();
    expect(db.invoice.status).toBe("PAID");
    expect(db.invoice.balanceCents).toBe(0);
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
      name: "Services",
    });
    await persistInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: db.invoice.id,
      quickbooksId: "145",
      realmId: "realm-a",
    });
    const resolved = await resolveQuickBooksInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: db.payment.invoice.id,
      realmId: "realm-a",
    });
    expect(resolved).toMatchObject({
      quickbooksId: "145",
      invoiceId: db.invoice.id,
      identity: invoiceMappingIdentity({ companyId: "co-a", invoiceId: db.invoice.id }),
    });
    const calls: { path: string; body?: unknown }[] = [];
    const result = await syncPaymentToQuickBooks(db.client, invoiceTransport(calls), {
      companyId: "co-a",
      paymentId: db.payment.id,
    });
    expect(result.ok).toBe(true);
    expect(result.quickbooksId).toBe("QB-PAY-1");
    expect((calls.find((call) => call.path === "/payment")?.body as { Line: Array<{ LinkedTxn?: Array<{ TxnId?: string }> }> }).Line[0]?.LinkedTxn?.[0]?.TxnId).toBe("145");
  });

  it("uses the same identity for invoice.create and payment.sync and heals a missing mapping from the invoice event", async () => {
    const db = syncMemory();
    const persisted = await persistInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "inv-1",
      quickbooksId: "145",
      realmId: "realm-a",
    });
    expect(persisted).toMatchObject(invoiceMappingIdentity({ companyId: "co-a", invoiceId: "inv-1" }));
    const resolved = await resolveQuickBooksInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: db.payment.invoiceId,
      realmId: "realm-a",
    });
    expect("quickbooksId" in resolved && resolved.quickbooksId).toBe("145");
    expect("identity" in resolved && resolved.identity).toEqual(invoiceMappingIdentity({ companyId: "co-a", invoiceId: "inv-1" }));

    const other = await resolveQuickBooksInvoiceMapping(db.client, { companyId: "co-b", invoiceId: "inv-1" });
    expect("error" in other).toBe(true);

    const realm = await resolveQuickBooksInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "inv-1",
      realmId: "realm-other",
    });
    expect("error" in realm && realm.error).toMatch(/different QuickBooks company/);

    db.mappings.splice(0, db.mappings.length);
    db.events.push({
      companyId: "co-a",
      entityType: ENTITY_INVOICE,
      internalId: "inv-1",
      quickbooksId: "145",
      status: "SYNCED",
      action: "invoice.create",
    });
    const healed = await resolveQuickBooksInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "inv-1",
      realmId: "realm-a",
    });
    expect(healed).toMatchObject({ quickbooksId: "145", invoiceId: "inv-1" });
    expect(db.mappings).toHaveLength(1);
    expect(db.mappings[0]).toMatchObject(invoiceMappingIdentity({ companyId: "co-a", invoiceId: "inv-1" }));
  });

  it("still resolves the invoice mapping when the lookup companyId is wrong but the loaded invoice is the same row", async () => {
    const db = syncMemory();
    await persistInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "inv-1",
      quickbooksId: "145",
      realmId: "realm-a",
    });
    const resolved = await resolveQuickBooksInvoiceMapping(db.client, {
      companyId: "wrong-company",
      invoiceId: "inv-1",
      invoice: { id: "inv-1", companyId: "co-a", invoiceNumber: "INV-00003" },
    });
    expect(resolved).toMatchObject({ quickbooksId: "145", invoiceId: "inv-1" });
  });

  it("repairs a legacy mapping that was keyed by invoiceNumber instead of Invoice.id", async () => {
    const db = syncMemory();
    await persistInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "INV-00003",
      quickbooksId: "145",
    });
    const resolved = await resolveQuickBooksInvoiceMapping(db.client, {
      companyId: "co-a",
      invoiceId: "inv-1",
      invoice: { id: "inv-1", companyId: "co-a", invoiceNumber: "INV-00003" },
    });
    expect(resolved).toMatchObject({ quickbooksId: "145", invoiceId: "inv-1" });
    expect(db.mappings.some((row) => row.entityType === ENTITY_INVOICE && row.internalId === "inv-1")).toBe(true);
  });

  it("never treats QBO DocNumber as the LinkedTxn Invoice Id", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const transport: QboTransport = async ({ path, body }) => {
      calls.push({ path, body });
      if (path === "/query") return { ok: true, status: 200, json: { QueryResponse: {} } };
      if (path.startsWith("/invoice/")) {
        return { ok: true, status: 200, json: { Invoice: { Id: "145", DocNumber: "INV-00003", SyncToken: "1" } } };
      }
      if (path === "/invoice") return { ok: true, status: 200, json: { Invoice: { Id: "145", DocNumber: "INV-00003" } } };
      if (path === "/payment") return { ok: true, status: 200, json: { Payment: { Id: "99" } } };
      return { ok: true, status: 200, json: { Customer: { Id: "QB-CUST-1" } } };
    };
    const db = syncMemory();
    await persistItemMapping(db.client, {
      companyId: "co-a",
      entityType: "DEFAULT_ITEM",
      internalId: "default",
      quickbooksId: "3",
    });
    const invoiceResult = await syncInvoiceToQuickBooks(db.client, transport, {
      companyId: "co-a",
      invoiceId: "inv-1",
      actorId: "user-1",
    });
    expect(invoiceResult.quickbooksId).toBe("145");
    expect(invoiceResult.quickbooksId).not.toBe("INV-00003");
    const pay = await syncPaymentToQuickBooks(db.client, transport, {
      companyId: "co-a",
      paymentId: "pay-1",
    });
    expect(pay.ok).toBe(true);
    const paymentBody = calls.find((call) => call.path === "/payment")?.body as {
      Line: Array<{ LinkedTxn?: Array<{ TxnId?: string }> }>;
    };
    expect(paymentBody.Line[0]?.LinkedTxn?.[0]?.TxnId).toBe("145");
    expect(paymentBody.Line[0]?.LinkedTxn?.[0]?.TxnId).not.toBe("INV-00003");
  });

  it("does not reuse another tenant payment mapping", async () => {
    const db = syncMemory();
    await persistPaymentMapping(db.client, {
      companyId: "co-b",
      paymentId: "pay-1",
      quickbooksId: "QB-PAY-OTHER",
      invoiceId: "inv-other",
      qboInvoiceId: "999",
    });
    const result = await syncPaymentToQuickBooks(db.client, invoiceTransport([]), {
      companyId: "co-a",
      paymentId: "pay-1",
    });
    expect(result.ok).toBe(false);
    expect(db.mappings.filter((row) => row.companyId === "co-a" && row.entityType === ENTITY_PAYMENT)).toHaveLength(0);
  });
});
