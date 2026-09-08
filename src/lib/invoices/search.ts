import type { InvoiceStatus, Prisma } from "@prisma/client";
import { endOfDay } from "date-fns";
import { revenueCategoryWhere } from "@/lib/finance/definitions";
import { parseFinanceDay } from "@/lib/finance/period";
import { financePeriodUsesInvoiceDates } from "@/lib/finance/query";

const INVOICE_STATUSES = new Set<string>([
  "DRAFT",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
]);

export type InvoicesListQuery = {
  status?: string;
  from?: string;
  to?: string;
  view?: string;
  serviceType?: string;
  source?: string;
  range?: string;
};

export function parseInvoicesListQuery(input: InvoicesListQuery): InvoicesListQuery {
  return {
    status: input.status?.trim() || undefined,
    from: input.from?.trim() || undefined,
    to: input.to?.trim() || undefined,
    view: input.view?.trim() || undefined,
    serviceType: input.serviceType?.trim() || undefined,
    source: input.source?.trim() || undefined,
    range: input.range?.trim() || undefined,
  };
}

export function invoicesWhere(
  companyId: string,
  query: InvoicesListQuery | string = {},
  now = new Date()
): Prisma.InvoiceWhereInput {
  const parsed = typeof query === "string" ? { status: query } : query;
  const status = parsed.status;
  let where: Prisma.InvoiceWhereInput = { companyId };
  if (status === "OPEN") {
    where = { companyId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, balanceCents: { gt: 0 } };
  } else if (status === "OVERDUE" || status === "overdue") {
    where = {
      companyId,
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      balanceCents: { gt: 0 },
      dueDate: { lt: now },
    };
  } else if (status && status !== "ALL" && INVOICE_STATUSES.has(status)) {
    where = { companyId, status: status as InvoiceStatus };
  }

  if (financePeriodUsesInvoiceDates(parsed)) {
    const start = parsed.from ? parseFinanceDay(parsed.from) : null;
    const end = parsed.to ? parseFinanceDay(parsed.to) : start;
    if (start && end) {
      where = { ...where, updatedAt: { gte: start, lte: endOfDay(end) } };
    }
  }

  if (parsed.serviceType) {
    where = { AND: [where, revenueCategoryWhere(parsed.serviceType)] };
  }
  return where;
}

export function invoicesListHref(query: InvoicesListQuery | string = {}) {
  const parsed = typeof query === "string" ? { status: query } : query;
  const params = new URLSearchParams();
  if (parsed.status && parsed.status !== "ALL") params.set("status", parsed.status);
  if (parsed.from) params.set("from", parsed.from);
  if (parsed.to) params.set("to", parsed.to);
  if (parsed.view) params.set("view", parsed.view);
  if (parsed.serviceType) params.set("serviceType", parsed.serviceType);
  if (parsed.source) params.set("source", parsed.source);
  if (parsed.range) params.set("range", parsed.range);
  const text = params.toString();
  return text ? `/invoices?${text}` : "/invoices";
}
