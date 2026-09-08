import { describe, expect, it } from "vitest";
import {
  canDeleteWindow,
  findActiveWindowOverlaps,
  inferDaypart,
  validateAppointmentWindow,
} from "@/lib/scheduling/windows";
import { formatClockMinutes, parseClockToMinutes } from "@/lib/scheduling/time";

describe("appointment windows", () => {
  it("creates valid company windows and rejects malformed ones", () => {
    expect(validateAppointmentWindow({ name: "Morning 1", startMinutes: 9 * 60, endMinutes: 11 * 60 })).toBeNull();
    expect(validateAppointmentWindow({ name: "", startMinutes: 9 * 60, endMinutes: 11 * 60 })).toMatch(/name/i);
    expect(validateAppointmentWindow({ name: "Bad", startMinutes: 11 * 60, endMinutes: 9 * 60 })).toMatch(/after/i);
    expect(validateAppointmentWindow({ name: "Short", startMinutes: 9 * 60, endMinutes: 9 * 60 + 15 })).toMatch(/30/);
  });

  it("rejects overlapping active windows and allows disabled overlap", () => {
    const issues = findActiveWindowOverlaps([
      { name: "A", startMinutes: 9 * 60, endMinutes: 11 * 60, active: true },
      { name: "B", startMinutes: 10 * 60, endMinutes: 12 * 60, active: true },
    ]);
    expect(issues[0]?.message).toMatch(/overlaps/);
    expect(
      findActiveWindowOverlaps([
        { name: "A", startMinutes: 9 * 60, endMinutes: 11 * 60, active: true },
        { name: "B", startMinutes: 10 * 60, endMinutes: 12 * 60, active: false },
      ])
    ).toHaveLength(0);
  });

  it("does not delete windows that still have bookings", () => {
    expect(canDeleteWindow({ bookingCount: 1, jobCount: 0 }).ok).toBe(false);
    expect(canDeleteWindow({ bookingCount: 0, jobCount: 0 }).ok).toBe(true);
  });

  it("infers dayparts and formats 12-hour clocks", () => {
    expect(inferDaypart(9 * 60)).toBe("MORNING");
    expect(inferDaypart(13 * 60)).toBe("AFTERNOON");
    expect(formatClockMinutes(9 * 60)).toBe("9:00 AM");
    expect(formatClockMinutes(13 * 60)).toBe("1:00 PM");
    expect(parseClockToMinutes("11:00 AM")).toBe(11 * 60);
    expect(parseClockToMinutes("1:00 PM")).toBe(13 * 60);
  });
});
