import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveJobOperationalAlerts } from "@/lib/jobs/operations";
import { can } from "@/lib/permissions";

describe("Owner and office 360 integration", () => {
  it("derives job alerts only from persisted operational state", () => {
    expect(deriveJobOperationalAlerts({
      status: "ON_HOLD",
      confirmationFailed: true,
      assignments: [],
      waitingRecords: [{ state: "ACTIVE" }],
      estimates: [{ status: "SENT" }],
      invoices: [{ status: "OVERDUE", balanceCents: 12_500 }],
    })).toEqual([
      "Technician Unassigned",
      "Customer Waiting",
      "Appointment Conflict",
      "Estimate Awaiting Approval",
      "Payment Due",
    ]);
    expect(deriveJobOperationalAlerts({
      status: "COMPLETED",
      assignments: [{}],
      waitingRecords: [],
      estimates: [],
      invoices: [],
    })).toEqual(["Missing Invoice"]);
  });

  it("reuses Job 360 for the lazy Dispatch job panel", () => {
    const loader = readFileSync(resolve("src/lib/dispatch/job-panel.ts"), "utf8");
    expect(loader).toContain("loadJob360");
    const drawer = readFileSync(resolve("src/components/dispatch/job-drawer.tsx"), "utf8");
    expect(drawer).toContain("/api/dispatch/jobs/");
    expect(drawer).toContain("Open Job 360");
    expect(drawer).toContain("CompanySmsForm");
  });

  it("uses PricebookItem as Parts Bank rather than creating a duplicate part catalog", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    expect(schema).toContain("part      PricebookItem");
    expect(schema).not.toContain("model Part ");
    expect(schema).toContain("model InventoryMovement");
    expect(schema).toContain("model InventoryLocation");
    expect(schema).toContain("model JobPart");
  });

  it("keeps inventory consumption and job cost in one transaction", () => {
    const actions = readFileSync(resolve("src/server/actions/job-parts.ts"), "utf8");
    expect(actions).toContain('type: "CONSUME"');
    expect(actions).toContain('sourceType: "INVENTORY"');
    expect(actions).toContain('category: "MATERIALS"');
    expect(actions).toContain("alreadyInstalled");
  });

  it("keeps inventory permissions role-aware", () => {
    expect(can("COMPANY_OWNER", "inventory:manage")).toBe(true);
    expect(can("OFFICE", "inventory:manage")).toBe(true);
    expect(can("DISPATCHER", "inventory:use")).toBe(true);
    expect(can("TECHNICIAN", "inventory:use")).toBe(true);
    expect(can("TECHNICIAN", "inventory:manage")).toBe(false);
    expect(can("SALES", "inventory:view")).toBe(false);
  });

  it("keeps QuickBooks outside owner cleanup implementation", () => {
    const changedAreas = [
      "src/lib/jobs/operations.ts",
      "src/lib/dispatch/job-panel.ts",
      "src/server/actions/job-parts.ts",
      "src/server/actions/inventory.ts",
    ].map((path) => readFileSync(resolve(path), "utf8")).join("\n");
    expect(changedAreas).not.toContain("quickBooks");
    expect(changedAreas).not.toContain("QuickBooksMapping");
  });
});
