import type { InvoiceStatus, Prisma } from "@prisma/client";

const INVOICE_STATUSES = new Set<string>([
  "DRAFT",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
]);

export function parseInvoicesListQuery(input: { status?: string }) {
  return { status: input.status?.trim() || undefined };
}

export function invoicesWhere(companyId: string, status?: string, now = new Date()): Prisma.InvoiceWhereInput {
  if (!status || status === "ALL") return { companyId };
  if (status === "OPEN") {
    return { companyId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, balanceCents: { gt: 0 } };
  }
  if (status === "OVERDUE") {
    return {
      companyId,
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      balanceCents: { gt: 0 },
      dueDate: { lt: now },
    };
  }
  if (INVOICE_STATUSES.has(status)) {
    return { companyId, status: status as InvoiceStatus };
  }
  return { companyId };
}

export function invoicesListHref(status?: string) {
  if (!status || status === "ALL") return "/invoices";
  return `/invoices?status=${encodeURIComponent(status)}`;
}
