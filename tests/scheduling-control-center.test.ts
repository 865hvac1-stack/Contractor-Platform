import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateCapacity, summarizeDayWindows } from "@/lib/scheduling/capacity-engine";
import { conversationCanAutoBook } from "@/lib/scheduling/auto-book";
import { DEFAULT_POLICY } from "@/lib/scheduling/types";
import { uniqueWindowOffers } from "@/lib/scheduling/conversation-turn";

const windows = [
  { id: "w9", name: "9-11", startMinutes: 9 * 60, endMinutes: 11 * 60, daypart: "MORNING" as const, active: true },
  { id: "w11", name: "11-1", startMinutes: 11 * 60, endMinutes: 13 * 60, daypart: "MORNING" as const, active: true },
  { id: "w13", name: "1-3", startMinutes: 13 * 60, endMinutes: 15 * 60, daypart: "AFTERNOON" as const, active: true },
  { id: "w15", name: "3-5", startMinutes: 15 * 60, endMinutes: 17 * 60, daypart: "AFTERNOON" as const, active: true },
];

function tjWeek(available = true) {
  return [1, 2].flatMap((weekday) =>
    windows.map((window) => ({
      userId: "tj",
      windowId: window.id,
      weekday,
      available,
      capacity: 1,
    }))
  );
}

function snapshot(overrides?: Partial<Parameters<typeof evaluateCapacity>[0]>) {
  return {
    timeZone: "America/New_York",
    policy: { ...DEFAULT_POLICY, autoBookingEnabled: true, allowSameDay: true, minNoticeMinutes: 0 },
    windows,
    technicians: [{ id: "tj", name: "TJ Hurst", active: true }],
    weekly: tjWeek(),
    overrides: [] as Parameters<typeof evaluateCapacity>[0]["overrides"],
    eligibility: [] as Parameters<typeof evaluateCapacity>[0]["eligibility"],
    bookings: [] as Parameters<typeof evaluateCapacity>[0]["bookings"],
    now: new Date("2026-09-14T12:00:00.000Z"),
    ...overrides,
  };
}

describe("scheduling control center engine contract", () => {
  it("returns multiple valid windows when TJ has 1 slot in each", () => {
    const monday = evaluateCapacity(snapshot(), { companyId: "865", date: "2026-09-14" });
    const offers = uniqueWindowOffers(monday.options, 4);
    expect(offers.map((row) => row.windowId)).toEqual(["w9", "w11", "w13", "w15"]);
    expect(monday.options.every((row) => row.remainingCapacity === 1)).toBe(true);
  });

  it("reduces remaining capacity after one booking", () => {
    const after = evaluateCapacity(
      snapshot({
        bookings: [{ technicianId: "tj", windowId: "w9", date: "2026-09-14", jobId: "job-1" }],
      }),
      { companyId: "865", date: "2026-09-14" }
    );
    expect(after.options.some((row) => row.windowId === "w9")).toBe(false);
    expect(after.options.map((row) => row.windowId)).toEqual(["w11", "w13", "w15"]);
    const today = summarizeDayWindows(
      snapshot({
        bookings: [{ technicianId: "tj", windowId: "w9", date: "2026-09-14", jobId: "job-1" }],
      }),
      { companyId: "865", date: "2026-09-14" }
    );
    expect(today.find((row) => row.windowId === "w9")).toMatchObject({
      configuredCapacity: 1,
      usedCapacity: 1,
      remainingCapacity: 0,
    });
    expect(today.find((row) => row.windowId === "w11")?.remainingCapacity).toBe(1);
  });

  it("removes windows covered by a PTO exception", () => {
    const result = evaluateCapacity(
      snapshot({
        overrides: windows.map((window) => ({
          userId: "tj",
          windowId: window.id,
          date: "2026-09-14",
          available: false,
          capacity: null,
        })),
      }),
      { companyId: "865", date: "2026-09-14" }
    );
    expect(result.options).toHaveLength(0);
    expect(result.rejected.every((row) => row.reasons.includes("window_unavailable"))).toBe(true);
  });

  it("stops offering a disabled appointment window", () => {
    const result = evaluateCapacity(
      snapshot({
        windows: windows.map((window) => (window.id === "w13" ? { ...window, active: false } : window)),
      }),
      { companyId: "865", date: "2026-09-14" }
    );
    expect(result.options.map((row) => row.windowId)).toEqual(["w9", "w11", "w15"]);
  });

  it("blocks autonomous booking when auto-book is off for a service type", () => {
    expect(
      conversationCanAutoBook(
        { autoBookingEnabled: true },
        { autoBookAllowed: false, requiresOfficeApproval: false }
      )
    ).toBe(false);
    expect(
      conversationCanAutoBook(
        { autoBookingEnabled: true },
        { autoBookAllowed: true, requiresOfficeApproval: false }
      )
    ).toBe(true);
  });
});

describe("AI receptionist booking gate", () => {
  it("uses persisted auto-book rules inside bookAppointmentTool", () => {
    const book = readFileSync(resolve("src/lib/agent-tools/book-appointment.ts"), "utf8");
    expect(book).toMatch(/conversationCanAutoBook/);
    expect(book).toMatch(/AUTO_BOOK_DISABLED/);
    expect(book).toMatch(/serviceTypeSchedulingRule/);
  });
});

