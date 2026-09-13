import { afterEach, describe, expect, it, vi } from "vitest";
import { liveQboTransport, qboCreateOrUpdateInvoice } from "@/lib/quickbooks/client";
import {
  formatQboDiagnostic,
  logQuickBooksDiagnostic,
  parseQboFault,
  qboFailure,
  readIntuitTid,
} from "@/lib/quickbooks/diagnostics";
import { exchangeQuickBooksCode } from "@/lib/quickbooks/oauth";

describe("QuickBooks intuit_tid capture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads intuit_tid from Intuit response headers", () => {
    const headers = new Headers({ intuit_tid: "tid-sandbox-123" });
    expect(readIntuitTid(headers)).toBe("tid-sandbox-123");
    expect(readIntuitTid(new Headers({ "Intuit-Tid": "tid-mixed" }))).toBe("tid-mixed");
    expect(readIntuitTid(new Headers())).toBeNull();
  });

  it("parses Intuit validation Fault payloads without tokens", () => {
    const fault = parseQboFault({
      Fault: {
        type: "ValidationFault",
        Error: [{ Message: "Request has invalid or unsupported property", code: "2010" }],
      },
    });
    expect(fault).toEqual({
      type: "ValidationFault",
      code: "2010",
      message: "Request has invalid or unsupported property",
    });
    const formatted = formatQboDiagnostic({
      fallback: "QuickBooks did not accept that invoice.",
      status: 400,
      intuitTid: "tid-abc",
      fault,
    });
    expect(formatted).toContain("intuit_tid=tid-abc");
    expect(formatted).toContain("2010");
    expect(formatted).not.toMatch(/Bearer |access_token|client_secret/i);
  });

  it("captures intuit_tid from a mocked Intuit API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            Fault: {
              type: "ValidationFault",
              Error: [{ Message: "Stale Object Error", code: "5010" }],
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", intuit_tid: "tid-from-intuit" },
          }
        )
      )
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const transport = liveQboTransport({
      accessToken: "secret-access-token-should-not-appear",
      realmId: "realm-1",
      environment: "sandbox",
    });
    const result = await transport({ method: "GET", path: "/invoice/1" });
    expect(result.ok).toBe(false);
    expect(result.intuitTid).toBe("tid-from-intuit");
    expect(info.mock.calls.some((call) => String(call[0]).includes("tid-from-intuit"))).toBe(true);
    expect(info.mock.calls.join(" ")).not.toMatch(/secret-access-token|Authorization|Bearer /);
  });

  it("includes intuit_tid on failed invoice writes so sync events can store it", async () => {
    const transport = async () => ({
      ok: false,
      status: 400,
      json: {
        Fault: {
          type: "ValidationFault",
          Error: [{ Message: "Required param missing", code: "2020" }],
        },
      },
      intuitTid: "tid-invoice-fail",
    });
    await expect(
      qboCreateOrUpdateInvoice(transport, {
        customerId: "1",
        docNumber: "INV-1",
        txnDate: "2026-09-13",
        lines: [{ description: "Labor", quantity: 1, unitPrice: 10, amount: 10 }],
      })
    ).rejects.toThrow(/intuit_tid=tid-invoice-fail/);
  });

  it("does not log secrets from diagnostic helper", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logQuickBooksDiagnostic({
      method: "POST",
      path: "/invoice",
      status: 400,
      intuitTid: "tid-ok",
      fault: { type: "ValidationFault", code: "2010", message: "bad field" },
    });
    expect(info).toHaveBeenCalled();
    expect(String(info.mock.calls[0]?.[0])).toContain("tid-ok");
    expect(String(info.mock.calls[0]?.[0])).not.toMatch(/Bearer |access_token/i);
    const skipped = qboFailure(
      {
        ok: false,
        status: 401,
        json: {},
        intuitTid: "tid-auth",
      },
      "QuickBooks authorization needs to be renewed."
    );
    expect(skipped.intuitTid).toBe("tid-auth");
    expect(skipped.message).toContain("intuit_tid=tid-auth");
  });

  it("captures intuit_tid on failed OAuth token exchange without logging secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "Content-Type": "application/json", intuit_tid: "tid-oauth-fail" },
        })
      )
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(
      exchangeQuickBooksCode("auth-code", { clientId: "cid", clientSecret: "super-secret", environment: "sandbox", source: "env" })
    ).rejects.toThrow(/intuit_tid=tid-oauth-fail/);
    expect(info.mock.calls.some((call) => String(call[0]).includes("tid-oauth-fail"))).toBe(true);
    expect(info.mock.calls.join(" ")).not.toMatch(/super-secret|Authorization|auth-code|Bearer /);
  });
});
