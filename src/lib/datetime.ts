/**
 * Shared user-facing date/time display for ContractorYou.
 * Storage and provider timestamps stay unchanged.
 * Pass company.timezone when the page has it. Do not hard-code Eastern.
 */

export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function intl(date: Date, options: Intl.DateTimeFormatOptions, timeZone?: string | null) {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: timeZone || undefined,
  }).format(date);
}

export function formatDate(value: DateInput, timeZone?: string | null) {
  const date = toDate(value);
  if (!date) return "";
  return intl(date, { month: "short", day: "numeric", year: "numeric" }, timeZone);
}

export function formatTime(value: DateInput, timeZone?: string | null) {
  const date = toDate(value);
  if (!date) return "";
  return intl(date, { hour: "numeric", minute: "2-digit", hour12: true }, timeZone);
}

export function formatDateTime(value: DateInput, timeZone?: string | null) {
  const date = toDate(value);
  if (!date) return "";
  return `${formatDate(date, timeZone)} · ${formatTime(date, timeZone)}`;
}

export function formatCompactDateTime(value: DateInput, timeZone?: string | null) {
  const date = toDate(value);
  if (!date) return "";
  return `${intl(date, { month: "numeric", day: "numeric", year: "numeric" }, timeZone)} · ${formatTime(date, timeZone)}`;
}

export function formatDayTime(value: DateInput, timeZone?: string | null) {
  const date = toDate(value);
  if (!date) return "";
  const today = formatDate(new Date(), timeZone);
  const yesterday = formatDate(new Date(Date.now() - 86_400_000), timeZone);
  const day = formatDate(date, timeZone);
  const time = formatTime(date, timeZone);
  if (day === today) return `Today · ${time}`;
  if (day === yesterday) return `Yesterday · ${time}`;
  return formatDateTime(date, timeZone);
}

export function formatTimeRange(start: DateInput, end?: DateInput, timeZone?: string | null) {
  const from = toDate(start);
  if (!from) return "";
  const to = toDate(end);
  if (!to) return formatTime(from, timeZone);
  return `${formatTime(from, timeZone)} – ${formatTime(to, timeZone)}`;
}

export function formatDurationSeconds(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(secs).padStart(2, "0")}s`;
}
