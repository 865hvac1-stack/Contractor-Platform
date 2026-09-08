import { describe, expect, it } from "vitest";
import {
  dayCapacitySummary,
  parseFormBoolean,
  parseFormCapacity,
  parseFormFieldBoolean,
  parseFormWeekday,
  parseTechnicianWeekSlots,
  serviceRuleStatus,
  technicianWeekIdentity,
  upsertAvailabilityInMemory,
} from "@/lib/scheduling/persist";
import { conversationCanAutoBook } from "@/lib/scheduling/auto-book";

describe("technician availability persistence", () => {
  it("parses On/Off without string truthiness", () => {
    expect(parseFormBoolean("yes")).toBe(true);
    expect(parseFormBoolean("true")).toBe(true);
    expect(parseFormBoolean("on")).toBe(true);
    expect(parseFormBoolean("1")).toBe(true);
    expect(parseFormBoolean("no")).toBe(false);
    expect(parseFormBoolean("off")).toBe(false);
    expect(parseFormBoolean("false")).toBe(false);
    expect(parseFormBoolean("0")).toBe(false);
    expect(parseFormBoolean("")).toBe(false);
    expect(parseFormBoolean(null)).toBe(false);
    expect(parseFormBoolean("available")).toBe(false);
  });

  it("uses the last checkbox value so hidden no + checked yes persists On", () => {
    const on = new FormData();
    on.append("available", "no");
    on.append("available", "yes");
    expect(parseFormFieldBoolean(on, "available")).toBe(true);

    const off = new FormData();
    off.append("available", "no");
    expect(parseFormFieldBoolean(off, "available")).toBe(false);
  });

  it("persists Off → On with capacity 1 on the same logical row", () => {
    const identity = technicianWeekIdentity({
      companyId: "865",
      userId: "user-tj-hurst",
      windowId: "window-9-11",
      weekday: 3,
    });
    const off = {
      ...identity,
      available: false,
      capacity: 1,
    };
    const on = {
      ...identity,
      available: true,
      capacity: 1,
    };
    const afterOn = upsertAvailabilityInMemory([off], on);
    expect(afterOn).toHaveLength(1);
    expect(afterOn[0]).toEqual(on);

    const afterReload = upsertAvailabilityInMemory(afterOn, on);
    expect(afterReload).toHaveLength(1);
    expect(afterReload[0].available).toBe(true);
    expect(afterReload[0].capacity).toBe(1);

    const afterOff = upsertAvailabilityInMemory(afterReload, { ...on, available: false });
    expect(afterOff).toHaveLength(1);
    expect(afterOff[0].available).toBe(false);
    expect(afterOff[0].capacity).toBe(1);
  });

  it("does not treat a different company, technician, weekday, or window as the same row", () => {
    const row = {
      companyId: "865",
      userId: "user-tj-hurst",
      windowId: "window-9-11",
      weekday: 3,
      available: true,
      capacity: 1,
    };
    expect(
      upsertAvailabilityInMemory([row], { ...row, companyId: "other" })
    ).toHaveLength(2);
    expect(upsertAvailabilityInMemory([row], { ...row, userId: "jr" })).toHaveLength(2);
    expect(upsertAvailabilityInMemory([row], { ...row, weekday: 2 })).toHaveLength(2);
    expect(upsertAvailabilityInMemory([row], { ...row, windowId: "window-11-1" })).toHaveLength(2);
  });

  it("parses a weekly editor with multiple windows atomically", () => {
    const form = new FormData();
    form.set("available:3:w9", "true");
    form.set("capacity:3:w9", "1");
    form.set("available:3:w11", "true");
    form.set("capacity:3:w11", "2");
    form.set("available:2:w9", "false");
    form.set("capacity:2:w9", "1");
    const slots = parseTechnicianWeekSlots(form, ["w9", "w11"]);
    const wednesday = slots.filter((slot) => slot.weekday === 3);
    expect(wednesday).toEqual([
      { windowId: "w9", weekday: 3, available: true, capacity: 1 },
      { windowId: "w11", weekday: 3, available: true, capacity: 2 },
    ]);
    expect(slots.find((slot) => slot.weekday === 2 && slot.windowId === "w9")?.available).toBe(false);
    expect(slots.filter((slot) => slot.available)).toHaveLength(2);
  });

  it("parses weekday and capacity safely", () => {
    expect(parseFormWeekday("3")).toBe(3);
    expect(parseFormWeekday("Wednesday")).toBeNull();
    expect(parseFormWeekday("7")).toBeNull();
    expect(parseFormCapacity("1", 0)).toBe(1);
    expect(parseFormCapacity("", 1)).toBe(1);
    expect(parseFormCapacity("-2", 1)).toBe(1);
  });

  it("summarizes weekly capacity only from available=true slots", () => {
    const slots = [
      { userId: "tj", weekday: 3, available: true, capacity: 1 },
      { userId: "tj", weekday: 3, available: true, capacity: 1 },
      { userId: "tj", weekday: 3, available: false, capacity: 4 },
      { userId: "jr", weekday: 3, available: true, capacity: 2 },
    ];
    expect(dayCapacitySummary(slots, "tj", 3)).toEqual({ available: true, capacity: 2 });
    expect(dayCapacitySummary(slots, "tj", 4)).toEqual({ available: false, capacity: 0 });
  });
});

describe("settings UX persist parsers", () => {
  it("persists service-type checkbox rules with hidden fallbacks", () => {
    const form = new FormData();
    form.append("autoBookAllowed", "no");
    form.append("autoBookAllowed", "yes");
    form.append("requiresOfficeApproval", "no");
    form.append("isMaintenance", "no");
    form.append("isMaintenance", "yes");
    expect(parseFormFieldBoolean(form, "autoBookAllowed")).toBe(true);
    expect(parseFormFieldBoolean(form, "requiresOfficeApproval")).toBe(false);
    expect(parseFormFieldBoolean(form, "isMaintenance")).toBe(true);
  });

  it("maps real service rules to compact statuses without inventing examples", () => {
    expect(serviceRuleStatus(null)).toBe("AUTO_BOOK");
    expect(serviceRuleStatus({ autoBookAllowed: true, requiresOfficeApproval: false })).toBe("AUTO_BOOK");
    expect(serviceRuleStatus({ autoBookAllowed: true, requiresOfficeApproval: true })).toBe("OFFICE_APPROVAL");
    expect(serviceRuleStatus({ autoBookAllowed: false, requiresOfficeApproval: false })).toBe("MANUAL");
  });

  it("keeps auto-book gated by policy and saved technician rules", () => {
    expect(conversationCanAutoBook({ autoBookingEnabled: false }, null)).toBe(false);
    expect(conversationCanAutoBook({ autoBookingEnabled: true }, null)).toBe(true);
    expect(
      conversationCanAutoBook({ autoBookingEnabled: true }, { autoBookAllowed: true, requiresOfficeApproval: false })
    ).toBe(true);
    expect(
      conversationCanAutoBook({ autoBookingEnabled: true }, { autoBookAllowed: false, requiresOfficeApproval: false })
    ).toBe(false);
    expect(
      conversationCanAutoBook({ autoBookingEnabled: true }, { autoBookAllowed: true, requiresOfficeApproval: true })
    ).toBe(false);
  });
});
