import type { PrismaClient } from "@prisma/client";
import { nextNumber } from "@/lib/sequences";
import { buildIdentityIndex, resolveCanonicalCustomer } from "@/lib/imports/identity";
import { IMPORT_MODE_HISTORICAL } from "@/lib/imports/modes";
import { QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";
import { splitFullName } from "@/lib/imports/normalize";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import type { QboTransport } from "@/lib/quickbooks/client";
import { historicalImportMappingMetadata } from "@/lib/quickbooks/historical-reset";

export const QBO_HISTORICAL_CATEGORIES = ["customers", "invoices", "payments", "items", "expenses"] as const;
export type QboHistoricalCategory = (typeof QBO_HISTORICAL_CATEGORIES)[number];

export type QboHistoricalPreview = {
  connected: boolean;
  error?: string;
  reauth?: boolean;
  customers: number;
  invoices: number;
  payments: number;
  items: number;
  expenses: number;
  alreadyLinkedCustomers: number;
  alreadyLinkedInvoices: number;
  alreadyLinkedPayments: number;
};

export type QboHistoricalImportResult = {
  preview: QboHistoricalPreview;
  created: {
    customers: number;
    invoices: number;
    payments: number;
    review: number;
  };
  matched: number;
  skipped: number;
};

function queryTotal(json: unknown): number {
  const response = (json as { QueryResponse?: { totalCount?: number; maxResults?: number } })?.QueryResponse;
  if (typeof response?.totalCount === "number") return response.totalCount;
  if (typeof response?.maxResults === "number") return response.maxResults;
  return 0;
}

async function qboCount(transport: QboTransport, entity: string) {
  const result = await transport({
    method: "GET",
    path: "/query",
    query: `select count(*) from ${entity}`,
  });
  if (!result.ok) return 0;
  return queryTotal(result.json);
}

async function qboRows<T>(transport: QboTransport, entity: string, key: string, start = 1, max = 100): Promise<T[]> {
  const result = await transport({
    method: "GET",
    path: "/query",
    query: `select * from ${entity} STARTPOSITION ${start} MAXRESULTS ${max}`,
  });
  if (!result.ok) return [];
  const rows = (result.json as { QueryResponse?: Record<string, unknown> })?.QueryResponse?.[key];
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function previewQuickBooksHistorical(
  prisma: PrismaClient,
  companyId: string
): Promise<QboHistoricalPreview> {
  const transport = await loadQuickBooksTransport(companyId);
  const [linkedCustomers, linkedInvoices, linkedPayments] = await Promise.all([
    prisma.quickBooksMapping.count({ where: { companyId, entityType: "CUSTOMER" } }),
    prisma.quickBooksMapping.count({ where: { companyId, entityType: "INVOICE" } }),
    prisma.quickBooksMapping.count({ where: { companyId, entityType: "PAYMENT" } }),
  ]);
  if (!transport.ok) {
    return {
      connected: false,
      error: transport.error,
      reauth: transport.reauth,
      customers: 0,
      invoices: 0,
      payments: 0,
      items: 0,
      expenses: 0,
      alreadyLinkedCustomers: linkedCustomers,
      alreadyLinkedInvoices: linkedInvoices,
      alreadyLinkedPayments: linkedPayments,
    };
  }
  const [customers, invoices, payments, items, expenses] = await Promise.all([
    qboCount(transport.transport, "Customer"),
    qboCount(transport.transport, "Invoice"),
    qboCount(transport.transport, "Payment"),
    qboCount(transport.transport, "Item"),
    qboCount(transport.transport, "Purchase"),
  ]);
  return {
    connected: true,
    customers,
    invoices,
    payments,
    items,
    expenses,
    alreadyLinkedCustomers: linkedCustomers,
    alreadyLinkedInvoices: linkedInvoices,
    alreadyLinkedPayments: linkedPayments,
  };
}

type QboCustomer = {
  Id?: string;
  DisplayName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
};

type QboInvoice = {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  PrivateNote?: string;
  CustomerRef?: { value?: string };
};

type QboPayment = {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: number;
  CustomerRef?: { value?: string };
  Line?: Array<{ LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }> }>;
};

function dollarsToCents(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export async function importQuickBooksHistorical(input: {
  prisma: PrismaClient;
  companyId: string;
  userId: string;
  categories: QboHistoricalCategory[];
}): Promise<QboHistoricalImportResult> {
  const preview = await previewQuickBooksHistorical(input.prisma, input.companyId);
  if (!preview.connected) {
    return { preview, created: { customers: 0, invoices: 0, payments: 0, review: 0 }, matched: 0, skipped: 0 };
  }
  const transport = await loadQuickBooksTransport(input.companyId);
  if (!transport.ok) {
    return { preview, created: { customers: 0, invoices: 0, payments: 0, review: 0 }, matched: 0, skipped: 0 };
  }
  const app = await loadQuickBooksAppCredentials(input.prisma, input.companyId);
  const mappingMeta = historicalImportMappingMetadata({
    realmId: transport.realmId,
    environment: app?.environment ?? null,
  });

  const created = { customers: 0, invoices: 0, payments: 0, review: 0 };
  let matched = 0;
  let skipped = 0;

  const existingCustomers = await input.prisma.customer.findMany({
    where: { companyId: input.companyId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      email: true,
      phone: true,
      sourceSystem: true,
      externalId: true,
      properties: { select: { address: true, city: true, zip: true } },
    },
  });
  const mappings = await input.prisma.quickBooksMapping.findMany({
    where: { companyId: input.companyId, entityType: "CUSTOMER" },
    select: { internalId: true, quickbooksId: true },
  });
  const identity = buildIdentityIndex(
    existingCustomers,
    mappings.map((row) => ({
      customerId: row.internalId,
      externalId: row.quickbooksId,
      sourceSystem: QUICKBOOKS_PROVIDER_KEY,
    }))
  );
  const qboToCustomer = new Map(mappings.map((row) => [row.quickbooksId, row.internalId]));

  if (input.categories.includes("customers") || input.categories.includes("invoices") || input.categories.includes("payments")) {
    let start = 1;
    for (;;) {
      const rows = await qboRows<QboCustomer>(transport.transport, "Customer", "Customer", start, 100);
      if (!rows.length) break;
      for (const row of rows) {
        if (!row.Id) continue;
        if (qboToCustomer.has(row.Id)) {
          skipped += 1;
          continue;
        }
        const names = splitFullName(row.DisplayName || `${row.GivenName || ""} ${row.FamilyName || ""}`);
        const decision = resolveCanonicalCustomer(identity, {
          externalId: row.Id,
          sourceSystem: QUICKBOOKS_PROVIDER_KEY,
          email: row.PrimaryEmailAddr?.Address,
          phone: row.PrimaryPhone?.FreeFormNumber,
          firstName: row.GivenName || names.firstName,
          lastName: row.FamilyName || names.lastName,
          name: row.DisplayName,
          mappedCustomerId: qboToCustomer.get(row.Id),
        });
        if (decision.confidence === "REVIEW") {
          await input.prisma.importReviewItem.create({
            data: {
              companyId: input.companyId,
              sourceSystem: QUICKBOOKS_SOURCE,
              recordType: "CUSTOMERS",
              status: "OPEN",
              confidence: "REVIEW",
              proposedCustomerId: decision.customerId,
              externalId: row.Id,
              payload: row as object,
              reason: decision.reason,
            },
          });
          created.review += 1;
          continue;
        }
        let customerId = decision.customerId;
        if (decision.confidence === "NEW" && input.categories.includes("customers")) {
          const createdCustomer = await input.prisma.customer.create({
            data: {
              companyId: input.companyId,
              firstName: row.GivenName || names.firstName || "QuickBooks",
              lastName: row.FamilyName || names.lastName || "Customer",
              businessName: row.DisplayName || null,
              email: row.PrimaryEmailAddr?.Address || null,
              phone: row.PrimaryPhone?.FreeFormNumber || null,
              sourceSystem: QUICKBOOKS_SOURCE,
              externalId: row.Id,
              importMode: IMPORT_MODE_HISTORICAL,
            },
          });
          customerId = createdCustomer.id;
          created.customers += 1;
          identity.customers.set(createdCustomer.id, {
            id: createdCustomer.id,
            firstName: createdCustomer.firstName,
            lastName: createdCustomer.lastName,
            businessName: createdCustomer.businessName,
            email: createdCustomer.email,
            phone: createdCustomer.phone,
            sourceSystem: QUICKBOOKS_SOURCE,
            externalId: row.Id,
          });
        } else if (decision.confidence === "AUTO_MATCH") {
          matched += 1;
        } else {
          skipped += 1;
          continue;
        }
        if (!customerId) continue;
        qboToCustomer.set(row.Id, customerId);
        const existingCustomerMap = await input.prisma.quickBooksMapping.findUnique({
          where: {
            companyId_entityType_internalId: {
              companyId: input.companyId,
              entityType: "CUSTOMER",
              internalId: customerId,
            },
          },
        });
        if (existingCustomerMap) {
          if (existingCustomerMap.quickbooksId !== row.Id) {
            await input.prisma.quickBooksMapping.update({
              where: { id: existingCustomerMap.id },
              data: { quickbooksId: row.Id, status: "SYNCED" },
            });
          }
        } else {
          await input.prisma.quickBooksMapping.create({
            data: {
              companyId: input.companyId,
              entityType: "CUSTOMER",
              internalId: customerId,
              quickbooksId: row.Id,
              status: "SYNCED",
              metadata: decision.confidence === "NEW" ? mappingMeta : { realmId: transport.realmId },
            },
          });
        }
      }
      if (rows.length < 100) break;
      start += 100;
    }
  }

  const invoiceByQbo = new Map<string, string>();
  if (input.categories.includes("invoices")) {
    const existing = await input.prisma.quickBooksMapping.findMany({
      where: { companyId: input.companyId, entityType: "INVOICE" },
      select: { internalId: true, quickbooksId: true },
    });
    for (const row of existing) invoiceByQbo.set(row.quickbooksId, row.internalId);
    let start = 1;
    for (;;) {
      const rows = await qboRows<QboInvoice>(transport.transport, "Invoice", "Invoice", start, 50);
      if (!rows.length) break;
      for (const row of rows) {
        if (!row.Id || invoiceByQbo.has(row.Id)) {
          skipped += 1;
          continue;
        }
        const customerId = row.CustomerRef?.value ? qboToCustomer.get(row.CustomerRef.value) : null;
        if (!customerId) {
          await input.prisma.importReviewItem.create({
            data: {
              companyId: input.companyId,
              sourceSystem: QUICKBOOKS_SOURCE,
              recordType: "INVOICES",
              status: "OPEN",
              confidence: "REVIEW",
              externalId: row.Id,
              payload: row as object,
              reason: "QuickBooks invoice has no matched ContractorYou customer",
            },
          });
          created.review += 1;
          continue;
        }
        const total = dollarsToCents(row.TotalAmt);
        const balance = dollarsToCents(row.Balance);
        const invoiceNumber = row.DocNumber || (await nextNumber(input.companyId, "INVOICE", "INV"));
        const clash = await input.prisma.invoice.findFirst({
          where: { companyId: input.companyId, invoiceNumber },
          select: { id: true },
        });
        const createdInvoice = await input.prisma.invoice.create({
          data: {
            companyId: input.companyId,
            customerId,
            invoiceNumber: (clash ? `${invoiceNumber}-QBO` : invoiceNumber).slice(0, 40),
            status: balance > 0 ? "SENT" : "PAID",
            issueDate: row.TxnDate ? new Date(row.TxnDate) : new Date(),
            dueDate: row.DueDate ? new Date(row.DueDate) : null,
            subtotalCents: total,
            totalCents: total,
            amountPaidCents: Math.max(0, total - balance),
            balanceCents: balance,
            notes: "Historical QuickBooks invoice. ContractorYou did not send this to the customer.",
            sourceSystem: QUICKBOOKS_SOURCE,
            externalId: row.Id,
            importMode: IMPORT_MODE_HISTORICAL,
          },
        });
        invoiceByQbo.set(row.Id, createdInvoice.id);
        await input.prisma.quickBooksMapping.upsert({
          where: {
            companyId_entityType_internalId: {
              companyId: input.companyId,
              entityType: "INVOICE",
              internalId: createdInvoice.id,
            },
          },
          create: {
            companyId: input.companyId,
            entityType: "INVOICE",
            internalId: createdInvoice.id,
            quickbooksId: row.Id,
            status: "SYNCED",
            metadata: mappingMeta,
          },
          update: { quickbooksId: row.Id, status: "SYNCED", metadata: mappingMeta },
        });
        created.invoices += 1;
      }
      if (rows.length < 50) break;
      start += 50;
    }
  }

  if (input.categories.includes("payments")) {
    const existing = await input.prisma.quickBooksMapping.findMany({
      where: { companyId: input.companyId, entityType: "PAYMENT" },
      select: { quickbooksId: true },
    });
    const known = new Set(existing.map((row) => row.quickbooksId));
    let start = 1;
    for (;;) {
      const rows = await qboRows<QboPayment>(transport.transport, "Payment", "Payment", start, 50);
      if (!rows.length) break;
      for (const row of rows) {
        if (!row.Id || known.has(row.Id)) {
          skipped += 1;
          continue;
        }
        const linkedInvoiceId = row.Line?.flatMap((line) => line.LinkedTxn || []).find((txn) => txn.TxnType === "Invoice")?.TxnId;
        const invoiceId = linkedInvoiceId ? invoiceByQbo.get(linkedInvoiceId) : null;
        if (!invoiceId) {
          await input.prisma.importReviewItem.create({
            data: {
              companyId: input.companyId,
              sourceSystem: QUICKBOOKS_SOURCE,
              recordType: "PAYMENTS",
              status: "OPEN",
              confidence: "REVIEW",
              externalId: row.Id,
              payload: row as object,
              reason: "QuickBooks payment could not be linked to a historical invoice",
            },
          });
          created.review += 1;
          continue;
        }
        const invoice = await input.prisma.invoice.findFirst({
          where: { id: invoiceId, companyId: input.companyId },
          select: { customerId: true },
        });
        const createdPayment = await input.prisma.payment.create({
          data: {
            companyId: input.companyId,
            invoiceId,
            customerId: invoice?.customerId,
            amountCents: dollarsToCents(row.TotalAmt),
            method: "OTHER",
            status: "RECORDED",
            provider: "QUICKBOOKS",
            providerPaymentId: `qbo-${row.Id}`,
            paidAt: row.TxnDate ? new Date(row.TxnDate) : new Date(),
            notes: "Historical QuickBooks payment. No customer notification was sent.",
            sourceSystem: QUICKBOOKS_SOURCE,
            externalId: row.Id,
            importMode: IMPORT_MODE_HISTORICAL,
          },
        });
        await input.prisma.quickBooksMapping.upsert({
          where: {
            companyId_entityType_internalId: {
              companyId: input.companyId,
              entityType: "PAYMENT",
              internalId: createdPayment.id,
            },
          },
          create: {
            companyId: input.companyId,
            entityType: "PAYMENT",
            internalId: createdPayment.id,
            quickbooksId: row.Id,
            status: "SYNCED",
            metadata: mappingMeta,
          },
          update: { quickbooksId: row.Id, status: "SYNCED", metadata: mappingMeta },
        });
        created.payments += 1;
      }
      if (rows.length < 50) break;
      start += 50;
    }
  }

  return { preview, created, matched, skipped };
}
