import { describe, expect, it } from "vitest";
import {
  formatCompactDateTime,
  formatDate,
  formatDateTime,
  formatDurationSeconds,
  formatTime,
} from "@/lib/datetime";

const zone = "UTC";

describe("12-hour ContractorYou date/time display", () => {
  it("formats the required clock examples without seconds", () => {
    expect(formatTime("2026-09-08T00:05:00.000Z", zone)).toBe("12:05 AM");
    expect(formatTime("2026-09-08T08:30:00.000Z", zone)).toBe("8:30 AM");
    expect(formatTime("2026-09-08T12:00:00.000Z", zone)).toBe("12:00 PM");
    expect(formatTime("2026-09-08T13:05:00.000Z", zone)).toBe("1:05 PM");
    expect(formatTime("2026-09-08T20:20:00.000Z", zone)).toBe("8:20 PM");
  });

  it("keeps the calendar date correct", () => {
    expect(formatDate("2026-09-08T20:20:22.000Z", zone)).toBe("Sep 8, 2026");
    expect(formatDateTime("2026-09-08T12:32:15.000Z", zone)).toBe("Sep 8, 2026 · 12:32 PM");
    expect(formatCompactDateTime("2026-09-08T12:32:15.000Z", zone)).toBe("9/8/2026 · 12:32 PM");
    expect(formatDateTime("2026-09-08T20:20:22.000Z", zone)).toBe("Sep 8, 2026 · 8:20 PM");
    expect(formatDateTime("2026-09-08T20:20:22.000Z", zone)).not.toContain("20:20");
    expect(formatDateTime("2026-09-08T20:20:22.000Z", zone)).not.toContain(":22");
  });

  it("formats call duration compactly", () => {
    expect(formatDurationSeconds(272)).toBe("4m 32s");
    expect(formatDurationSeconds(0)).toBe("0m 00s");
  });
});
