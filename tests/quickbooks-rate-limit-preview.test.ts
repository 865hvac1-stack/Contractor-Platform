import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchQuickBooksReadWithRetry,
  retryAfterMilliseconds,
  type QboTransport,
} from "@/lib/quickbooks/client";
import {
  getCachedQuickBooksPreview,
  queryQuickBooksProductionPreview,
  requestQuickBooksPreviewRefresh,
  resetQuickBooksPreviewCacheForTests,
  type QuickBooksProductionPreview,
} from "@/lib/quickbooks/production-preview";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

const scope: QuickBooksScope = {
  companyId: "company-a",
  environment: "production",
  realmId: "realm-production",
};

function response(status: number, retryAfter?: string) {
  return new Response("{}", {
    status,
    headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
  });
}

function emptyPreview(activeScope: QuickBooksScope): QuickBooksProductionPreview {
  const empty = { count: 0, sample: [], error: null };
  return {
    environment: activeScope.environment,
    realmId: activeScope.realmId,
    customers: empty,
    invoices: empty,
    payments: empty,
    items: empty,
    expenses: empty,
  };
}

describe("QuickBooks read rate limits and preview caching", () => {
  afterEach(() => {
    resetQuickBooksPreviewCacheForTests();
    vi.restoreAllMocks();
  });

  it("honors Retry-After before retrying a 429", async () => {
    const request = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(response(429, "2"))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn(async () => undefined);
    const result = await fetchQuickBooksReadWithRetry({ request, sleep, random: () => 0 });
    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(retryAfterMilliseconds("2")).toBe(2_000);
  });

  it("uses bounded retries and never loops indefinitely", async () => {
    const request = vi.fn(async () => response(429));
    const sleep = vi.fn(async () => undefined);
    const result = await fetchQuickBooksReadWithRetry({
      request,
      sleep,
      random: () => 0,
      maxAttempts: 3,
    });
    expect(result.response.status).toBe(429);
    expect(result.attempts).toBe(3);
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry before a Retry-After value beyond the wait budget", async () => {
    const request = vi.fn(async () => response(429, "30"));
    const sleep = vi.fn(async () => undefined);
    const result = await fetchQuickBooksReadWithRetry({ request, sleep, maxDelayMs: 5_000 });
    expect(result.attempts).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns successful categories when one preview category is rate limited", async () => {
    const calls: Array<{ method: string; query?: string }> = [];
    const transport: QboTransport = async (input) => {
      calls.push(input);
      if (input.query?.includes("Payment")) {
        return {
          ok: false,
          status: 429,
          json: {},
          intuitTid: "tid-rate-limited",
          retryAfterSeconds: 30,
        };
      }
      const entity = input.query?.match(/from (\w+)/i)?.[1] || "Customer";
      if (input.query?.includes("count(*)")) {
        return { ok: true, status: 200, json: { QueryResponse: { totalCount: 7 } } };
      }
      return {
        ok: true,
        status: 200,
        json: { QueryResponse: { [entity]: [{ Id: "1", DisplayName: "Customer", Name: "Service" }] } },
      };
    };
    const preview = await queryQuickBooksProductionPreview(transport, scope);
    expect(preview.customers.count).toBe(7);
    expect(preview.items.count).toBe(7);
    expect(preview.payments.count).toBeNull();
    expect(preview.payments.error).toMatch(/limiting read requests/i);
    expect(calls).toHaveLength(10);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("deduplicates duplicate renders and isolates cache by company, environment, and realm", async () => {
    const loader = vi.fn(async () => emptyPreview(scope));
    const first = getCachedQuickBooksPreview(scope, loader, 1_000);
    const second = getCachedQuickBooksPreview(scope, loader, 1_001);
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(loader).toHaveBeenCalledTimes(1);

    const otherRealm = { ...scope, realmId: "other-realm" };
    await getCachedQuickBooksPreview(otherRealm, loader, 1_002);
    const sandbox = { ...scope, environment: "sandbox" as const, realmId: "sandbox-realm" };
    await getCachedQuickBooksPreview(sandbox, loader, 1_003);
    const otherCompany = { ...scope, companyId: "company-b" };
    await getCachedQuickBooksPreview(otherCompany, loader, 1_004);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("debounces manual preview refreshes per scoped connection", () => {
    expect(requestQuickBooksPreviewRefresh(scope, 100_000).ok).toBe(true);
    const repeated = requestQuickBooksPreviewRefresh(scope, 100_001);
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.retryAfterSeconds).toBe(60);
    expect(requestQuickBooksPreviewRefresh({ ...scope, realmId: "new-realm" }, 100_001).ok).toBe(true);
  });
});

