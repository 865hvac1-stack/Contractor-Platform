import { describe, expect, it } from "vitest";
import { isSchedulingEligibleRole, resolveSchedulingRoster } from "@/lib/scheduling/roster";

describe("scheduling roster", () => {
  const tj = {
    userId: "user-tj",
    role: "COMPANY_OWNER" as const,
    status: "ACTIVE" as const,
    user: { id: "user-tj", firstName: "TJ", lastName: "Hurst" },
  };
  const jr = {
    userId: "user-jr",
    role: "TECHNICIAN" as const,
    status: "ACTIVE" as const,
    user: { id: "user-jr", firstName: "JR", lastName: "Smith" },
  };
  const office = {
    userId: "user-office",
    role: "OFFICE" as const,
    status: "ACTIVE" as const,
    user: { id: "user-office", firstName: "Pat", lastName: "Office" },
  };

  it("keeps field technicians on the roster even before weekly rows exist", () => {
    const roster = resolveSchedulingRoster({ members: [jr, tj, office], configuredUserIds: [] });
    expect(roster.technicians.map((row) => row.userId)).toEqual(["user-jr"]);
    expect(roster.eligibleToAdd.map((row) => row.userId)).toEqual(["user-tj"]);
  });

  it("adds an owner/manager only after they are configured for scheduling", () => {
    const before = resolveSchedulingRoster({ members: [tj, jr], configuredUserIds: [] });
    expect(before.technicians.map((row) => row.userId)).toEqual(["user-jr"]);
    const after = resolveSchedulingRoster({ members: [tj, jr], configuredUserIds: ["user-tj"] });
    expect(after.technicians.map((row) => row.userId).sort()).toEqual(["user-jr", "user-tj"]);
    expect(after.eligibleToAdd).toEqual([]);
  });

  it("does not treat office/sales as addable scheduling technicians", () => {
    expect(isSchedulingEligibleRole("OFFICE")).toBe(false);
    expect(isSchedulingEligibleRole("SALES")).toBe(false);
    expect(isSchedulingEligibleRole("COMPANY_OWNER")).toBe(true);
    expect(isSchedulingEligibleRole("MANAGER")).toBe(true);
  });
});
