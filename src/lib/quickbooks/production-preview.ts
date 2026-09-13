import type { PrismaClient } from "@prisma/client";
import type { QboTransport } from "@/lib/quickbooks/client";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { getActiveQuickBooksScope, type QuickBooksScope } from "@/lib/quickbooks/ownership";

type QueryResponse = { QueryResponse?: Record<string, unknown> & { totalCount?: number } };

class QuickBooksPreviewReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null
  ) {
    super(message);
  }
}

async function readOnlyQuery(transport: QboTransport, query: string) {
  const result = await transport({ method: "GET", path: "/query", query });
  if (!result.ok) {
    const message =
      result.status === 429
        ? "Temporarily unavailable because QuickBooks is limiting read requests."
        : `QuickBooks could not read this category (${result.status}).`;
    throw new QuickBooksPreviewReadError(message, result.status, result.retryAfterSeconds ?? null);
  }
  return result.json as QueryResponse;
}

function total(json: QueryResponse) {
  return typeof json.QueryResponse?.totalCount === "number" ? json.QueryResponse.totalCount : 0;
}

function rows<T>(json: QueryResponse, key: string): T[] {
  const value = json.QueryResponse?.[key];
  return Array.isArray(value) ? (value as T[]).slice(0, 10) : [];
}

export type QuickBooksPreviewCategory<T> = {
  count: number | null;
  sample: T[];
  error: string | null;
};

export type QuickBooksProductionPreview = {
  environment: "sandbox" | "production";
  realmId: string;
  customers: QuickBooksPreviewCategory<{ id: string; name: string }>;
  invoices: QuickBooksPreviewCategory<{
    id: string;
    number: string;
    date: string | null;
    status: "Open" | "Paid";
  }>;
  payments: QuickBooksPreviewCategory<{ id: string; date: string | null; amount: number | null }>;
  items: QuickBooksPreviewCategory<{ id: string; name: string; type: string | null }>;
  expenses: QuickBooksPreviewCategory<{ id: string; date: string | null; amount: number | null }>;
};

const PREVIEW_CACHE_TTL_MS = 3 * 60 * 1_000;
const PREVIEW_REFRESH_COOLDOWN_MS = 60 * 1_000;
const previewCache = new Map<
  string,
  { expiresAt: number; value: Promise<QuickBooksProductionPreview> }
>();
const refreshCooldown = new Map<string, number>();

export function quickBooksPreviewCacheKey(scope: QuickBooksScope) {
  return `${scope.companyId}:${scope.environment}:${scope.realmId}`;
}

export function getCachedQuickBooksPreview(
  scope: QuickBooksScope,
  loader: () => Promise<QuickBooksProductionPreview>,
  now = Date.now()
) {
  const key = quickBooksPreviewCacheKey(scope);
  const cached = previewCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = loader().catch((error) => {
    previewCache.delete(key);
    throw error;
  });
  previewCache.set(key, { expiresAt: now + PREVIEW_CACHE_TTL_MS, value });
  if (!refreshCooldown.has(key)) refreshCooldown.set(key, now);
  return value;
}

export function requestQuickBooksPreviewRefresh(scope: QuickBooksScope, now = Date.now()) {
  const key = quickBooksPreviewCacheKey(scope);
  const last = refreshCooldown.get(key) ?? 0;
  if (last + PREVIEW_REFRESH_COOLDOWN_MS > now) {
    return {
      ok: false as const,
      retryAfterSeconds: Math.ceil((last + PREVIEW_REFRESH_COOLDOWN_MS - now) / 1_000),
    };
  }
  refreshCooldown.set(key, now);
  previewCache.delete(key);
  return { ok: true as const };
}

export function resetQuickBooksPreviewCacheForTests() {
  previewCache.clear();
  refreshCooldown.clear();
}

export async function loadQuickBooksProductionPreview(
  prisma: PrismaClient,
  companyId: string
): Promise<QuickBooksProductionPreview> {
  const active = await getActiveQuickBooksScope(prisma, companyId);
  if (!active.ok) throw new Error(active.error);
  return getCachedQuickBooksPreview(active.scope, async () => {
    const loaded = await loadQuickBooksTransport(companyId);
    if (!loaded.ok) throw new Error(loaded.error);
    if (
      loaded.environment !== active.scope.environment ||
      loaded.realmId !== active.scope.realmId
    ) {
      throw new Error("QuickBooks connection changed while loading the preview. Refresh and try again.");
    }
    return queryQuickBooksProductionPreview(loaded.transport, active.scope);
  });
}

async function loadCategory<TRow, TView>(
  transport: QboTransport,
  entity: string,
  key: string,
  map: (row: TRow) => TView
): Promise<QuickBooksPreviewCategory<TView>> {
  let count: number | null = null;
  let sample: TView[] = [];
  const errors: string[] = [];
  try {
    count = total(await readOnlyQuery(transport, `select count(*) from ${entity}`));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Count temporarily unavailable.");
  }
  try {
    sample = rows<TRow>(
      await readOnlyQuery(transport, `select * from ${entity} MAXRESULTS 10`),
      key
    ).map(map);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Sample temporarily unavailable.");
  }
  return { count, sample, error: [...new Set(errors)].join(" ") || null };
}

export async function queryQuickBooksProductionPreview(
  transport: QboTransport,
  scope: { environment: "sandbox" | "production"; realmId: string }
): Promise<QuickBooksProductionPreview> {
  type Customer = { Id?: string; DisplayName?: string };
  type Invoice = { Id?: string; DocNumber?: string; TxnDate?: string; Balance?: number };
  type Payment = { Id?: string; TxnDate?: string; TotalAmt?: number };
  type Item = { Id?: string; Name?: string; Type?: string };
  type Purchase = { Id?: string; TxnDate?: string; TotalAmt?: number };
  // Intentionally sequential: a cold page load performs at most ten GET
  // queries and never bursts all categories at Intuit at once.
  const customers = await loadCategory(transport, "Customer", "Customer", (row: Customer) => ({
    id: row.Id || "",
    name: row.DisplayName || "Unnamed customer",
  }));
  const invoices = await loadCategory(transport, "Invoice", "Invoice", (row: Invoice) => ({
    id: row.Id || "",
    number: row.DocNumber || "No number",
    date: row.TxnDate ?? null,
    status: (Number(row.Balance || 0) > 0 ? "Open" : "Paid") as "Open" | "Paid",
  }));
  const payments = await loadCategory(transport, "Payment", "Payment", (row: Payment) => ({
    id: row.Id || "",
    date: row.TxnDate ?? null,
    amount: typeof row.TotalAmt === "number" ? row.TotalAmt : null,
  }));
  const items = await loadCategory(transport, "Item", "Item", (row: Item) => ({
    id: row.Id || "",
    name: row.Name || "Unnamed item",
    type: row.Type ?? null,
  }));
  const expenses = await loadCategory(transport, "Purchase", "Purchase", (row: Purchase) => ({
    id: row.Id || "",
    date: row.TxnDate ?? null,
    amount: typeof row.TotalAmt === "number" ? row.TotalAmt : null,
  }));

  return {
    environment: scope.environment,
    realmId: scope.realmId,
    customers,
    invoices,
    payments,
    items,
    expenses,
  };
}

