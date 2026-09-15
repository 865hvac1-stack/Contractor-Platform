import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  confidenceForSampleSize,
  evaluateJobFit,
  normalizeJobLabel,
  qualificationState,
  readiness,
  safeRate,
} from "@/lib/technician-intelligence/core";
import { PERFORMANCE_DEFINITIONS } from "@/lib/technician-intelligence/performance";
import { can } from "@/lib/permissions";

const baseFit = {
  technicianActive: true,
  smartDispatchEligible: true,
  requiredQualifications: [] as Array<{ id: string; name: string; state: string }>,
  ownerSkillRating: 4,
  preference: null,
  completedJobs: 0,
  confidence: "INSUFFICIENT" as const,
  firstTimeCompletionRate: null,
  callbackRate: null,
  customerVisits: 0,
  propertyVisits: 0,
  equipmentVisits: 0,
  doNotRecommend: false,
};

describe("Technician Intelligence core", () => {
  it("normalizes inconsistent historical call labels without rewriting jobs", () => {
    expect(normalizeJobLabel(" AC  not-cooling ")).toBe("AC NOT COOLING");
    expect(normalizeJobLabel("No_Cool")).toBe("NO COOL");
  });

  it("uses centralized sample-size confidence thresholds", () => {
    expect(confidenceForSampleSize(0)).toBe("INSUFFICIENT");
    expect(confidenceForSampleSize(4)).toBe("INSUFFICIENT");
    expect(confidenceForSampleSize(5)).toBe("LOW");
    expect(confidenceForSampleSize(20)).toBe("MEDIUM");
    expect(confidenceForSampleSize(50)).toBe("HIGH");
  });

  it("does not display fake percentages for empty samples", () => {
    expect(safeRate(0, 0)).toBeNull();
  });

  it("recognizes expiration independently from stored ACTIVE status", () => {
    expect(
      qualificationState(
        { status: "ACTIVE", expirationDate: new Date("2026-01-01T00:00:00Z") },
        new Date("2026-09-15T00:00:00Z")
      )
    ).toBe("EXPIRED");
  });

  it("makes a missing required qualification ineligible", () => {
    const fit = evaluateJobFit({
      ...baseFit,
      requiredQualifications: [{ id: "epa", name: "EPA Universal", state: "MISSING" }],
    });
    expect(fit.eligible).toBe(false);
    expect(fit.reasons).toContainEqual(
      expect.objectContaining({ code: "MISSING_REQUIRED_QUALIFICATION", kind: "BLOCKER" })
    );
  });

  it("historical performance never overrides a missing hard qualification", () => {
    const fit = evaluateJobFit({
      ...baseFit,
      requiredQualifications: [{ id: "commercial", name: "Commercial", state: "MISSING" }],
      completedJobs: 192,
      confidence: "HIGH",
      firstTimeCompletionRate: 97,
      callbackRate: 1,
    });
    expect(fit.eligible).toBe(false);
    expect(fit.hardConstraints.qualified).toBe(false);
  });

  it("recognizes an expired required certification as a blocker", () => {
    const fit = evaluateJobFit({
      ...baseFit,
      requiredQualifications: [{ id: "epa", name: "EPA Universal", state: "EXPIRED" }],
    });
    expect(fit.eligible).toBe(false);
    expect(fit.reasons.some((reason) => reason.code === "EXPIRED_REQUIRED_CERTIFICATION")).toBe(true);
  });

  it("uses preferred calls as a positive soft signal", () => {
    const fit = evaluateJobFit({ ...baseFit, preference: "PREFERRED" });
    expect(fit.eligible).toBe(true);
    expect(fit.reasons.some((reason) => reason.code === "PREFERRED_CALL_TYPE")).toBe(true);
  });

  it("does not disqualify development calls", () => {
    const fit = evaluateJobFit({ ...baseFit, preference: "DEVELOPMENT" });
    expect(fit.eligible).toBe(true);
    expect(fit.reasons).toContainEqual(
      expect.objectContaining({ code: "DEVELOPMENT_CALL_TYPE", kind: "WARNING" })
    );
  });

  it("supports new-technician readiness without historical jobs", () => {
    expect(
      readiness({
        ratingCount: 4,
        qualificationCount: 1,
        preferenceCount: 1,
        smartDispatchEligible: true,
      })
    ).toEqual({ ready: true, missing: [] });
  });

  it("reports useful cold-start setup gaps", () => {
    expect(
      readiness({
        ratingCount: 0,
        qualificationCount: 0,
        preferenceCount: 0,
        smartDispatchEligible: true,
      }).missing
    ).toEqual(["skills evaluation", "qualifications", "preferred or development calls"]);
  });

  it("returns deterministic familiarity reason codes", () => {
    const fit = evaluateJobFit({ ...baseFit, customerVisits: 2, propertyVisits: 1, equipmentVisits: 3 });
    expect(fit.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "PREVIOUS_CUSTOMER_EXPERIENCE",
        "PREVIOUS_PROPERTY_EXPERIENCE",
        "PREVIOUS_EQUIPMENT_EXPERIENCE",
      ])
    );
  });

  it("keeps manager editing and dispatcher viewing separate", () => {
    expect(can("COMPANY_OWNER", "technician_intelligence:manage")).toBe(true);
    expect(can("MANAGER", "technician_intelligence:manage")).toBe(true);
    expect(can("DISPATCHER", "technician_intelligence:view")).toBe(true);
    expect(can("DISPATCHER", "technician_intelligence:manage")).toBe(false);
    expect(can("TECHNICIAN", "technician_intelligence:confidential")).toBe(false);
  });

  it("documents explicit callback and duration definitions", () => {
    expect(PERFORMANCE_DEFINITIONS.callbackRate.toLowerCase()).toContain("explicit callback");
    expect(PERFORMANCE_DEFINITIONS.averageDuration).toContain("checked-in to checked-out");
  });

  it("migration is additive, seeded with configuration only, and does not touch QuickBooks", () => {
    const migration = readFileSync(
      resolve("prisma/migrations/20260915173503_technician_intelligence/migration.sql"),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "TechnicianIntelligenceProfile"');
    expect(migration).toContain("No ratings, qualifications, preferences, or performance data are fabricated");
    expect(migration).not.toMatch(/QuickBooks|quickbooks|OAuth|write.?back/i);
    expect(migration).not.toMatch(/INSERT INTO "TechnicianSkillRating"/);
    expect(migration).not.toMatch(/INSERT INTO "TechnicianPerformanceAggregate"/);
  });
});
