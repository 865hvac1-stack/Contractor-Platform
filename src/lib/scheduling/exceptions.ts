import { addLocalDays, compareDateKeys } from "@/lib/scheduling/time";

export const EXCEPTION_KINDS = [
  "PTO",
  "TRAINING",
  "HOLIDAY",
  "LATE_START",
  "EARLY_FINISH",
  "EXTRA_HOURS",
  "CUSTOM",
  "CAPACITY_OVERRIDE",
] as const;

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_KIND_LABELS: Record<ExceptionKind, string> = {
  PTO: "PTO / Day Off",
  TRAINING: "Training",
  HOLIDAY: "Holiday",
  LATE_START: "Late Start",
  EARLY_FINISH: "Early Finish",
  EXTRA_HOURS: "Extra Hours",
  CUSTOM: "Custom Availability",
  CAPACITY_OVERRIDE: "Capacity Override",
};

export function isExceptionKind(value: string): value is ExceptionKind {
  return (EXCEPTION_KINDS as readonly string[]).includes(value);
}

export function parseExceptionKind(value: string | null | undefined): ExceptionKind | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (normalized === "DAY_OFF" || normalized === "PTO_DAY_OFF" || normalized.startsWith("PTO")) return "PTO";
  if (normalized === "CUSTOM_AVAILABILITY") return "CUSTOM";
  return isExceptionKind(normalized) ? normalized : null;
}

type WindowHours = { id: string; startMinutes: number; endMinutes: number };

function overlaps(window: WindowHours, startMinutes: number, endMinutes: number) {
  return window.startMinutes < endMinutes && startMinutes < window.endMinutes;
}

export function dateKeysInclusive(startDate: string, endDate?: string | null, maxDays = 62) {
  const end = endDate && endDate >= startDate ? endDate : startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const keys: string[] = [];
  let cursor = startDate;
  while (compareDateKeys(cursor, end) <= 0 && keys.length < maxDays) {
    keys.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return keys;
}

export function expandExceptionToOverrides(input: {
  kind: ExceptionKind;
  windows: WindowHours[];
  startMinutes?: number | null;
  endMinutes?: number | null;
  capacity?: number | null;
  available?: boolean;
}) {
  const start = input.startMinutes ?? null;
  const end = input.endMinutes ?? null;
  const capacity = input.capacity ?? null;

  return input.windows.map((window) => {
    switch (input.kind) {
      case "PTO":
      case "TRAINING":
      case "HOLIDAY":
        return { windowId: window.id, available: false, capacity: null as number | null };
      case "LATE_START":
        return {
          windowId: window.id,
          available: start == null ? true : window.startMinutes >= start,
          capacity: null,
        };
      case "EARLY_FINISH":
        return {
          windowId: window.id,
          available: end == null ? true : window.endMinutes <= end,
          capacity: null,
        };
      case "EXTRA_HOURS":
        return {
          windowId: window.id,
          available: start == null || end == null ? true : overlaps(window, start, end),
          capacity,
        };
      case "CAPACITY_OVERRIDE":
        return {
          windowId: window.id,
          available: true,
          capacity,
        };
      case "CUSTOM":
      default: {
        const inRange = start == null || end == null ? true : overlaps(window, start, end);
        return {
          windowId: window.id,
          available: inRange ? input.available !== false : false,
          capacity: inRange ? capacity : null,
        };
      }
    }
  });
}

export function formatExceptionSummary(input: {
  kind?: string | null;
  available: boolean;
  capacity?: number | null;
  reason?: string | null;
  startMinutes?: number | null;
  endMinutes?: number | null;
}) {
  const kind = parseExceptionKind(input.kind);
  const label = kind ? EXCEPTION_KIND_LABELS[kind] : input.available ? "Extra availability" : "Blocked";
  const bits = [label];
  if (input.capacity != null) bits.push(`Capacity ${input.capacity}`);
  if (input.reason && input.reason !== kind && input.reason !== label) bits.push(input.reason);
  return bits.join(" · ");
}
