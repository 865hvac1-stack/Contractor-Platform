import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Customer 360 edit", () => {
  it("exposes Edit customer on Customer 360 and office, with a server-side manage action", () => {
    const view = readFileSync(resolve("src/components/customers/customer-360-view.tsx"), "utf8");
    const editor = readFileSync(resolve("src/components/customers/customer-record-editor.tsx"), "utf8");
    const action = readFileSync(resolve("src/server/actions/customers.ts"), "utf8");
    const office = readFileSync(resolve("src/app/(app)/office/customers/[id]/page.tsx"), "utf8");
    const page = readFileSync(resolve("src/app/(app)/customers/[id]/page.tsx"), "utf8");
    expect(view).toMatch(/Edit customer/);
    expect(editor).toMatch(/updateCustomerProfileAction/);
    expect(editor).toMatch(/businessName/);
    expect(editor).toMatch(/secondaryPhone/);
    expect(editor).toMatch(/notes/);
    expect(action).toMatch(/requirePermission\("customers:manage"\)/);
    expect(action).toMatch(/canonicalizeUsPhone/);
    expect(action).toMatch(/companyId: ctx\.company\.id/);
    expect(action).toMatch(/where: \{ id: customer\.id \}/);
    expect(action).toMatch(/confirmSharedPhone/);
    expect(office).toMatch(/CustomerRecordEditor/);
    expect(page).toMatch(/CustomerRecordEditor/);
    expect(page).toMatch(/can\(ctx\.role, "customers:manage"\)/);
  });

  it("normalizes create and edit phones to the same canonical value", () => {
    const action = readFileSync(resolve("src/server/actions/customers.ts"), "utf8");
    expect(action).toMatch(/phone: canonicalizeUsPhone\(phone\)/);
    expect(action).toMatch(/findCustomerByEmailOrPhone/);
    expect(action).toMatch(/updateCustomerProfileAction/);
    expect(action).toMatch(/createCustomerAction/);
  });
});
