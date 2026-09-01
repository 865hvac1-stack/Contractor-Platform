/** Build America/New_York timestamps relative to "now" so reset keeps the demo current. */

const TIME_ZONE = "America/New_York";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function zonedTime(year: number, month: number, day: number, hour = 12, minute = 0) {
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const asZone = new Date(utc.toLocaleString("en-US", { timeZone: TIME_ZONE }));
  return new Date(utc.getTime() + (utc.getTime() - asZone.getTime()));
}

export function partsInZone(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

export function startOfDemoDay(now = new Date()) {
  const parts = partsInZone(now);
  return zonedTime(parts.year, parts.month, parts.day, 0, 0);
}

export function atDemoHour(now: Date, hour: number, minute = 0) {
  const parts = partsInZone(now);
  return zonedTime(parts.year, parts.month, parts.day, hour, minute);
}

export function addDemoDays(now: Date, days: number, hour = 9, minute = 0) {
  const base = new Date(startOfDemoDay(now).getTime() + days * 24 * 60 * 60 * 1000);
  const parts = partsInZone(base);
  return zonedTime(parts.year, parts.month, parts.day, hour, minute);
}

export function monthsAgo(now: Date, months: number, day = 12, hour = 10) {
  const parts = partsInZone(now);
  const monthIndex = parts.month - 1 - months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  return zonedTime(year, month + 1, Math.min(day, 28), hour, 0);
}

export function isoDate(date: Date) {
  const parts = partsInZone(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}
