import type { Prisma } from "@prisma/client";

export const REVENUE_DEFINITION =
  "Paid invoices whose paid/updated timestamp falls in the selected period. Draft and void invoices are excluded.";

export const COLLECTED_DEFINITION =
  "Customer payments recorded as collected in the period, net of refunds. Matches the Payments ledger.";

export const GROSS_PROFIT_DEFINITION =
  "Paid invoice totals for jobs in the period minus confirmed job costs and leftover job expenses. Shown only when verified cost data exists.";

export const AR_DEFINITION =
  "Current outstanding invoice balances that are sent, partially paid, or overdue. Point-in-time, not period-limited.";

export const OPEN_ESTIMATE_DEFINITION = "Draft, sent, and viewed estimates that have not been decided.";

export const OVERDUE_AR_DEFINITION = "Outstanding invoices whose due date has already passed.";

export const AVERAGE_TICKET_DEFINITION = "Paid invoice totals in the period divided by the number of those invoices.";

export const READY_TO_INVOICE_DEFINITION = "Completed jobs that still have no invoice.";

export const COLLECTED_PAYMENT_STATUSES = [
  "CONFIRMED",
  "SUCCEEDED",
  "RECORDED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export function revenueInvoiceWhere(
  companyId: string,
  start: Date,
  end: Date
): Prisma.InvoiceWhereInput {
  return { companyId, status: "PAID", updatedAt: { gte: start, lte: end } };
}

export function outstandingInvoiceWhere(companyId: string): Prisma.InvoiceWhereInput {
  return {
    companyId,
    status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
    balanceCents: { gt: 0 },
  };
}

export function overdueInvoiceWhere(companyId: string, now = new Date()): Prisma.InvoiceWhereInput {
  return {
    ...outstandingInvoiceWhere(companyId),
    dueDate: { lt: now },
  };
}

export function collectedPaymentWhere(
  companyId: string,
  start: Date,
  end: Date
): Prisma.PaymentWhereInput {
  return {
    companyId,
    paidAt: { gte: start, lte: end },
    status: { in: [...COLLECTED_PAYMENT_STATUSES] },
  };
}

export function openEstimateWhere(companyId: string): Prisma.EstimateWhereInput {
  return { companyId, status: { in: ["DRAFT", "SENT", "VIEWED"] } };
}

export function readyToInvoiceWhere(companyId: string): Prisma.JobWhereInput {
  return { companyId, status: "COMPLETED", invoices: { none: {} } };
}

export function revenueCategoryLabel(invoice: {
  serviceType?: { name: string } | null;
  job?: { jobType?: string | null; serviceType?: { name: string } | null } | null;
}) {
  return (
    invoice.serviceType?.name?.trim() ||
    invoice.job?.serviceType?.name?.trim() ||
    invoice.job?.jobType?.trim() ||
    "Other"
  );
}

export function revenueCategoryWhere(label: string): Prisma.InvoiceWhereInput {
  if (label === "Other") {
    return {
      AND: [
        { OR: [{ serviceTypeId: null }, { serviceType: { name: { equals: "" } } }] },
        {
          OR: [
            { jobId: null },
            {
              job: {
                AND: [
                  { OR: [{ serviceTypeId: null }, { serviceType: { name: { equals: "" } } }] },
                  { OR: [{ jobType: null }, { jobType: "" }] },
                ],
              },
            },
          ],
        },
      ],
    };
  }
  return {
    OR: [
      { serviceType: { name: { equals: label, mode: "insensitive" } } },
      {
        AND: [
          { OR: [{ serviceTypeId: null }, { serviceType: { name: { equals: "" } } }] },
          { job: { serviceType: { name: { equals: label, mode: "insensitive" } } } },
        ],
      },
      {
        AND: [
          { OR: [{ serviceTypeId: null }, { serviceType: { name: { equals: "" } } }] },
          { OR: [{ job: { serviceTypeId: null } }, { job: { serviceType: { name: { equals: "" } } } }] },
          { job: { jobType: { equals: label, mode: "insensitive" } } },
        ],
      },
    ],
  };
}
