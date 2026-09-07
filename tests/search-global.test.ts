import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAddressMatch, scoreCodeMatch, scoreNameMatch, scorePhoneMatch } from "@/lib/search/rank";
import { customerSearchWhere } from "@/lib/customers/search";

describe("global search ranking", () => {
  it("ranks exact customer names and phones first", () => {
    expect(scoreNameMatch("Carolyn Everett", "Carolyn Everett")).toBeGreaterThan(
      scoreNameMatch("Carolyn Everett", "Carolyn Edwards")
    );
    expect(scoreNameMatch("Carolyn", "Carolyn Everett")).toBeGreaterThan(scoreNameMatch("Carolyn", "Eric Carlson"));
    expect(scorePhoneMatch("8655551234", "(865) 555-1234")).toBeGreaterThan(
      scorePhoneMatch("8655551234", "865-555-9999")
    );
    expect(scoreCodeMatch("34647035", "JOB-34647035")).toBeGreaterThan(scoreCodeMatch("34647035", "JOB-11111111"));
    expect(scoreAddressMatch("Tassel Pike", "123 Tassel Pike")).toBeGreaterThan(0);
  });

  it("matches first and last name together, last name alone, and digits", () => {
    const where = customerSearchWhere("co_1", "Carolyn Everett");
    expect(JSON.stringify(where)).toContain("Carolyn");
    expect(JSON.stringify(where)).toContain("Everett");
    expect(JSON.stringify(customerSearchWhere("co_1", "865-555-1234"))).toContain("8655551234");
  });
});

describe("global search wiring", () => {
  it("keeps tenant-scoped permission-aware search and grouped typeahead", () => {
    const search = readFileSync(resolve("src/lib/search/global.ts"), "utf8");
    const ui = readFileSync(resolve("src/components/global-search.tsx"), "utf8");
    const shell = readFileSync(resolve("src/components/app-shell.tsx"), "utf8");
    const api = readFileSync(resolve("src/app/api/search/route.ts"), "utf8");
    expect(search).toContain("companyId");
    expect(search).toContain("can(input.role, \"customers:view\")");
    expect(search).toContain("can(input.role, \"invoices:view\"");
    expect(search).toContain("assignedOnly");
    expect(search).toContain("customerIdsByNormalizedPhone");
    expect(search).not.toMatch(/openai|fuzzy/i);
    expect(ui).toContain("ArrowDown");
    expect(ui).toContain("No results for");
    expect(ui).toContain("Search unavailable. Try again.");
    expect(ui).toContain("⌘K");
    expect(shell).not.toContain("overflow-hidden");
    expect(api).toContain("requireTenant");
  });
});
