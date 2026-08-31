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

export function liveQboTransport(input: { accessToken: string; realmId: string }): QboTransport {
  return async ({ method, path, query, body }) => {
    const url = new URL(`${quickbooksApiBase()}/v3/company/${input.realmId}${path}`);
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
  const entity = (record.Customer || record.Invoice || record.Payment || record) as Record<string, unknown>;
  return typeof entity.Id === "string" ? entity.Id : undefined;
}

function queryId(json: unknown, key: string): string | undefined {
  const query = (json as { QueryResponse?: Record<string, unknown> })?.QueryResponse;
  const rows = query?.[key];
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== "object") return undefined;
  const id = (rows[0] as { Id?: string }).Id;
  return id;
}

export async function qboFindCustomer(
  transport: QboTransport,
  displayName: string
): Promise<string | null> {
  const safe = displayName.replaceAll("'", "\\'");
  const result = await transport({
    method: "GET",
    path: "/query",
    query: `select * from Customer where DisplayName = '${safe}'`,
  });
  if (!result.ok) return null;
  return queryId(result.json, "Customer") ?? null;
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
    lines: { description: string; quantity: number; unitPrice: number; amount: number }[];
  }
): Promise<string> {
  const line = input.lines.length
    ? input.lines.map((item) => ({
        Amount: item.amount,
        DetailType: "SalesItemLineDetail",
        Description: item.description,
        SalesItemLineDetail: { Qty: item.quantity, UnitPrice: item.unitPrice },
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
