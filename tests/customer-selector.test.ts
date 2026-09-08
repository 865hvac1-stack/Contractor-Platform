import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { customerSearchWhere } from "@/lib/customers/search";
import { customerJobsWhere } from "@/lib/customers/jobs";

describe("Customer search combobox", () => {
  it("searches name, phone, email, address, and company without loading the full table", () => {
    const where = customerSearchWhere("co_1", "Carolyn Everett");
    const text = JSON.stringify(where);
    expect(where.companyId).toBe("co_1");
    expect(text).toContain("firstName");
    expect(text).toContain("lastName");
    expect(text).toContain("businessName");
    expect(text).toContain("email");
    expect(text).toContain("phone");
    expect(text).toContain("properties");
    expect(customerSearchWhere("co_1", "865-555-1234").OR?.some((clause) => JSON.stringify(clause).includes("8655551234"))).toBe(
      true
    );
  });

  it("scopes job search to the selected customer", () => {
    const where = customerJobsWhere("co_1", "cu_1", "No Cooling");
    expect(where.companyId).toBe("co_1");
    expect(where.customerId).toBe("cu_1");
    expect(JSON.stringify(where)).toContain("No Cooling");
    expect(JSON.stringify(customerJobsWhere("co_2", "cu_2"))).not.toContain("cu_1");
  });

  it("replaces New Invoice and New Estimate dropdowns with the reusable selector", () => {
    const invoice = readFileSync(resolve("src/app/(app)/invoices/new/page.tsx"), "utf8");
    const estimate = readFileSync(resolve("src/app/(app)/estimates/new/page.tsx"), "utf8");
    const combobox = readFileSync(resolve("src/components/customers/search-combobox.tsx"), "utf8");
    const fields = readFileSync(resolve("src/components/customers/customer-job-fields.tsx"), "utf8");
    const picker = readFileSync(resolve("src/components/jobs/customer-job-picker.tsx"), "utf8");
    const writer = readFileSync(resolve("src/components/intelligence/professional-writer.tsx"), "utf8");
    const billing = readFileSync(resolve("src/server/actions/billing.ts"), "utf8");
    expect(invoice).toContain("CustomerJobFields");
    expect(invoice).toContain("writingAssist");
    expect(invoice).not.toMatch(/prisma\.customer\.findMany/);
    expect(invoice).not.toMatch(/Select customer/);
    expect(estimate).toContain("CustomerJobFields");
    expect(estimate).not.toMatch(/prisma\.customer\.findMany/);
    expect(combobox).toContain("/api/customers/search");
    expect(combobox).toContain("ArrowDown");
    expect(combobox).toContain("Add new customer");
    expect(fields).toContain("/api/customers/${customer.id}/jobs");
    expect(fields).toContain('setJobId("")');
    expect(picker).toContain("CustomerSearchCombobox");
    expect(writer).toContain("Make this professional");
    expect(billing).toContain("customerId: d.customerId");
    expect(billing).toContain("lineTotalCents");
  });
});
