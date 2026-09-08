import { endOfDay } from "date-fns";
import { homeRangeHref } from "@/lib/finance/hrefs";
import { parseFinanceDay, parseFinanceRange, type FinanceRange } from "@/lib/finance/period";

export type FinanceSearch = {
  from?: string;
  to?: string;
  start: Date | null;
  end: Date | null;
  status?: string;
  view?: string;
  serviceType?: string;
  source?: string;
  range: FinanceRange;
  needsInvoice: boolean;
  backHref: string;
};

export function parseFinanceSearch(input: {
  from?: string;
  to?: string;
  status?: string;
  view?: string;
  serviceType?: string;
  source?: string;
  range?: string;
  needsInvoice?: string;
}): FinanceSearch {
  const start = input.from ? parseFinanceDay(input.from) : null;
  const parsedTo = input.to ? parseFinanceDay(input.to) : null;
  const end = parsedTo ? endOfDay(parsedTo) : start ? endOfDay(start) : null;
  const range = parseFinanceRange(input.range);
  return {
    from: input.from?.trim() || undefined,
    to: input.to?.trim() || undefined,
    start,
    end,
    status: input.status?.trim() || undefined,
    view: input.view?.trim() || undefined,
    serviceType: input.serviceType?.trim() || undefined,
    source: input.source?.trim() || undefined,
    range,
    needsInvoice: input.needsInvoice === "1" || input.needsInvoice === "true",
    backHref: homeRangeHref(range),
  };
}

export function financePeriodUsesInvoiceDates(query: Pick<FinanceSearch, "status" | "view">) {
  return query.status === "PAID" || query.view === "revenue" || query.view === "ticket";
}

export function formatFinanceDateLabel(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : parseFinanceDay(value);
  if (!date) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function financeRangeDetail(query: Pick<FinanceSearch, "from" | "to" | "range" | "view">) {
  const fromLabel = formatFinanceDateLabel(query.from);
  const toLabel = formatFinanceDateLabel(query.to);
  if (fromLabel && toLabel && query.from === query.to) return fromLabel;
  if (fromLabel && toLabel) return `${fromLabel} – ${toLabel}`;
  if (query.range === "30d") return "Last 30 days";
  if (query.range === "90d") return "Last 90 days";
  if (query.range === "12m") return "Last 12 months";
  return "This month";
}

export function financeFilterCopy(query: FinanceSearch): { title: string; detail: string } | null {
  if (query.source !== "home" && !query.view && !query.needsInvoice && !query.serviceType) {
    if (query.status === "overdue" || query.status === "OPEN" || query.status === "open" || query.status === "PAID") {
      // still explain explicit status filters from Home even if source is omitted
    } else {
      return null;
    }
  }

  if (query.needsInvoice) {
    return {
      title: "Ready to invoice",
      detail: "Completed jobs that still have no invoice.",
    };
  }
  if (query.view === "collected") {
    return { title: "Collected", detail: `Payments collected ${financeRangeDetail(query)}.` };
  }
  if (query.view === "profit") {
    return {
      title: "Gross profit",
      detail: `Jobs, invoices, and confirmed costs used for ${financeRangeDetail(query)}.`,
    };
  }
  if (query.view === "ar" || query.status === "OPEN") {
    return { title: "A/R", detail: "Outstanding invoices that are sent, partially paid, or overdue." };
  }
  if (query.view === "overdue" || query.status === "overdue") {
    return { title: "Overdue A/R", detail: "Outstanding invoices whose due date has already passed." };
  }
  if (query.view === "ticket") {
    return {
      title: "Average ticket",
      detail: `Paid invoices used to calculate average ticket for ${financeRangeDetail(query)}.`,
    };
  }
  if (query.view === "day") {
    return {
      title: "Revenue & collections",
      detail: `Invoices and payments for ${financeRangeDetail(query)}.`,
    };
  }
  if (query.serviceType) {
    return {
      title: query.serviceType,
      detail: `Paid invoices in ${query.serviceType} for ${financeRangeDetail(query)}.`,
    };
  }
  if (query.view === "revenue" || query.status === "PAID") {
    return { title: "Revenue", detail: `Paid invoices for ${financeRangeDetail(query)}.` };
  }
  if (query.status === "open") {
    return { title: "Open estimates", detail: "Draft, sent, and viewed estimates that have not been decided." };
  }
  if (query.source === "home") {
    return { title: "From Home", detail: financeRangeDetail(query) };
  }
  return null;
}
