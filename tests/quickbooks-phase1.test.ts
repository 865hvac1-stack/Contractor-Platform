import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideCustomerMatch } from "@/lib/quickbooks/match";
import { fieldOwner, shouldOverwriteOperationalField } from "@/lib/quickbooks/ownership";
import { humanQuickBooksError, maskRealmId } from "@/lib/quickbooks/errors";
import { isEligibleForBulkSync, canAutoSyncInvoice } from "@/lib/quickbooks/sync";
import { defaultSyncStartDate, resolveSyncStartDate } from "@/lib/quickbooks/dates";
import { publicQuickBooksStatus, quickBooksCardState } from "@/lib/quickbooks/status";
import { quickbooksWebhookConfigured } from "@/lib/quickbooks/webhook";
import { can } from "@/lib/permissions";

describe("QuickBooks Phase 1 safety", () => {
  it("never auto-links customers on name alone", () => {
    const decision = decideCustomerMatch(
      { firstName: "Pat", lastName: "Smith" },
      [{ id: "1", displayName: "Pat Smith", givenName: "Pat", familyName: "Smith" }],
      "auto"
    );
    expect(decision.outcome).toBe("NEEDS_REVIEW");
  });

  it("auto-links only a unique high-confidence phone and email match", () => {
    const decision = decideCustomerMatch(
      { firstName: "Pat", lastName: "Smith", email: "pat@test.local", phone: "8655551212" },
      [
        {
          id: "QB-1",
          displayName: "Other",
          email: "pat@test.local",
          phone: "8655551212",
        },
      ],
      "auto"
    );
    expect(decision.outcome).toBe("LINKED");
    if (decision.outcome === "LINKED") expect(decision.quickbooksId).toBe("QB-1");
  });

  it("keeps operational fields on ContractorYou", () => {
    expect(fieldOwner("INVOICE", "lineItems")).toBe("contractoryou");
    expect(fieldOwner("INVOICE", "qboBalance")).toBe("quickbooks");
    expect(shouldOverwriteOperationalField()).toBe(false);
  });

  it("explains mapping problems in plain language", () => {
    expect(humanQuickBooksError({ missing: "item" })).toMatch(/Product\/Service mapping is missing/);
    expect(humanQuickBooksError({ missing: "customer" })).toMatch(/linked before invoice/);
    expect(humanQuickBooksError({ missing: "auth" })).toMatch(/renewed/);
    expect(maskRealmId("934145123456")).toBe("••••3456");
  });

  it("blocks bulk sync until the wizard activates it", () => {
    expect(
      isEligibleForBulkSync({
        importMode: "LIVE",
        recordDate: new Date(),
        syncActivated: false,
      }).allowed
    ).toBe(false);
    expect(
      isEligibleForBulkSync({
        importMode: "HISTORICAL",
        recordDate: new Date(),
        syncActivated: true,
      }).allowed
    ).toBe(false);
    expect(
      isEligibleForBulkSync({
        importMode: "LIVE",
        recordDate: new Date("2020-01-01"),
        syncActivated: true,
        syncStartDate: new Date("2026-09-01"),
      }).allowed
    ).toBe(false);
    expect(canAutoSyncInvoice({ trigger: "WHEN_CREATED", event: "created", importMode: "HISTORICAL" }).allowed).toBe(
      false
    );
  });

  it("defaults the sync start date to the start of the current month", () => {
    const now = new Date(2026, 8, 10);
    expect(defaultSyncStartDate(now)).toEqual(new Date(2026, 8, 1));
    expect(resolveSyncStartDate("today", null, now)).toEqual(new Date(2026, 8, 10));
    expect(resolveSyncStartDate("year", null, now)).toEqual(new Date(2026, 0, 1));
  });

  it("never shows Connected without a verified realm and company name", () => {
    expect(publicQuickBooksStatus({ status: "CONNECTED", externalAccountId: null })).toBe("ERROR");
    expect(
      quickBooksCardState({
        connection: { status: "CONNECTED", externalAccountId: "123" },
        verifiedCompanyName: null,
      })
    ).toBe("NEEDS_ATTENTION");
    expect(
      quickBooksCardState({
        connection: { status: "CONNECTED", externalAccountId: "123" },
        verifiedCompanyName: "865 HVAC",
      })
    ).toBe("CONNECTED");
  });

  it("does not claim webhooks are configured without a verifier token", () => {
    const prev = process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN;
    delete process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN;
    expect(quickbooksWebhookConfigured()).toBe(false);
    if (prev == null) delete process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN;
    else process.env.INTUIT_WEBHOOK_VERIFIER_TOKEN = prev;
  });

  it("keeps technicians off QuickBooks connection and accounting approval", () => {
    expect(can("TECHNICIAN", "accounting:manage")).toBe(false);
    expect(can("TECHNICIAN", "receipts:manage")).toBe(true);
    expect(can("OFFICE", "accounting:manage")).toBe(false);
    expect(can("COMPANY_OWNER", "accounting:manage")).toBe(true);
  });

  it("keeps Money cards clickable and Sync Center / wizard routes in place", () => {
    const money = readFileSync(resolve("src/app/(app)/money/page.tsx"), "utf8");
    expect(money).toContain("href={snapshot.hrefs.overdueAr}");
    expect(money).toContain("href={snapshot.hrefs.expenses}");
    expect(money).toContain("href={snapshot.hrefs.receipts}");
    expect(money).toContain("href={snapshot.hrefs.grossProfit}");
    expect(money).toContain('href="/settings/quickbooks"');
    expect(readFileSync(resolve("src/app/(app)/settings/quickbooks/manage/page.tsx"), "utf8")).toContain("Sync Center");
    expect(readFileSync(resolve("src/app/(app)/settings/quickbooks/setup/page.tsx"), "utf8")).toMatch(/safe mode/i);
    expect(readFileSync(resolve("src/app/api/integrations/quickbooks/callback/route.ts"), "utf8")).toContain(
      "quickbooks.connected"
    );
    expect(readFileSync(resolve("src/app/api/integrations/quickbooks/start/route.ts"), "utf8")).toContain(
      "accounting:manage"
    );
  });
});
