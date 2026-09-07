import type { WaitingCadence } from "@prisma/client";

export function cadenceDays(cadence: WaitingCadence, customDays: number | null | undefined): number | null {
  switch (cadence) {
    case "DAILY":
      return 1;
    case "EVERY_2_DAYS":
      return 2;
    case "EVERY_3_DAYS":
      return 3;
    case "WEEKLY":
      return 7;
    case "CUSTOM":
      return customDays && customDays > 0 ? Math.min(30, Math.floor(customDays)) : 3;
    case "MANUAL":
      return null;
    default:
      return 3;
  }
}

export function tzOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

export function zonedDate(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return new Date(utcGuess.getTime() - tzOffsetMs(utcGuess, timezone));
}

export function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

export function snapToBusinessHour(date: Date, timezone: string, businessHourStart: number): Date {
  const hour = Math.min(20, Math.max(6, Math.floor(businessHourStart || 10)));
  const parts = zonedParts(date, timezone);
  return zonedDate(timezone, parts.year, parts.month, parts.day, hour, 0);
}

export function nextCustomerUpdateAt(input: {
  from: Date;
  cadence: WaitingCadence;
  customCadenceDays?: number | null;
  timezone: string;
  businessHourStart?: number;
}): Date | null {
  const days = cadenceDays(input.cadence, input.customCadenceDays);
  if (days == null) return null;
  const next = new Date(input.from.getTime() + days * 86_400_000);
  return snapToBusinessHour(next, input.timezone || "America/New_York", input.businessHourStart ?? 10);
}

export function waitingIdempotencyKey(recordId: string, kind: string, slot: Date | string): string {
  const iso = slot instanceof Date ? slot.toISOString() : slot;
  return `${recordId}:${kind}:${iso}`;
}

export function formatWaitingDate(date: Date | null | undefined, timezone = "America/New_York"): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  }).format(date);
}

export function relativeWaitingDay(date: Date | null | undefined, now = new Date()): string {
  if (!date) return "—";
  const days = Math.round((startOfUtcDay(date).getTime() - startOfUtcDay(now).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1) return `In ${days} days`;
  return `${Math.abs(days)} days ago`;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysWaitingSince(enteredAt: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - enteredAt.getTime()) / 86_400_000));
}
