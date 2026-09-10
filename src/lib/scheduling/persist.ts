export const FORM_TRUE = new Set(["true", "yes", "on", "1"]);
export const FORM_FALSE = new Set(["false", "no", "off", "0", ""]);

export function parseFormBoolean(value: FormDataEntryValue | null | undefined): boolean {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (FORM_TRUE.has(normalized)) return true;
  if (FORM_FALSE.has(normalized)) return false;
  return false;
}

/** Last submitted value wins so hidden "no" + checked "yes" checkboxes persist On. */
export function parseFormFieldBoolean(formData: FormData, name: string): boolean {
  const values = formData.getAll(name);
  if (values.length === 0) return false;
  return parseFormBoolean(values[values.length - 1]);
}

export function serviceRuleStatus(rule?: { autoBookAllowed: boolean; requiresOfficeApproval: boolean } | null) {
  if (!rule) return "AUTO_BOOK" as const;
  if (rule.requiresOfficeApproval) return "OFFICE_APPROVAL" as const;
  if (rule.autoBookAllowed) return "AUTO_BOOK" as const;
  return "MANUAL" as const;
}

export function parseFormCapacity(value: FormDataEntryValue | null | undefined, fallback = 1): number {
  if (value == null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function parseFormWeekday(value: FormDataEntryValue | null | undefined): number | null {
  if (value == null || String(value).trim() === "") return null;
  const weekday = Number(value);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  return weekday;
}

export type TechnicianWeekSlot = {
  windowId: string;
  weekday: number;
  available: boolean;
  capacity: number;
};

export function parseTechnicianWeekSlots(formData: FormData, windowIds: string[]): TechnicianWeekSlot[] {
  const slots: TechnicianWeekSlot[] = [];
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    for (const windowId of windowIds) {
      const key = `${weekday}:${windowId}`;
      slots.push({
        windowId,
        weekday,
        available: parseFormBoolean(formData.get(`available:${key}`)),
        capacity: parseFormCapacity(formData.get(`capacity:${key}`), 1),
      });
    }
  }
  return slots;
}

export function technicianWeekIdentity(input: {
  companyId: string;
  userId: string;
  windowId: string;
  weekday: number;
}) {
  return {
    companyId: input.companyId,
    userId: input.userId,
    windowId: input.windowId,
    weekday: input.weekday,
  };
}

export function upsertAvailabilityInMemory(
  rows: Array<{ companyId: string; userId: string; windowId: string; weekday: number; available: boolean; capacity: number }>,
  next: { companyId: string; userId: string; windowId: string; weekday: number; available: boolean; capacity: number }
) {
  const identity = technicianWeekIdentity(next);
  const index = rows.findIndex(
    (row) =>
      row.companyId === identity.companyId &&
      row.userId === identity.userId &&
      row.windowId === identity.windowId &&
      row.weekday === identity.weekday
  );
  if (index === -1) return [...rows, next];
  return rows.map((row, i) => (i === index ? next : row));
}

export function dayCapacitySummary(
  slots: Array<{ userId: string; weekday: number; available: boolean; capacity: number }>,
  userId: string,
  weekday: number
) {
  const open = slots.filter((slot) => slot.userId === userId && slot.weekday === weekday && slot.available === true);
  if (open.length === 0) return { available: false as const, capacity: 0 };
  return { available: true as const, capacity: open.reduce((sum, slot) => sum + slot.capacity, 0) };
}

export function technicianIsScheduled(
  slots: Array<{ userId: string; available: boolean }>,
  userId: string
) {
  return slots.some((slot) => slot.userId === userId && slot.available === true);
}

export function applyWorkingHoursToWindows<T extends { id: string; startMinutes: number; endMinutes: number }>(
  windows: T[],
  input: { working: boolean; startMinutes: number; endMinutes: number; capacity?: number }
) {
  return windows.map((window) => ({
    windowId: window.id,
    available:
      input.working &&
      window.startMinutes < input.endMinutes &&
      input.startMinutes < window.endMinutes,
    capacity: input.capacity ?? 1,
  }));
}

export function summarizeWindowCapacity(
  rows: Array<{
    windowId: string;
    remainingCapacity: number;
    configuredCapacity: number;
    usedCapacity: number;
    technicianId: string;
  }>,
  windowId: string
) {
  const matched = rows.filter((row) => row.windowId === windowId);
  return {
    remaining: matched.reduce((sum, row) => sum + row.remainingCapacity, 0),
    configured: matched.reduce((sum, row) => sum + row.configuredCapacity, 0),
    used: matched.reduce((sum, row) => sum + row.usedCapacity, 0),
    technicians: new Set(matched.map((row) => row.technicianId)).size,
  };
}
