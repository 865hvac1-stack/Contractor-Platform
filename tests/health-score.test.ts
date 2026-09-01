import { describe, expect, it } from "vitest";
import { arAgingBuckets, bucketRevenueSeries, computeHealthScore } from "@/lib/health-score";
import { DASHBOARD_ATTENTION_LIMIT, attentionFilterCounts, filterAttention, prioritizeAttention } from "@/lib/attention-priority";
import { buildCommandObservations } from "@/lib/command-observations";
import type { AttentionItem } from "@/lib/attention";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const empty: Parameters<typeof computeHealthScore>[0] = {
  closeRate: null,
  openEstimateValue: 0,
  estimatesNeedingFollowUp: 0,
  revenueThisMonth: 0,
  outstandingBalance: 0,
  overdueBalance: 0,
  jobsToday: 0,
  runningLate: 0,
  unassignedJobs: 0,
  callbacks: 0,
  completedThisMonth: 0,
  activeMemberships: 0,
  reviewsThisMonth: 0,
  missedCallsOpen: 0,
  averageTicketCents: null,
  teamCallbacks: 0,
  leadsThisMonth: 0,
  bookedLeads: 0,
};

describe("business health scoring", () => {
  it("does not invent a score when every component lacks data", () => {
    const health = computeHealthScore(empty);
    expect(health.score).toBeNull();
    expect(health.label).toBeNull();
    expect(health.components.every((row) => row.score == null)).toBe(true);
  });

  it("averages only supported components", () => {
    const health = computeHealthScore({
      ...empty,
      closeRate: 80,
      openEstimateValue: 120000,
      revenueThisMonth: 400000,
      outstandingBalance: 100000,
      overdueBalance: 0,
      jobsToday: 10,
      runningLate: 0,
      completedThisMonth: 20,
      leadsThisMonth: 10,
      bookedLeads: 6,
    });
    expect(health.score).not.toBeNull();
    expect(health.components.find((row) => row.id === "customers")?.score).toBeNull();
    expect(health.components.find((row) => row.id === "sales")?.score).toBeGreaterThan(70);
    expect(health.components.find((row) => row.id === "cash")?.score).toBeGreaterThan(50);
  });

  it("penalizes overdue A/R and late jobs from recorded inputs", () => {
    const healthy = computeHealthScore({
      ...empty,
      revenueThisMonth: 500000,
      outstandingBalance: 50000,
      overdueBalance: 0,
      jobsToday: 8,
      runningLate: 0,
      completedThisMonth: 8,
    });
    const strained = computeHealthScore({
      ...empty,
      revenueThisMonth: 500000,
      outstandingBalance: 400000,
      overdueBalance: 300000,
      jobsToday: 8,
      runningLate: 4,
      completedThisMonth: 8,
    });
    expect(healthy.components.find((row) => row.id === "cash")!.score!).toBeGreaterThan(
      strained.components.find((row) => row.id === "cash")!.score!
    );
    expect(healthy.components.find((row) => row.id === "operations")!.score!).toBeGreaterThan(
      strained.components.find((row) => row.id === "operations")!.score!
    );
  });
});

describe("A/R aging and revenue series", () => {
  const now = new Date("2026-09-01T12:00:00");

  it("buckets invoice balances from due dates", () => {
    const buckets = arAgingBuckets(
      [
        { balanceCents: 1000, dueDate: new Date("2026-09-10") },
        { balanceCents: 2000, dueDate: new Date("2026-08-20") },
        { balanceCents: 3000, dueDate: new Date("2026-07-01") },
        { balanceCents: 4000, dueDate: new Date("2026-05-01") },
      ],
      now
    );
    expect(buckets.current).toBe(1000);
    expect(buckets.d1to30).toBe(2000);
    expect(buckets.d31to60).toBe(0);
    expect(buckets.d61to90).toBe(3000);
    expect(buckets.d90plus).toBe(4000);
  });

  it("builds a 30-day series from payment timestamps", () => {
    const series = bucketRevenueSeries(
      [
        { at: new Date("2026-09-01T10:00:00"), amountCents: 25000 },
        { at: new Date("2026-08-20T10:00:00"), amountCents: 10000 },
      ],
      "30d",
      now
    );
    expect(series).toHaveLength(30);
    expect(series[series.length - 1]?.revenueCents).toBe(25000);
    expect(series.find((point) => point.key === "2026-08-20")?.revenueCents).toBe(10000);
  });
});

describe("attention completeness", () => {
  it("keeps every item available after filtering", () => {
    const now = new Date("2026-09-01T16:00:00.000Z");
    const items = prioritizeAttention(
      [
        {
          id: "a",
          type: "invoice_overdue",
          title: "Overdue",
          description: "Invoice",
          severity: "critical",
          href: "/invoices/a",
          entityType: "Invoice",
          entityId: "a",
          createdAt: now,
          amountCents: 200000,
        },
        {
          id: "b",
          type: "membership_needs_review",
          title: "Membership",
          description: "Pending",
          severity: "info",
          href: "/memberships",
          entityType: "CustomerMembership",
          entityId: "b",
          createdAt: now,
        },
        {
          id: "c",
          type: "job_running_behind",
          title: "Late",
          description: "Job",
          severity: "warning",
          href: "/jobs/c",
          entityType: "Job",
          entityId: "c",
          createdAt: now,
        },
      ] as AttentionItem[],
      now
    );
    const counts = attentionFilterCounts(items);
    expect(counts.all).toBe(3);
    expect(counts.money).toBe(1);
    expect(counts.memberships).toBe(1);
    expect(counts.dispatch).toBe(1);
    expect(filterAttention(items, "dispatch")).toHaveLength(1);
    expect(filterAttention(items, "all")).toHaveLength(3);
    expect(counts.other).toBeGreaterThanOrEqual(0);
    expect(DASHBOARD_ATTENTION_LIMIT).toBe(3);
  });
});

describe("observations stay grounded", () => {
  it("only describes recorded metrics", () => {
    const rows = buildCommandObservations({
      revenueThisMonth: 110000,
      lastMonthRevenue: 100000,
      overdueBalance: 420000,
      openEstimateValue: 3140000,
      estimatesNeedingFollowUp: 3,
      topTechName: "Jordan Blake",
      topTechRevenueCents: 542000,
      runningLate: 0,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.sources.length > 0)).toBe(true);
    expect(rows.some((row) => row.text.includes("Jordan Blake"))).toBe(true);
  });
});

describe("Command Center source", () => {
  it("does not hard-code demo KPI totals or hide the full attention list", () => {
    const page = readFileSync(resolve("src/app/(app)/dashboard/page.tsx"), "utf8");
    expect(page).not.toMatch(/\$36,924|\$66,801|\$17,480/);
    expect(page).toMatch(/getCommandCenterData/);
    expect(page).toMatch(/DASHBOARD_ATTENTION_LIMIT|AttentionSummary/);
    expect(page).toMatch(/HealthHero/);
    expect(page).toMatch(/variant="bar"/);
    const feed = readFileSync(resolve("src/components/attention-feed.tsx"), "utf8");
    expect(feed).toContain("DASHBOARD_ATTENTION_LIMIT");
    expect(feed).toContain("View all");
    expect(feed).toContain("Action Center");
    expect(feed).not.toContain("Load");
  });
});
