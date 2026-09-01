import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCORDION_SECTIONS,
  PRIMARY_NAV,
  accordionSectionForPath,
  filterNavItems,
  isNavItemActive,
  isSettingsActive,
  parseRememberedSection,
  resolveOpenSection,
  sectionContainsPath,
  visibleAccordionSections,
  visiblePrimaryNav,
} from "@/lib/nav";

const ALL_SECTION_IDS = ["operations", "marketing", "money", "team"] as const;

describe("nav catalog", () => {
  it("keeps daily workspaces in the always-visible primary list", () => {
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Dispatch",
      "Customer Hub",
      "Intelligence",
      "Action Center",
      "Inbox",
    ]);
  });

  it("keeps every existing destination under an accordion parent", () => {
    const labels = ACCORDION_SECTIONS.flatMap((section) => section.items.map((item) => item.label));
    expect(labels).toEqual([
      "Customers",
      "Schedule",
      "Jobs",
      "Playbooks",
      "Estimates",
      "Invoices",
      "Pricebook",
      "Memberships",
      "Marketing Hub",
      "Leads",
      "Communications",
      "Campaigns",
      "Reviews",
      "Automations",
      "Channels",
      "Payments",
      "Receipts",
      "Expenses",
      "Reports",
      "Team",
      "Compensation",
      "Scorecards",
      "My Performance",
    ]);
    expect(ACCORDION_SECTIONS.map((section) => section.label)).toEqual([
      "Operations",
      "Marketing",
      "Money",
      "Team",
    ]);
  });
});

describe("active route expansion", () => {
  it("expands Operations for estimate, invoice, and playbook deep links", () => {
    expect(accordionSectionForPath("/estimates")).toBe("operations");
    expect(accordionSectionForPath("/estimates/abc")).toBe("operations");
    expect(accordionSectionForPath("/invoices/xyz")).toBe("operations");
    expect(accordionSectionForPath("/settings/playbooks")).toBe("operations");
    expect(accordionSectionForPath("/jobs/cm123")).toBe("operations");
  });

  it("expands Marketing for marketing child routes but not Inbox", () => {
    expect(accordionSectionForPath("/marketing/reviews")).toBe("marketing");
    expect(accordionSectionForPath("/marketing")).toBe("marketing");
    expect(accordionSectionForPath("/marketing/leads")).toBe("marketing");
    expect(accordionSectionForPath("/marketing/communications")).toBeNull();
    expect(accordionSectionForPath("/marketing/communications/thread-1")).toBeNull();
  });

  it("expands Money and Team for their routes", () => {
    expect(accordionSectionForPath("/payments")).toBe("money");
    expect(accordionSectionForPath("/receipts/1")).toBe("money");
    expect(accordionSectionForPath("/team")).toBe("team");
    expect(accordionSectionForPath("/team/compensation")).toBe("team");
    expect(accordionSectionForPath("/me/performance")).toBe("team");
  });

  it("does not treat Command Center pages as accordion destinations", () => {
    expect(accordionSectionForPath("/dashboard")).toBeNull();
    expect(accordionSectionForPath("/dispatch")).toBeNull();
    expect(accordionSectionForPath("/office")).toBeNull();
    expect(accordionSectionForPath("/office/customers/1")).toBeNull();
    expect(accordionSectionForPath("/intelligence")).toBeNull();
    expect(accordionSectionForPath("/actions")).toBeNull();
  });

  it("prefers the active route over a remembered section", () => {
    expect(
      resolveOpenSection({
        pathname: "/estimates",
        remembered: "marketing",
        available: [...ALL_SECTION_IDS],
      })
    ).toBe("operations");
  });

  it("restores the last open section when the route is not in an accordion", () => {
    expect(
      resolveOpenSection({
        pathname: "/dashboard",
        remembered: "money",
        available: [...ALL_SECTION_IDS],
      })
    ).toBe("money");
  });

  it("ignores a remembered section the role cannot see", () => {
    expect(
      resolveOpenSection({
        pathname: "/dashboard",
        remembered: "marketing",
        available: ["operations", "team"],
      })
    ).toBeNull();
  });

  it("treats accordion as one-open-at-a-time", () => {
    const remembered = parseRememberedSection("operations");
    const opened = resolveOpenSection({
      pathname: "/marketing/reviews",
      remembered,
      available: [...ALL_SECTION_IDS],
    });
    expect(opened).toBe("marketing");
    expect(opened === "operations").toBe(false);
  });
});

