import { quickbooksApiBase } from "@/lib/quickbooks/config";

export type QboTransport = (input: {
  method: "GET" | "POST" | "POST_JSON";
  path: string;
  query?: string;
  body?: unknown;
}) => Promise<{ ok: boolean; status: number; json: unknown }>;

export type QboRefs = {
  customerId?: string;
  invoiceId?: string;
  paymentId?: string;
  invoiceDocNumber?: string;
};

export function liveQboTransport(input: {
  accessToken: string;
  realmId: string;
  environment?: "sandbox" | "production";
}): QboTransport {
  return async ({ method, path, query, body }) => {
    const url = new URL(`${quickbooksApiBase(input.environment)}/v3/company/${input.realmId}${path}`);
    url.searchParams.set("minorversion", "65");
    if (query) url.searchParams.set("query", query);
    const response = await fetch(url, {
      method: method === "GET" ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
        ...(method === "POST_JSON" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST_JSON" ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, json };
  };
}

function firstId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const entity = (record.Customer || record.Invoice || record.Payment || record.Purchase || record.CompanyInfo || record) as Record<string, unknown>;
  return qboEntityId(entity.Id) || undefined;
}

function queryId(json: unknown, key: string): string | undefined {
  const query = (json as { QueryResponse?: Record<string, unknown> })?.QueryResponse;
  const rows = query?.[key];
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== "object") return undefined;
  const id = (rows[0] as { Id?: string }).Id;
  return id;
}

export type QboCustomerRecord = {
  id: string;
  displayName: string;
  givenName?: string | null;
  familyName?: string | null;
  email?: string | null;
  phone?: string | null;
};

function escapeQbo(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function customerRows(json: unknown): QboCustomerRecord[] {
  const query = (json as { QueryResponse?: { Customer?: unknown } })?.QueryResponse;
  const rows = query?.Customer;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as {
      Id?: string;
      DisplayName?: string;
      GivenName?: string;
      FamilyName?: string;
      PrimaryEmailAddr?: { Address?: string };
      PrimaryPhone?: { FreeFormNumber?: string };
    };
    if (!record.Id) return [];
    return [
      {
        id: record.Id,
        displayName: record.DisplayName || "",
        givenName: record.GivenName ?? null,
        familyName: record.FamilyName ?? null,
        email: record.PrimaryEmailAddr?.Address ?? null,
        phone: record.PrimaryPhone?.FreeFormNumber ?? null,
      },
    ];
  });
}

export async function qboFindCustomer(
  transport: QboTransport,
  displayName: string
): Promise<string | null> {
  const matches = await qboSearchCustomers(transport, { displayName });
  return matches[0]?.id ?? null;
}

export async function qboSearchCustomers(
  transport: QboTransport,
  input: { displayName?: string | null; email?: string | null }
): Promise<QboCustomerRecord[]> {
  const queries: string[] = [];
  if (input.email?.includes("@")) {
    queries.push(`select * from Customer where PrimaryEmailAddr = '${escapeQbo(input.email.trim())}'`);
  }
  if (input.displayName?.trim()) {
    queries.push(`select * from Customer where DisplayName = '${escapeQbo(input.displayName.trim())}'`);
  }
  const found = new Map<string, QboCustomerRecord>();
  for (const query of queries) {
    const result = await transport({ method: "GET", path: "/query", query });
    if (!result.ok) continue;
    for (const row of customerRows(result.json)) found.set(row.id, row);
  }
  return [...found.values()];
}

export async function qboCompanyInfo(
  transport: QboTransport,
  realmId: string
): Promise<{ name: string } | null> {
  const result = await transport({ method: "GET", path: `/companyinfo/${realmId}` });
  if (!result.ok) return null;
  const info = (result.json as { CompanyInfo?: { CompanyName?: string } })?.CompanyInfo;
  return info?.CompanyName ? { name: info.CompanyName } : null;
}

function asRows<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function qboEntityId(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && value && "value" in value) return String((value as { value?: unknown }).value ?? "");
  return "";
}

export async function qboListItems(transport: QboTransport) {
  const result = await transport({
    method: "GET",
    path: "/query",
    query: "select * from Item where Active = true MAXRESULTS 200",
  });
  if (!result.ok) return [];
  const rows = asRows(
    (result.json as { QueryResponse?: { Item?: Array<{ Id?: unknown; Name?: string; Type?: string; Active?: boolean }> } })
      ?.QueryResponse?.Item
  );
  return rows.flatMap((row) => {
    const id = qboEntityId(row.Id);
    const name = row.Name?.trim();
    if (!id || !name) return [];
    return [{ id, name, type: row.Type || "Service", active: row.Active !== false }];
  });
}

export async function qboGetItem(transport: QboTransport, id: string) {
  const result = await transport({ method: "GET", path: `/item/${id}` });
  if (!result.ok) return null;
  const item = (result.json as { Item?: { Id?: unknown; Name?: string; Active?: boolean; Type?: string } })?.Item;
  const itemId = qboEntityId(item?.Id);
  if (!itemId) return null;
  return { id: itemId, name: item?.Name || "", type: item?.Type || "Service", active: item?.Active !== false };
}

