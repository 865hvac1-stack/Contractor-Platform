import {
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";

export const MARKETING_RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
] as const;

export type MarketingRange = (typeof MARKETING_RANGES)[number]["value"];

export function parseMarketingRange(raw?: string): MarketingRange {
  return MARKETING_RANGES.some((r) => r.value === raw) ? (raw as MarketingRange) : "30d";
}

export function marketingPeriod(range: MarketingRange, now = new Date()) {
  switch (range) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now), label: "Today" };
    case "7d":
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now), label: "Last 7 days" };
    case "30d":
      return { start: startOfDay(subDays(now, 29)), end: endOfDay(now), label: "Last 30 days" };
    case "this_month":
      return { start: startOfMonth(now), end: endOfMonth(now), label: "This month" };
    case "last_month": {
      const prev = subMonths(now, 1);
      return { start: startOfMonth(prev), end: endOfMonth(prev), label: "Last month" };
    }
    case "quarter":
      return { start: startOfQuarter(now), end: endOfQuarter(now), label: "This quarter" };
    case "year":
      return { start: startOfYear(now), end: endOfYear(now), label: "This year" };
  }
}