describe("active item highlighting", () => {
  it("highlights Estimates on the estimates route and not Settings", () => {
    const estimates = ACCORDION_SECTIONS[0].items.find((item) => item.label === "Estimates")!;
    expect(isNavItemActive("/estimates", estimates)).toBe(true);
    expect(isSettingsActive("/estimates")).toBe(false);
    expect(isSettingsActive("/settings")).toBe(true);
    expect(isSettingsActive("/settings/highlevel")).toBe(true);
    expect(isSettingsActive("/settings/playbooks")).toBe(false);
  });

  it("highlights Customer Hub for office routes without activating Operations Customers", () => {
    const customers = ACCORDION_SECTIONS[0].items.find((item) => item.label === "Customers")!;
    const hub = PRIMARY_NAV.find((item) => item.label === "Customer Hub")!;
    expect(isNavItemActive("/office/customers/1", hub)).toBe(true);
    expect(isNavItemActive("/office/customers/1", customers)).toBe(false);
    expect(isNavItemActive("/customers", customers)).toBe(true);
  });

  it("marks a parent as containing the active child even when another section is open", () => {
    const operations = ACCORDION_SECTIONS[0];
    expect(sectionContainsPath(operations, "/estimates")).toBe(true);
    expect(sectionContainsPath(operations, "/marketing/reviews")).toBe(false);
  });
});

describe("role-aware navigation", () => {
  it("shows owners every authorized section", () => {
    expect(visiblePrimaryNav("COMPANY_OWNER").map((item) => item.label)).toEqual([
      "Home",
      "Dispatch",
      "Customer Hub",
      "Intelligence",
      "Action Center",
      "Inbox",
    ]);
    expect(visibleAccordionSections("COMPANY_OWNER").map((section) => section.id)).toEqual([
      "operations",
      "marketing",
      "money",
      "team",
    ]);
    expect(visibleAccordionSections("COMPANY_OWNER").find((section) => section.id === "team")?.items.map((item) => item.label)).toEqual([
      "Team",
      "Compensation",
      "Scorecards",
      "My Performance",
    ]);
  });

  it("hides company-wide money and marketing from dispatchers", () => {
    const labels = visibleAccordionSections("DISPATCHER").flatMap((section) =>
      section.items.map((item) => `${section.id}:${item.label}`)
    );
    expect(labels.some((label) => label.startsWith("marketing:"))).toBe(false);
    expect(labels.some((label) => label.startsWith("money:"))).toBe(false);
    expect(labels).not.toContain("team:Compensation");
    expect(labels).toContain("operations:Schedule");
    expect(labels).toContain("operations:Jobs");
    expect(visiblePrimaryNav("DISPATCHER").map((item) => item.label)).toEqual([
      "Home",
      "Dispatch",
      "Customer Hub",
      "Intelligence",
      "Action Center",
    ]);
  });

  it("lets office see CSR-relevant destinations without owner-only compensation", () => {
    const team = visibleAccordionSections("OFFICE").find((section) => section.id === "team");
    expect(team?.items.map((item) => item.label)).toEqual(["Team", "Scorecards", "My Performance"]);
    expect(visibleAccordionSections("OFFICE").some((section) => section.id === "money")).toBe(true);
    expect(filterNavItems(ACCORDION_SECTIONS.find((section) => section.id === "team")!.items, "OFFICE").map((item) => item.label)).not.toContain(
      "Compensation"
    );
  });

  it("does not invent financial pages for technicians in the office shell catalog", () => {
    const money = visibleAccordionSections("TECHNICIAN").find((section) => section.id === "money");
    expect(money?.items.map((item) => item.label)).toEqual(["Payments", "Receipts", "Expenses"]);
    expect(money?.items.some((item) => item.label === "Reports")).toBe(false);
    expect(visibleAccordionSections("TECHNICIAN").some((section) => section.id === "marketing")).toBe(false);
  });
});

describe("sidebar and mobile source", () => {
  it("uses an accessible accordion instead of permanently expanded lists", () => {
    const nav = readFileSync(resolve("src/components/app-nav.tsx"), "utf8");
    expect(nav).toContain("aria-expanded");
    expect(nav).toContain("aria-controls");
    expect(nav).toContain("role=\"region\"");
    expect(nav).toContain("ChevronRight");
    expect(nav).toContain("Command Center");
    expect(nav).toContain("Business");
    expect(nav).toContain("NAV_STORAGE_KEY");
    expect(nav).not.toContain("MARKETING HUB");
    const shell = readFileSync(resolve("src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain("w-[260px]");
    expect(shell).toContain("<AppNav");
    expect(shell.match(/<AppNav/g)?.length).toBe(2);
    expect(shell).toContain("GlobalSearch");
    expect(shell).toContain("WorkspaceSwitcher");
    expect(shell).not.toContain("MobileWorkspaceLinks");
  });
});
