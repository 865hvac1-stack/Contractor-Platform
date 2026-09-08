const MINUTES_PER_DAY = 24 * 60;

export type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatClockMinutes(minutes: number) {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${pad2(mins)} ${period}`;
}

export function formatWindowClock(startMinutes: number, endMinutes: number) {
  return `${formatClockMinutes(startMinutes)}–${formatClockMinutes(endMinutes)}`;
}

export function formatWindowChip(startMinutes: number, endMinutes: number) {
  const start = formatClockMinutes(startMinutes);
  const end = formatClockMinutes(endMinutes);
  const startPeriod = start.slice(-2);
  const endPeriod = end.slice(-2);
  const startClock = start.replace(/ (AM|PM)$/, "").replace(":00", "");
  const endClock = end.replace(/ (AM|PM)$/, "").replace(":00", "");
  if (startPeriod === endPeriod) return `${startClock}–${endClock} ${endPeriod}`;
  return `${startClock} ${startPeriod}–${endClock} ${endPeriod}`;
}

export function parseClockToMinutes(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const mins = Number(match[2] ?? "0");
  const period = match[3]?.toUpperCase();
  if (!Number.isInteger(hours) || !Number.isInteger(mins) || mins < 0 || mins > 59) return null;
  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === "AM") hours = hours === 12 ? 0 : hours;
    if (period === "PM") hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + mins;
}

export function dateKeyFromParts(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function localParts(date: Date, timeZone: string): LocalDateParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: weekdayMap[map.weekday ?? ""] ?? 0,
  };
}

export function companyTodayKey(now: Date, timeZone: string) {
  const parts = localParts(now, timeZone);
  return dateKeyFromParts(parts.year, parts.month, parts.day);
}

export function addLocalDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day + days, 12, 0, 0);
  const next = new Date(utc);
  return dateKeyFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function weekdayFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

export function compareDateKeys(a: string, b: string) {
  return a.localeCompare(b);
}

export function daysBetweenKeys(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.round((end - start) / 86_400_000);
}

export function zonedLocalDateTime(timeZone: string, dateKey: string, minutes: number): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  let utcGuess = Date.UTC(year, month - 1, day, hours, mins, 0);
  for (let i = 0; i < 3; i += 1) {
    const parts = localParts(new Date(utcGuess), timeZone);
    const asIf = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const desired = Date.UTC(year, month - 1, day, hours, mins);
    const delta = desired - asIf;
    if (delta === 0) break;
    utcGuess += delta;
  }
  return new Date(utcGuess);
}

export function localMinutesOf(now: Date, timeZone: string) {
  const parts = localParts(now, timeZone);
  return parts.hour * 60 + parts.minute;
}

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function formatLocalDateLabel(dateKey: string, timeZone?: string | null) {
  const date = zonedLocalDateTime(timeZone || "UTC", dateKey, 12 * 60);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timeZone || undefined,
  }).format(date);
}

export function formatLocalDateShort(dateKey: string, timeZone?: string | null) {
  const date = zonedLocalDateTime(timeZone || "UTC", dateKey, 12 * 60);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timeZone || undefined,
  }).format(date);
}

export function isWeekendDateKey(dateKey: string) {
  const day = weekdayFromDateKey(dateKey);
  return day === 0 || day === 6;
}

export function monthKeyFromDateKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

export function firstOfMonthKey(year: number, month: number) {
  return dateKeyFromParts(year, month, 1);
}

export function lastOfMonthKey(year: number, month: number) {
  const next = month === 12 ? dateKeyFromParts(year + 1, 1, 1) : dateKeyFromParts(year, month + 1, 1);
  return addLocalDays(next, -1);
}
