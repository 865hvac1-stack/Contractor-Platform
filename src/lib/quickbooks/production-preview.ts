import type { PrismaClient } from "@prisma/client";
import type { QboTransport } from "@/lib/quickbooks/client";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";

type QueryResponse = { QueryResponse?: Record<string, unknown> & { totalCount?: number } };

async function readOnlyQuery(transport: QboTransport, query: string) {
  const result = await transport({ method: "GET", path: "/query", query });
  if (!result.ok) throw new Error(`QuickBooks read-only query failed (${result.status}).`);
  return result.json as QueryResponse;
}

async function optionalReadOnlyQuery(transport: QboTransport, query: string) {
  return readOnlyQuery(transport, query).catch(() => null);
}

function total(json: QueryResponse) {
  return typeof json.QueryResponse?.totalCount === "number" ? json.QueryResponse.totalCount : 0;
}

function rows<T>(json: QueryResponse, key: string): T[] {
  const value = json.QueryResponse?.[key];
  return Array.isArray(value) ? (value as T[]).slice(0, 10) : [];
}

export type QuickBooksProductionPreview = {
  environment: "sandbox" | "production";
  realmId: string;
  customers: { count: number; sample: Array<{ id: string; name: string }> };
  invoices: {
    count: number;
    open: number | null;
    paid: number | null;
    oldest: string | null;
    newest: string | null;
    sample: Array<{ id: string; number: string; date: string | null; status: "Open" | "Paid" }>;
  };
  payments: { count: number; sample: Array<{ id: string; date: string | null; amount: number | null }> };
  items: { count: number; sample: Array<{ id: string; name: string; type: string | null }> };
  expenses: { count: number | null; sample: Array<{ id: string; date: string | null; amount: number | null }> };
};

export async function loadQuickBooksProductionPreview(
  _prisma: PrismaClient,
  companyId: string
): Promise<QuickBooksProductionPreview> {
  const loaded = await loadQuickBooksTransport(companyId);
  if (!loaded.ok) throw new Error(loaded.error);
  return queryQuickBooksProductionPreview(loaded.transport, {
    environment: loaded.environment,
    realmId: loaded.realmId,
  });
}

export async function queryQuickBooksProductionPreview(
  transport: QboTransport,
  scope: { environment: "sandbox" | "production"; realmId: string }
): Promise<QuickBooksProductionPreview> {
  const [
    customerCount,
    customerRows,
    invoiceCount,
    invoiceRows,
    invoiceOldest,
    invoiceNewest,
    openCount,
    paidCount,
    paymentCount,
    paymentRows,
    itemCount,
    itemRows,
    expenseCount,
    expenseRows,
  ] = await Promise.all([
    readOnlyQuery(transport, "select count(*) from Customer"),
    readOnlyQuery(transport, "select * from Customer MAXRESULTS 10"),
    readOnlyQuery(transport, "select count(*) from Invoice"),
    readOnlyQuery(transport, "select * from Invoice MAXRESULTS 10"),
    readOnlyQuery(transport, "select * from Invoice orderby TxnDate asc MAXRESULTS 1"),
    readOnlyQuery(transport, "select * from Invoice orderby TxnDate desc MAXRESULTS 1"),
    optionalReadOnlyQuery(transport, "select count(*) from Invoice where Balance > '0'"),
    optionalReadOnlyQuery(transport, "select count(*) from Invoice where Balance = '0'"),
    readOnlyQuery(transport, "select count(*) from Payment"),
    readOnlyQuery(transport, "select * from Payment MAXRESULTS 10"),
    readOnlyQuery(transport, "select count(*) from Item"),
    readOnlyQuery(transport, "select * from Item MAXRESULTS 10"),
    optionalReadOnlyQuery(transport, "select count(*) from Purchase"),
    optionalReadOnlyQuery(transport, "select * from Purchase MAXRESULTS 10"),
  ]);

  type Customer = { Id?: string; DisplayName?: string };
  type Invoice = { Id?: string; DocNumber?: string; TxnDate?: string; Balance?: number };
  type Payment = { Id?: string; TxnDate?: string; TotalAmt?: number };
  type Item = { Id?: string; Name?: string; Type?: string };
  type Purchase = { Id?: string; TxnDate?: string; TotalAmt?: number };
  const oldest = rows<Invoice>(invoiceOldest, "Invoice")[0]?.TxnDate ?? null;
  const newest = rows<Invoice>(invoiceNewest, "Invoice")[0]?.TxnDate ?? null;

  return {
    environment: scope.environment,
    realmId: scope.realmId,
    customers: {
      count: total(customerCount),
      sample: rows<Customer>(customerRows, "Customer").map((row) => ({
        id: row.Id || "",
        name: row.DisplayName || "Unnamed customer",
      })),
    },
    invoices: {
      count: total(invoiceCount),
      open: openCount ? total(openCount) : null,
      paid: paidCount ? total(paidCount) : null,
      oldest,
      newest,
      sample: rows<Invoice>(invoiceRows, "Invoice").map((row) => ({
        id: row.Id || "",
        number: row.DocNumber || "No number",
        date: row.TxnDate ?? null,
        status: Number(row.Balance || 0) > 0 ? "Open" : "Paid",
      })),
    },
    payments: {
      count: total(paymentCount),
      sample: rows<Payment>(paymentRows, "Payment").map((row) => ({
        id: row.Id || "",
        date: row.TxnDate ?? null,
        amount: typeof row.TotalAmt === "number" ? row.TotalAmt : null,
      })),
    },
    items: {
      count: total(itemCount),
      sample: rows<Item>(itemRows, "Item").map((row) => ({
        id: row.Id || "",
        name: row.Name || "Unnamed item",
        type: row.Type ?? null,
      })),
    },
    expenses: {
      count: expenseCount ? total(expenseCount) : null,
      sample: expenseRows ? rows<Purchase>(expenseRows, "Purchase").map((row) => ({
        id: row.Id || "",
        date: row.TxnDate ?? null,
        amount: typeof row.TotalAmt === "number" ? row.TotalAmt : null,
      })) : [],
    },
  };
}

