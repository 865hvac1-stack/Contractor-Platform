import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  calculateProjectFinancials,
  calculateProjectHealth,
  laborCostCents,
  minutesBetween,
  PROJECT_PHASE_TEMPLATES,
  projectAccessFilter,
} from "@/lib/projects/core";

describe("Projects / Project 360", () => {
  it("calculates defensible profitability from actual and committed sources", () => {
    const result = calculateProjectFinancials({
      originalContractCents: 1_875_000,
      approvedChangeOrderRevenueCents: 125_000,
      actualLaborCents: 300_000,
      actualDirectCostCents: 450_000,
      actualVisitCostCents: 350_000,
      actualInstalledMaterialCents: 0,
      committedDirectCostCents: 200_000,
      committedMaterialCents: 0,
      billedCents: 1_200_000,
      collectedCents: 900_000,
    });
    expect(result.currentValueCents).toBe(2_000_000);
    expect(result.costToDateCents).toBe(1_100_000);
    expect(result.projectedFinalCostCents).toBe(1_300_000);
    expect(result.projectedGrossProfitCents).toBe(700_000);
    expect(result.projectedMarginBps).toBe(3500);
    expect(result.remainingToBillCents).toBe(800_000);
    expect(result.outstandingBalanceCents).toBe(300_000);
  });

  it("uses minute-accurate labor and rate snapshots", () => {
    const start = new Date("2026-09-15T12:00:00.000Z");
    const end = new Date("2026-09-15T20:30:00.000Z");
    const minutes = minutesBetween(start, end, 30);
    expect(minutes).toBe(480);
    expect(laborCostCents(minutes, 4200)).toBe(33_600);
  });

  it("derives project health from deterministic rules", () => {
    const health = calculateProjectHealth({
      status: "IN_PROGRESS",
      targetCompletion: new Date("2026-09-01T00:00:00.000Z"),
      projectedMarginBps: 1500,
      minimumMarginBps: 2000,
      laborBudgetMinutes: 4800,
      actualLaborMinutes: 5000,
      blockedPhases: 1,
      criticalIssues: 0,
      overduePhases: 1,
      unbilledReadyMilestones: 0,
      pastDueInvoices: 0,
      materialBlockers: 1,
    }, new Date("2026-09-15T00:00:00.000Z"));
    expect(health.status).toBe("AT_RISK");
    expect(health.reasons).toContain("Labor is over budget");
    expect(health.reasons).toContain("Projected margin is below target");
  });

  it("supports industry-neutral phase templates", () => {
    expect(PROJECT_PHASE_TEMPLATES.NEW_CONSTRUCTION).toContain("Rough-In");
    expect(PROJECT_PHASE_TEMPLATES.REMODEL).toContain("Site Preparation");
    expect(PROJECT_PHASE_TEMPLATES.CUSTOM_PROJECT).toEqual(["Planning", "Work", "Punch / Final"]);
  });

  it("restricts field project access to assigned existing jobs", () => {
    expect(projectAccessFilter("TECHNICIAN", "tech-1")).toEqual({
      jobs: { some: { assignments: { some: { userId: "tech-1" } } } },
    });
    expect(projectAccessFilter("COMPANY_OWNER", "owner-1")).toEqual({});
  });

  it("enforces one active clock and does not modify QuickBooks", () => {
    const migration = readFileSync(resolve("prisma/migrations/20260915013329_projects_project_360/migration.sql"), "utf8");
    expect(migration).toContain("ProjectLaborEntry_one_active_clock_per_employee");
    expect(migration).toContain('WHERE "endedAt" IS NULL');
    expect(migration).not.toMatch(/QuickBooks|quickbooks|OAuth|reconciliation/);
  });
});