export async function qboListExpenseAccounts(transport: QboTransport) {
  const result = await transport({
    method: "GET",
    path: "/query",
    query: "select * from Account where Active = true and AccountType = 'Expense' MAXRESULTS 200",
  });
  if (!result.ok) return [];
  const rows = asRows(
    (result.json as { QueryResponse?: { Account?: Array<{ Id?: unknown; Name?: string; AccountType?: string; Active?: boolean }> } })
      ?.QueryResponse?.Account
  );
  return rows.flatMap((row) => {
    const id = qboEntityId(row.Id);
    const name = row.Name?.trim();
    if (!id || !name) return [];
    return [{ id, name, type: row.AccountType || "Expense", active: row.Active !== false }];
  });
}

export async function qboGetInvoice(transport: QboTransport, id: string) {
  const result = await transport({ method: "GET", path: `/invoice/${id}` });
  if (!result.ok) return null;
  const invoice = (result.json as {
    Invoice?: { Id?: unknown; DocNumber?: string; Balance?: number; TotalAmt?: number; SyncToken?: string };
  })?.Invoice;
  const invoiceId = qboEntityId(invoice?.Id);
  if (!invoice || !invoiceId) return null;
  return {
    id: invoiceId,
    docNumber: invoice.DocNumber || null,
    balance: invoice.Balance ?? null,
    total: invoice.TotalAmt ?? null,
    syncToken: invoice.SyncToken ?? null,
  };
}

export async function qboCreatePurchase(
  transport: QboTransport,
  input: {
    amount: number;
    txnDate: string;
    accountId: string;
    memo?: string | null;
    vendor?: string | null;
  }
) {
  const result = await transport({
    method: "POST_JSON",
    path: "/purchase",
    body: {
      PaymentType: "Cash",
      AccountRef: { value: input.accountId },
      TxnDate: input.txnDate,
      PrivateNote: [input.vendor, input.memo].filter(Boolean).join(" · ") || undefined,
      Line: [
        {
          Amount: input.amount,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: input.accountId } },
        },
      ],
    },
  });
  const id = firstId(result.json);
  if (!result.ok || !id) throw new Error("QuickBooks did not accept that expense.");
  return id;
}

export async function qboCreateCustomer(
  transport: QboTransport,
  input: { displayName: string; firstName?: string; lastName?: string; email?: string | null; phone?: string | null }
): Promise<string> {
  const result = await transport({
    method: "POST_JSON",
    path: "/customer",
    body: {
      DisplayName: input.displayName.slice(0, 100),
      GivenName: input.firstName,
      FamilyName: input.lastName,
      PrimaryEmailAddr: input.email ? { Address: input.email } : undefined,
      PrimaryPhone: input.phone ? { FreeFormNumber: input.phone } : undefined,
    },
  });
  const id = firstId(result.json);
  if (!result.ok || !id) throw new Error("QuickBooks did not create the customer.");
  return id;
}

export async function qboCreateOrUpdateInvoice(
  transport: QboTransport,
  input: {
    existingId?: string | null;
    customerId: string;
    docNumber: string;
    txnDate: string;
    dueDate?: string | null;
    memo?: string | null;
    lines: { description: string; quantity: number; unitPrice: number; amount: number; itemId?: string | null; itemName?: string | null }[];
  }
): Promise<string> {
  const line = input.lines.length
    ? input.lines.map((item) => ({
        Amount: item.amount,
        DetailType: "SalesItemLineDetail",
        Description: item.description,
        SalesItemLineDetail: {
          Qty: item.quantity,
          UnitPrice: item.unitPrice,
          ...(item.itemId ? { ItemRef: { value: item.itemId, name: item.itemName || undefined } } : {}),
        },
      }))
    : [{ Amount: 0, DetailType: "SalesItemLineDetail", Description: "ContractorYou invoice", SalesItemLineDetail: { Qty: 1, UnitPrice: 0 } }];
  const body: Record<string, unknown> = {
    CustomerRef: { value: input.customerId },
    DocNumber: input.docNumber.slice(0, 21),
    TxnDate: input.txnDate,
    DueDate: input.dueDate ?? undefined,
    PrivateNote: input.memo ?? undefined,
    Line: line,
  };
  if (input.existingId) {
    body.Id = input.existingId;
    const current = await transport({ method: "GET", path: `/invoice/${input.existingId}` });
    const token = (current.json as { Invoice?: { SyncToken?: string } })?.Invoice?.SyncToken;
    if (token) {
      body.SyncToken = token;
      body.sparse = true;
    }
  }
  const result = await transport({ method: "POST_JSON", path: "/invoice", body });
  const id = firstId(result.json);
  if (!result.ok || !id) throw new Error("QuickBooks did not accept that invoice.");
  return id;
}

export async function qboCreatePayment(
  transport: QboTransport,
  input: {
    existingId?: string | null;
    customerId: string;
    invoiceId: string;
    amount: number;
    txnDate: string;
    reference?: string | null;
  }
): Promise<string> {
  if (input.existingId) return input.existingId;
  const result = await transport({
    method: "POST_JSON",
    path: "/payment",
    body: {
      CustomerRef: { value: input.customerId },
      TotalAmt: input.amount,
      TxnDate: input.txnDate,
      PaymentRefNum: input.reference ?? undefined,
      Line: [
        {
          Amount: input.amount,
          LinkedTxn: [{ TxnId: input.invoiceId, TxnType: "Invoice" }],
        },
      ],
    },
  });
  const id = firstId(result.json);
  if (!result.ok || !id) throw new Error("QuickBooks did not accept that payment record.");
  return id;
}
