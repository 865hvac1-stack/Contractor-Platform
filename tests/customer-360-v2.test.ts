import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatDateTime, formatTime } from "@/lib/datetime";
import { canonicalizeUsPhone } from "@/lib/phone";

describe("Customer 360 V2 workspace", () => {
  it("moves edit and add-property into drawers and keeps working actions", () => {
    const view = readFileSync(resolve("src/components/customers/customer-360-view.tsx"), "utf8");
    const actions = readFileSync(resolve("src/components/customers/customer-360-actions.tsx"), "utf8");
    const page = readFileSync(resolve("src/app/(app)/customers/[id]/page.tsx"), "utf8");
    const office = readFileSync(resolve("src/app/(app)/office/customers/[id]/page.tsx"), "utf8");
    expect(page).not.toMatch(/CustomerRecordEditor/);
    expect(office).not.toMatch(/CustomerRecordEditor/);
    expect(actions).toMatch(/Sheet/);
    expect(actions).toMatch(/mode="profile"/);
    expect(actions).toMatch(/mode="property"/);
    expect(actions).toMatch(/updateCustomerProfileAction|CustomerRecordEditor/);
    expect(view).toMatch(/smsHref/);
    expect(view).toMatch(/marketing\/communications\?compose=1/);
    expect(view).not.toMatch(/CompanySmsForm/);
    expect(view).toMatch(/#active-work/);
    expect(view).toMatch(/CustomerHistoryTabs/);
    expect(view).toMatch(/CustomerTimeline/);
    expect(view).toMatch(/AskContractorYou/);
    expect(view).toMatch(/timeZone/);
  });

  it("keeps phone normalization and HighLevel identity resolution intact", () => {
    const action = readFileSync(resolve("src/server/actions/customers.ts"), "utf8");
    const identity = readFileSync(resolve("src/lib/highlevel/identity.ts"), "utf8");
    const comms = readFileSync(resolve("src/lib/highlevel/communication-provider.ts"), "utf8");
    expect(action).toMatch(/canonicalizeUsPhone/);
    expect(canonicalizeUsPhone("8658514300")).toBe("+18658514300");
    expect(identity).toMatch(/companyId_provider_entityType_externalId/);
    expect(identity).toMatch(/byExternal/);
    expect(comms).toMatch(/linkHighLevelCustomerContact/);
    expect(comms).toMatch(/resolveApprovedSenderNumber/);
  });

  it("uses 12-hour display for customer timestamps", () => {
    expect(formatTime("2026-09-08T20:20:00.000Z", "UTC")).toBe("8:20 PM");
    expect(formatDateTime("2026-09-08T13:05:00.000Z", "UTC")).toBe("Sep 8, 2026 · 1:05 PM");
    const view = readFileSync(resolve("src/components/customers/customer-360-view.tsx"), "utf8");
    expect(view).toMatch(/formatDayTime|formatDate/);
    expect(view).not.toMatch(/toLocaleString\(/);
  });

  it("makes snapshot and financial metrics clickable", () => {
    const view = readFileSync(resolve("src/components/customers/customer-360-view.tsx"), "utf8");
    expect(view).toMatch(/GlanceCard/);
    expect(view).toMatch(/href="#active-work"/);
    expect(view).toMatch(/href="#financial"/);
    expect(view).toMatch(/MoneyLink/);
    expect(view).toMatch(/\/invoices\?customerId=/);
    expect(view).toMatch(/\/payments\?customerId=/);
  });
});
