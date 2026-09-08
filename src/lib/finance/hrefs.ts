import type { FinancePeriod, FinanceRange } from "@/lib/finance/period";
import { periodFromTo } from "@/lib/finance/period";

export function homeRangeHref(range: FinanceRange) {
  return range === "month" ? "/dashboard" : `/dashboard?range=${range}`;
}

export function financeHref(
  path: string,
  input: {
    period?: FinancePeriod;
    from?: string;
    to?: string;
    status?: string;
    view?: string;
    serviceType?: string;
    needsInvoice?: boolean;
    source?: string;
  } = {}
) {
  const params = new URLSearchParams();
  const dates = input.period ? periodFromTo(input.period) : { from: input.from, to: input.to };
  if (dates.from) params.set("from", dates.from);
  if (dates.to) params.set("to", dates.to);
  if (input.status) params.set("status", input.status);
  if (input.view) params.set("view", input.view);
  if (input.serviceType) params.set("serviceType", input.serviceType);
  if (input.needsInvoice) params.set("needsInvoice", "1");
  if (input.period) params.set("range", input.period.range);
  params.set("source", input.source ?? "home");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
