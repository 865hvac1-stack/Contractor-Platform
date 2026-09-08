import { addDays, endOfDay, endOfMonth, format, startOfDay, startOfMonth, subDays, subMonths } from "date-fns";

export const FINANCE_RANGES = ["month", "30d", "90d", "12m"] as const;
export type FinanceRange = (typeof FINANCE_RANGES)[number];

export type FinancePeriod = {
  range: FinanceRange;
  start: Date;
  end: Date;
  label: string;
  grain: "day" | "month";
};

export function parseFinanceRange(value?: string | null): FinanceRange {
  return FINANCE_RANGES.includes(value as FinanceRange) ? (value as FinanceRange) : "month";
}

export function financePeriod(range: FinanceRange = "month", now = new Date()): FinancePeriod {
  if (range === "30d") {
    return {
      range,
      start: startOfDay(subDays(now, 29)),
      end: endOfDay(now),
      label: "Last 30 days",
      grain: "day",
    };
  }
  if (range === "90d") {
    return {
      range,
      start: startOfDay(subDays(now, 89)),
      end: endOfDay(now),
      label: "Last 90 days",
      grain: "day",
    };
  }
  if (range === "12m") {
    return {
      range,
      start: startOfMonth(subMonths(now, 11)),
      end: endOfMonth(now),
      label: "Last 12 months",
      grain: "month",
    };
  }
  return {
    range: "month",
    start: startOfMonth(now),
    end: endOfMonth(now),
    label: "This month",
    grain: "day",
  };
}

export function financeDayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function financeMonthKey(date: Date) {
  return format(date, "yyyy-MM");
}

export function parseFinanceDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return startOfDay(new Date(year, month - 1, day));
}

export function periodFromTo(period: FinancePeriod) {
  return { from: financeDayKey(period.start), to: financeDayKey(period.end) };
}

export function dayBounds(day: string) {
  const start = parseFinanceDay(day);
  if (!start) return null;
  return { start, end: endOfDay(start), from: day, to: day };
}

export function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return null;
  const start = startOfMonth(new Date(year, month - 1, 1));
  return { start, end: endOfMonth(start), from: financeDayKey(start), to: financeDayKey(endOfMonth(start)) };
}

export function enumerateKeys(period: FinancePeriod) {
  const keys: string[] = [];
  if (period.grain === "month") {
    let cursor = startOfMonth(period.start);
    while (cursor <= period.end) {
      keys.push(financeMonthKey(cursor));
      cursor = addDays(endOfMonth(cursor), 1);
    }
    return keys;
  }
  let cursor = startOfDay(period.start);
  while (cursor <= period.end) {
    keys.push(financeDayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}
