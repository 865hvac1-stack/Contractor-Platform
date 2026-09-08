import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { presentAttentionItem } from "@/lib/attention-present";
import type { RankedAttention } from "@/lib/attention-priority";

function item(partial: Partial<RankedAttention>): RankedAttention {
  return {
    id: "x",
    type: "job_missing_technician",
    title: "Scheduled job has no technician",
    description: "31777570",
    severity: "warning",
    href: "/dispatch",
    entityType: "Job",
    entityId: "job_1",
    createdAt: new Date("2026-09-07T12:00:00.000Z"),
    priority: "HIGH",
    score: 10,
    category: "operations",
    amountCents: null,
    customerName: null,
    recommendedAction: "Assign a technician.",
    ageDays: 0,
    ...partial,
  };
}

describe("home attention presentation", () => {
  it("does not repeat a raw job id as both the person and the explanation", () => {
    const presented = presentAttentionItem(item({}));
    expect(presented.headline.toLowerCase()).toContain("technician");
    expect(presented.who).toBe("Job #31777570");
    expect(presented.why).not.toBe("31777570");
    expect(presented.why).not.toBe(presented.who);
    expect(presented.action).toBe("Assign Technician");
  });

  it("uses verified customer context when it exists", () => {
    const presented = presentAttentionItem(
      item({
        customerName: "Carolyn Everett",
        description: "Tue, Sep 8, 8:00 AM · Maintenance",
      })
    );
    expect(presented.who).toBe("Carolyn Everett");
    expect(presented.why).toContain("Maintenance");
    expect(presented.why).not.toBe("Carolyn Everett");
  });
});

describe("home premium surface", () => {
  it("keeps the four Home areas and does not restore the old warehouse", () => {
    const page = readFileSync(resolve("src/app/(app)/dashboard/page.tsx"), "utf8");
    const hero = readFileSync(resolve("src/components/home/command-hero.tsx"), "utf8");
    const needs = readFileSync(resolve("src/components/home/needs-you.tsx"), "utf8");
    const snapshot = readFileSync(resolve("src/components/home/business-snapshot.tsx"), "utf8");
    expect(page).toContain("CommandHero");
    expect(page).toContain("NeedsYou");
    expect(page).toContain("AskContractorYou");
    expect(page).toContain("BusinessSnapshot");
    expect(page).toContain("max-w-[1480px]");
    expect(page).not.toContain("HealthHero");
    expect(page).not.toContain("MetricRing");
    expect(page).not.toContain("RevenueChart");
    expect(hero).toContain("Here&apos;s your business today");
    expect(hero).toContain("Today&apos;s status");
    expect(hero).toContain("View Dispatch");
    expect(needs).toContain("View all");
    expect(snapshot).toContain("We&apos;re building your business picture.");
    expect(snapshot).toContain("Revenue & collections");
    expect(snapshot).toContain("Revenue mix");
    expect(snapshot).toContain("View →");
    expect(snapshot).not.toContain("vs last month");
  });
});
