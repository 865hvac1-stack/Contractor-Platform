import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MORE_NAV,
  PRIMARY_NAV,
  filterNavItems,
  isNavItemActive,
  isSettingsActive,
  visibleMobileTabs,
  visibleMoreNav,
  visiblePrimaryNav,
} from "@/lib/nav";
import { landingPath } from "@/lib/workspaces";
import { CUSTOMERS_PAGE_SIZE } from "@/lib/customers/list";

describe("nav catalog", () => {
  it("keeps the everyday shell to five destinations", () => {
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Jobs & Dispatch",
      "Customers",
      "Money",
      "Marketing",
    ]);
  });

  it("keeps depth in More instead of deleting destinations", () => {
    const labels = MORE_NAV.map((item) => item.label);
    for (const label of [
      "Action Center",
      "Intelligence",
      "Inbox",
      "Playbooks",
      "Invoices",
      "Pricebook",
      "Memberships",
      "Team",
      "Reports",
    ]) {
      expect(labels).toContain(label);
    }
  });
});

describe("hub highlighting", () => {
  it("treats Waiting and Estimates as Jobs hub routes", () => {
    const jobs = PRIMARY_NAV.find((item) => item.label === "Jobs & Dispatch")!;
    expect(isNavItemActive("/jobs", jobs)).toBe(true);
    expect(isNavItemActive("/dispatch", jobs)).toBe(true);
    expect(isNavItemActive("/operations/waiting", jobs)).toBe(true);
    expect(isNavItemActive("/estimates/abc", jobs)).toBe(true);
    expect(isNavItemActive("/settings/playbooks", jobs)).toBe(false);
  });

  it("treats invoices and payments as Money hub routes", () => {
    const money = PRIMARY_NAV.find((item) => item.label === "Money")!;
    expect(isNavItemActive("/money", money)).toBe(true);
    expect(isNavItemActive("/invoices/xyz", money)).toBe(true);
    expect(isNavItemActive("/payments", money)).toBe(true);
    expect(isNavItemActive("/reports", money)).toBe(false);
  });

  it("keeps Settings separate from Playbooks configuration in More", () => {
    expect(isSettingsActive("/settings")).toBe(true);
    expect(isSettingsActive("/settings/highlevel")).toBe(true);
    expect(isSettingsActive("/settings/playbooks")).toBe(false);
  });
});

describe("role-aware navigation", () => {
  it("shows owners the full primary shell", () => {
    expect(visiblePrimaryNav("COMPANY_OWNER").map((item) => item.label)).toEqual([
      "Home",
      "Jobs & Dispatch",
      "Customers",
      "Money",
      "Marketing",
    ]);
    expect(visibleMoreNav("COMPANY_OWNER").some((item) => item.label === "Compensation")).toBe(true);
  });

  it("hides Money and Marketing from dispatchers", () => {
    expect(visiblePrimaryNav("DISPATCHER").map((item) => item.label)).toEqual([
      "Home",
      "Jobs & Dispatch",
      "Customers",
    ]);
    expect(visibleMoreNav("DISPATCHER").some((item) => item.label === "Inbox")).toBe(false);
    expect(visibleMoreNav("DISPATCHER").some((item) => item.label === "Waiting Board")).toBe(false);
  });

  it("lets office see Money without owner-only compensation", () => {
    expect(visiblePrimaryNav("OFFICE").map((item) => item.label)).toContain("Money");
    expect(filterNavItems(MORE_NAV, "OFFICE").map((item) => item.label)).not.toContain("Compensation");
  });

  it("does not invent a marketing destination for technicians in the office catalog", () => {
    expect(visiblePrimaryNav("TECHNICIAN").some((item) => item.label === "Marketing")).toBe(false);
    expect(visibleMoreNav("TECHNICIAN").some((item) => item.label === "Reports")).toBe(false);
  });

  it("sends office roles to Home and field roles to the tech app", () => {
    expect(landingPath("COMPANY_OWNER")).toBe("/dashboard");
    expect(landingPath("DISPATCHER")).toBe("/dashboard");
    expect(landingPath("OFFICE")).toBe("/dashboard");
    expect(landingPath("TECHNICIAN")).toBe("/tech");
  });
});

describe("sidebar and mobile source", () => {
  it("uses a flat primary list plus More and a mobile tab bar", () => {
    const nav = readFileSync(resolve("src/components/app-nav.tsx"), "utf8");
    expect(nav).toContain("visiblePrimaryNav");
    expect(nav).toContain("MORE_ITEM");
    expect(nav).not.toContain("Command Center");
    expect(nav).not.toContain("aria-expanded");
    const shell = readFileSync(resolve("src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain("<AppNav");
    expect(shell).toContain("MobileTabBar");
    expect(shell).toContain("GlobalSearch");
    expect(shell).toContain("h-dvh");
    expect(shell).toContain("md:overflow-y-auto");
    expect(shell).toContain("<SettingsLink");
    expect(shell).toContain('can(role, "company:settings")');
    const more = readFileSync(resolve("src/app/(app)/more/page.tsx"), "utf8");
    expect(more).toContain("SETTINGS_ITEM");
    expect(more).toContain('can(ctx.role, "company:settings")');
    expect(visibleMobileTabs("COMPANY_OWNER").map((item) => item.label)).toEqual([
      "Home",
      "Jobs & Dispatch",
      "Customers",
      "More",
    ]);
    expect(shell).not.toContain("WorkspaceSwitcher");
    const jobsPage = readFileSync(resolve("src/app/(app)/jobs/page.tsx"), "utf8");
    expect(jobsPage).toContain("DispatchWorkspace");
    expect(jobsPage).toContain('return hasListIntent ? "all" : "dispatch"');
    const tabs = readFileSync(resolve("src/components/hub-subnav.tsx"), "utf8");
    for (const label of ["Dispatch Board", "All Jobs", "Waiting", "Estimates", "Completed", "Needs Attention"]) {
      expect(tabs).toContain(label);
    }
  });
});

describe("home and customers simplification", () => {
  it("keeps Home to today, needs you, ask, and one snapshot", () => {
    const page = readFileSync(resolve("src/app/(app)/dashboard/page.tsx"), "utf8");
    expect(page).toContain("getHomeSummary");
    expect(page).toContain("NeedsYou");
    expect(page).toContain("AskContractorYou");
    expect(page).toContain("CommandHero");
    expect(page).toContain("BusinessSnapshot");
    expect(page).not.toContain("HealthHero");
    expect(page).not.toContain("MetricRing");
    expect(page).not.toContain("RevenueChart");
    expect(page).not.toMatch(/\$36,924|\$66,801|\$17,480/);
  });

  it("paginates customers instead of dumping the directory", () => {
    expect(CUSTOMERS_PAGE_SIZE).toBe(25);
    const page = readFileSync(resolve("src/app/(app)/customers/page.tsx"), "utf8");
    expect(page).toContain("loadCustomerList");
    expect(page).toContain("+ Add Customer");
    expect(page).toContain("Needs attention");
  });
});
