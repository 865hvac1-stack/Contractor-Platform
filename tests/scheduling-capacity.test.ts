import { describe, expect, it } from "vitest";
import { evaluateCapacity } from "@/lib/scheduling/capacity-engine";
import { rankEligibleOptions } from "@/lib/scheduling/ranking";
import { DEFAULT_POLICY } from "@/lib/scheduling/types";

const now = new Date("2026-09-08T14:00:00.000Z");

function snapshot(overrides?: Partial<Parameters<typeof evaluateCapacity>[0]>) {
  return {
    timeZone: "America/New_York",
    policy: DEFAULT_POLICY,
    windows: [
      { id: "w1", name: "Morning 1", startMinutes: 9 * 60, endMinutes: 11 * 60, daypart: "MORNING" as const, active: true },
      { id: "w2", name: "Afternoon 1", startMinutes: 13 * 60, endMinutes: 15 * 60, daypart: "AFTERNOON" as const, active: true },
    ],
    technicians: [
      { id: "jr", name: "JR", active: true },
      { id: "travis", name: "Travis", active: true },
    ],
    weekly: [
      { userId: "jr", windowId: "w1", weekday: 3, available: true, capacity: 1 },
      { userId: "jr", windowId: "w2", weekday: 3, available: false, capacity: 1 },
      { userId: "travis", windowId: "w1", weekday: 3, available: true, capacity: 2 },
      { userId: "travis", windowId: "w2", weekday: 3, available: true, capacity: 1 },
    ],
    overrides: [] as Parameters<typeof evaluateCapacity>[0]["overrides"],
    eligibility: [] as Parameters<typeof evaluateCapacity>[0]["eligibility"],
    bookings: [] as Parameters<typeof evaluateCapacity>[0]["bookings"],
    now,
    ...overrides,
  };
}

describe("canonical capacity engine", () => {
  it("reports remaining capacity for multiple technicians", () => {
    const result = evaluateCapacity(snapshot(), {
      companyId: "co1",
      date: "2026-09-09",
      appointmentWindowId: "w1",
    });
    expect(result.options.map((row) => row.technicianId).sort()).toEqual(["jr", "travis"]);
    expect(result.options.find((row) => row.technicianId === "jr")?.remainingCapacity).toBe(1);
    expect(result.options.find((row) => row.technicianId === "travis")?.remainingCapacity).toBe(2);
  });

  it("marks a window fully booked and does not invent capacity", () => {
    const result = evaluateCapacity(
      snapshot({
        bookings: [{ technicianId: "jr", windowId: "w1", date: "2026-09-09", jobId: "j1" }],
      }),
      { companyId: "co1", date: "2026-09-09", appointmentWindowId: "w1", technicianId: "jr" }
    );
    expect(result.options.filter((row) => row.technicianId === "jr")).toHaveLength(0);
    expect(result.rejected.some((row) => row.technicianId === "jr" && row.reasons.includes("no_remaining_capacity"))).toBe(true);
  });

  it("never auto-assigns an ineligible technician", () => {
    const result = evaluateCapacity(
      snapshot({
        eligibility: [{ userId: "travis", serviceTypeId: "install", eligible: false }],
      }),
      { companyId: "co1", date: "2026-09-09", appointmentWindowId: "w1", serviceTypeId: "install" }
    );
    expect(result.options.map((row) => row.technicianId)).toEqual(["jr"]);
    expect(result.rejected.some((row) => row.technicianId === "travis" && row.reasons.includes("ineligible_service_type"))).toBe(true);
  });

  it("honors date overrides over weekly templates", () => {
    const result = evaluateCapacity(
      snapshot({
        overrides: [{ userId: "jr", windowId: "w1", date: "2026-09-09", available: false, capacity: null }],
      }),
      { companyId: "co1", date: "2026-09-09", appointmentWindowId: "w1" }
    );
    expect(result.options.map((row) => row.technicianId)).toEqual(["travis"]);
  });

  it("ranks by lowest used percent, then workload, then a stable tie-break", () => {
    const ranked = rankEligibleOptions([
      { technicianId: "b", windowId: "w1", date: "2026-09-09", configuredCapacity: 2, usedCapacity: 1, remainingCapacity: 1, dayWorkload: 1 },
      { technicianId: "a", windowId: "w1", date: "2026-09-09", configuredCapacity: 2, usedCapacity: 0, remainingCapacity: 2, dayWorkload: 0 },
    ]);
    expect(ranked[0].option.technicianId).toBe("a");
    const tied = rankEligibleOptions([
      { technicianId: "zz", windowId: "w1", date: "2026-09-09", configuredCapacity: 1, usedCapacity: 0, remainingCapacity: 1, dayWorkload: 0 },
      { technicianId: "aa", windowId: "w1", date: "2026-09-09", configuredCapacity: 1, usedCapacity: 0, remainingCapacity: 1, dayWorkload: 0 },
    ]);
    expect(tied[0].option.technicianId).not.toBe(tied[1].option.technicianId);
    expect(tied.map((row) => row.option.technicianId)).toEqual(
      [...tied].sort((a, b) => a.ranking.stableTieBreak - b.ranking.stableTieBreak).map((row) => row.option.technicianId)
    );
  });

  it("requires both technician and company capacity when company limits are set", () => {
    const result = evaluateCapacity(
      snapshot({
        policy: { ...DEFAULT_POLICY, maxJobsPerWindow: 1 },
        bookings: [{ technicianId: "jr", windowId: "w1", date: "2026-09-09", jobId: "j1" }],
      }),
      { companyId: "co1", date: "2026-09-09", appointmentWindowId: "w1" }
    );
    expect(result.options).toHaveLength(0);
    expect(result.rejected.every((row) => row.reasons.includes("company_window_full"))).toBe(true);
  });

  it("keeps one remaining last slot visible and rejects overbook", () => {
    const result = evaluateCapacity(
      snapshot({
        bookings: [{ technicianId: "jr", windowId: "w1", date: "2026-09-09", jobId: "j1" }],
      }),
      { companyId: "co1", date: "2026-09-09", appointmentWindowId: "w1" }
    );
    expect(result.options).toHaveLength(1);
    expect(result.options[0].technicianId).toBe("travis");
    expect(result.options[0].remainingCapacity).toBe(2);
  });
});
