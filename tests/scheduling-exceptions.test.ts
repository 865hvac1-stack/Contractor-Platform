import { describe, expect, it } from "vitest";
import {
  dateKeysInclusive,
  expandExceptionToOverrides,
  parseExceptionKind,
} from "@/lib/scheduling/exceptions";

const windows = [
  { id: "w9", startMinutes: 9 * 60, endMinutes: 11 * 60 },
  { id: "w11", startMinutes: 11 * 60, endMinutes: 13 * 60 },
  { id: "w13", startMinutes: 13 * 60, endMinutes: 15 * 60 },
  { id: "w15", startMinutes: 15 * 60, endMinutes: 17 * 60 },
];

describe("schedule exceptions", () => {
  it("blocks every window for PTO", () => {
    const slots = expandExceptionToOverrides({ kind: "PTO", windows });
    expect(slots.every((slot) => slot.available === false)).toBe(true);
    expect(slots).toHaveLength(4);
  });

  it("keeps only windows at or after a late start", () => {
    const slots = expandExceptionToOverrides({ kind: "LATE_START", windows, startMinutes: 11 * 60 });
    expect(slots.find((slot) => slot.windowId === "w9")?.available).toBe(false);
    expect(slots.find((slot) => slot.windowId === "w11")?.available).toBe(true);
  });

  it("enables overlapping windows for extra hours", () => {
    const slots = expandExceptionToOverrides({
      kind: "EXTRA_HOURS",
      windows,
      startMinutes: 8 * 60,
      endMinutes: 13 * 60,
      capacity: 1,
    });
    expect(slots.filter((slot) => slot.available).map((slot) => slot.windowId)).toEqual(["w9", "w11"]);
  });

  it("expands a date range without inventing extra days", () => {
    expect(dateKeysInclusive("2026-09-18", "2026-09-19")).toEqual(["2026-09-18", "2026-09-19"]);
    expect(parseExceptionKind("PTO / Day Off")).toBe("PTO");
  });
});
