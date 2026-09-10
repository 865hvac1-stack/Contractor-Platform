import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateAppointmentWindow, windowNameFromTimes } from "@/lib/scheduling/windows";
import { parseClockToMinutes } from "@/lib/scheduling/time";
import { parseFormBoolean, parseFormFieldBoolean } from "@/lib/scheduling/persist";

describe("scheduling settings UX v2 wiring", () => {
  const page = readFileSync(resolve("src/app/(app)/settings/scheduling/page.tsx"), "utf8");
  const view = readFileSync(resolve("src/components/scheduling/scheduling-settings-view.tsx"), "utf8");
  const actions = readFileSync(resolve("src/server/actions/scheduling.ts"), "utf8");
  const loader = readFileSync(resolve("src/lib/scheduling/settings-data.ts"), "utf8");
  const capacity = readFileSync(resolve("src/lib/scheduling/capacity.ts"), "utf8");

  it("loads real settings data and does not render the old giant matrix page", () => {
    expect(page).toMatch(/loadSchedulingSettings/);
    expect(page).toMatch(/SchedulingSettingsView/);
    expect(page).toMatch(/requireAnyPermission/);
    expect(page).not.toMatch(/saveTechnicianAvailabilityAction/);
  });

  it("uses one weekly technician save instead of per-cell Save buttons", () => {
    expect(view).toMatch(/saveTechnicianWeekAction/);
    expect(view).not.toMatch(/saveTechnicianAvailabilityAction/);
    expect(view).toMatch(/Copy Monday to weekdays/);
    expect(view).toMatch(/Apply to Mon–Fri/);
    expect(view).toMatch(/Can perform/);
    expect(actions).toMatch(/parseTechnicianWeekSlots/);
    expect(actions).toMatch(/companyId_userId_windowId_weekday/);
    expect(actions).toMatch(/eligibleServiceTypeId/);
    expect(actions).toMatch(/addSchedulingTechnicianAction/);
  });

  it("keeps compact cards for windows, auto-book, exceptions, and today", () => {
    expect(view).toMatch(/Appointment windows/);
    expect(view).toMatch(/Edit windows/);
    expect(view).toMatch(/Today’s Capacity/);
    expect(view).toMatch(/No availability/);
    expect(view).not.toMatch(/slots === 0 \? "Full"/);
    expect(view).toMatch(/Schedule exceptions/);
    expect(view).toMatch(/Auto-booking/);
    expect(view).toMatch(/Advanced scheduling settings/);
    expect(view).toMatch(/saveAutoBookingEnabledAction/);
    expect(view).toMatch(/saveServiceTypeRulesBatchAction/);
    expect(view).toMatch(/name="allowTechnicianPreference"/);
    expect(view).toMatch(/!showAdvanced/);
    expect(view).toMatch(/\+ Add Technician/);
    expect(view).toMatch(/\+ Add Exception/);
    expect(loader).toMatch(/evaluateCapacity/);
    expect(loader).toMatch(/summarizeDayWindows/);
    expect(loader).toMatch(/loadSchedulingRoster/);
    expect(capacity).toMatch(/loadSchedulingRoster/);
  });

  it("persists appointment window clocks through the existing validator", () => {
    const start = parseClockToMinutes("9:00 AM");
    const end = parseClockToMinutes("11:00 AM");
    expect(start).toBe(9 * 60);
    expect(end).toBe(11 * 60);
    expect(validateAppointmentWindow({ name: "Morning 1", startMinutes: start!, endMinutes: end! })).toBeNull();
    expect(windowNameFromTimes(start!, end!)).toMatch(/9.*11/);
  });

  it("persists auto-book policy and exception flags with explicit booleans", () => {
    const policy = new FormData();
    policy.set("autoBookingEnabled", "yes");
    policy.set("allowSameDay", "no");
    expect(parseFormBoolean(policy.get("autoBookingEnabled"))).toBe(true);
    expect(parseFormBoolean(policy.get("allowSameDay"))).toBe(false);

    const exception = new FormData();
    exception.set("available", "no");
    expect(parseFormBoolean(exception.get("available"))).toBe(false);
    exception.set("available", "yes");
    expect(parseFormFieldBoolean(exception, "available")).toBe(true);
  });
});
