import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventScopeWhere,
  evaluateQuickBooksWriteGuard,
  mappingBelongsToScope,
  mappingScopeWhere,
  QBO_SCOPE_MISMATCH_MESSAGE,
  type QuickBooksScope,
} from "@/lib/quickbooks/ownership";
import { invoiceMappingIdentity } from "@/lib/quickbooks/mappings";
import { canAutoSyncInvoice } from "@/lib/quickbooks/sync";
import { liveQboTransport, qboCompanyInfo, type QboTransport } from "@/lib/quickbooks/client";
import { queryQuickBooksProductionPreview } from "@/lib/quickbooks/production-preview";

const production: QuickBooksScope = {
  companyId: "company-a",
  environment: "production",
  realmId: "prod-realm",
};
const sandbox: QuickBooksScope = {
  companyId: "company-a",
  environment: "sandbox",
  realmId: "sandbox-realm",
};

function scopedMapping(scope: QuickBooksScope, quickbooksId = "145") {
  return {
    ...scope,
    ownershipStatus: "SCOPED",
    quickbooksId,
  };
}

function transportFor(scope: QuickBooksScope): QboTransport {
  const apiHost =
    scope.environment === "production"
      ? "quickbooks.api.intuit.com"
      : "sandbox-quickbooks.api.intuit.com";
  return Object.assign(
    vi.fn(async () => ({ ok: true, status: 200, json: {} })) as QboTransport,
    { context: { ...scope, apiHost } }
  );
}

describe("QuickBooks realm and environment isolation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("A/B/D rejects sandbox mapping in production and production mapping in sandbox", () => {
    expect(mappingBelongsToScope(scopedMapping(sandbox), production)).toBe(false);
    expect(mappingBelongsToScope(scopedMapping(production), sandbox)).toBe(false);
    expect(mappingBelongsToScope(scopedMapping(sandbox, "145"), production)).toBe(false);
  });

  it("C gives the same internal invoice independent identities per realm/environment", () => {
    const prodIdentity = invoiceMappingIdentity({ ...production, invoiceId: "invoice-1" });
    const sandboxIdentity = invoiceMappingIdentity({ ...sandbox, invoiceId: "invoice-1" });
    expect(prodIdentity.internalId).toBe(sandboxIdentity.internalId);
    expect(prodIdentity).not.toEqual(sandboxIdentity);
  });

  it("E/F scopes Sync Center event and mapping selectors to the active production connection", () => {
    expect(mappingScopeWhere(production)).toEqual({
      companyId: "company-a",
      environment: "production",
      realmId: "prod-realm",
      ownershipStatus: "SCOPED",
    });
    expect(eventScopeWhere(production)).toEqual({
      companyId: "company-a",
      environment: "production",
      realmId: "prod-realm",
      ownershipStatus: "SCOPED",
    });
  });

  it("I protects historical and reference records from automatic or direct writes", () => {
    expect(
      canAutoSyncInvoice({
        trigger: "WHEN_CREATED",
        event: "created",
        importMode: "HISTORICAL",
      }).allowed
    ).toBe(false);
    for (const importMode of ["HISTORICAL", "REFERENCE"]) {
      const guarded = evaluateQuickBooksWriteGuard({
        scope: production,
        transport: transportFor(production),
        entityType: "INVOICE",
        importMode,
      });
      expect(guarded.ok).toBe(false);
    }
  });

  it("J/K blocks invoice and payment writes on realm mismatch", () => {
    for (const entityType of ["INVOICE", "PAYMENT"]) {
      const guarded = evaluateQuickBooksWriteGuard({
        scope: production,
        transport: transportFor(sandbox),
        entityType,
      });
      expect(guarded).toEqual({ ok: false, error: QBO_SCOPE_MISMATCH_MESSAGE });
    }
  });

  it("L rejects a Product/Service mapping owned by another realm", () => {
    const guarded = evaluateQuickBooksWriteGuard({
      scope: production,
      transport: transportFor(production),
      entityType: "INVOICE",
      mapping: scopedMapping(sandbox),
    });
    expect(guarded.ok).toBe(false);
  });

  it("G/H production preview uses GET queries only and has no persistence dependency", async () => {
    const calls: Array<{ method: string; path: string; query?: string }> = [];
    const transport = Object.assign(
      (async (input: { method: "GET" | "POST" | "POST_JSON"; path: string; query?: string }) => {
        calls.push(input);
        const entity = input.query?.match(/from (\w+)/i)?.[1] || "Customer";
        if (/count\(\*\)/i.test(input.query || "")) {
          return { ok: true, status: 200, json: { QueryResponse: { totalCount: 3 } } };
        }
        const key = entity === "Purchase" ? "Purchase" : entity;
        return {
          ok: true,
          status: 200,
          json: {
            QueryResponse: {
              [key]: Array.from({ length: 12 }, (_, index) => ({
                Id: String(index + 1),
                DisplayName: `Customer ${index + 1}`,
                DocNumber: `INV-${index + 1}`,
                Name: `Item ${index + 1}`,
                TxnDate: "2026-09-01",
                Balance: 0,
                TotalAmt: 10,
              })),
            },
          },
        };
      }) as QboTransport,
      { context: { ...production, apiHost: "quickbooks.api.intuit.com" } }
    );
    const preview = await queryQuickBooksProductionPreview(transport, production);
    expect(preview.customers.count).toBe(3);
    expect(preview.customers.sample).toHaveLength(10);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === "GET" && call.path === "/query")).toBe(true);
  });

  it("M uses the production hostname for CompanyInfo", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ CompanyInfo: { CompanyName: "TJ HURST HVAC" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = liveQboTransport({
      accessToken: "not-logged",
      companyId: production.companyId,
      realmId: production.realmId,
      environment: "production",
    });
    await qboCompanyInfo(transport, production.realmId);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^https:\/\/quickbooks\.api\.intuit\.com\//);
  });

  it("N uses the sandbox hostname for CompanyInfo", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ CompanyInfo: { CompanyName: "Sandbox" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = liveQboTransport({
      accessToken: "not-logged",
      companyId: sandbox.companyId,
      realmId: sandbox.realmId,
      environment: "sandbox",
    });
    await qboCompanyInfo(transport, sandbox.realmId);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^https:\/\/sandbox-quickbooks\.api\.intuit\.com\//);
  });
});

