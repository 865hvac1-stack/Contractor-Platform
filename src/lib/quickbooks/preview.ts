import type { PrismaClient } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";

export type QuickBooksPreview = {
  customersAvailable: number;
  customersLinked: number;
  customersNeedReview: number;
  invoicesEligible: number;
  invoicesSynced: number;
  invoicesPending: number;
  invoicesErrors: number;
  paymentsEligible: number;
  paymentsSynced: number;
  paymentsPending: number;
  paymentsErrors: number;
  expensesEligible: number;
  expensesSynced: number;
  expensesPending: number;
  expensesErrors: number;
  conflicts: number;
  needReview: number;
  historicalProtected: number;
  beforeStartDate: number;
  syncActivated: boolean;
  syncStartDate: Date | null;
};

function afterStart(date: Date, start: Date | null) {
  return !start || date >= start;
}

export async function previewQuickBooksSync(
  prisma: PrismaClient,
  companyId: string
): Promise<QuickBooksPreview> {
  const settings = await prisma.quickBooksSettings.findUnique({ where: { companyId } });
  const start = settings?.syncStartDate ?? null;

  const [customers, invoices, payments, expenses, mappings] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId, status: { not: "ARCHIVED" } },
      select: { id: true },
    }),
    prisma.invoice.findMany({
      where: { companyId, status: { notIn: ["DRAFT", "VOID"] } },
      select: { id: true, issueDate: true, importMode: true },
    }),
    prisma.payment.findMany({
      where: { companyId, status: { in: ["CONFIRMED", "SUCCEEDED", "RECORDED", "PARTIALLY_REFUNDED"] } },
      select: { id: true, paidAt: true, importMode: true },
    }),
    prisma.expense.findMany({
      where: { companyId, status: { in: ["APPROVED", "POSTED"] } },
      select: { id: true, date: true, importMode: true },
    }),
    prisma.quickBooksMapping.findMany({
      where: { companyId, entityType: { in: ["CUSTOMER", "INVOICE", "PAYMENT", "EXPENSE"] } },
      select: { entityType: true, internalId: true, status: true },
    }),
  ]);

  const map = new Map(mappings.map((row) => [`${row.entityType}:${row.internalId}`, row]));
  const statusOf = (type: string, id: string) => map.get(`${type}:${id}`)?.status ?? null;

  let invoicesEligible = 0;
  let invoicesPending = 0;
  let invoicesErrors = 0;
  let paymentsEligible = 0;
  let paymentsPending = 0;
  let paymentsErrors = 0;
  let expensesEligible = 0;
  let expensesPending = 0;
  let expensesErrors = 0;
  let historicalProtected = 0;
  let beforeStartDate = 0;

  for (const invoice of invoices) {
    const status = statusOf("INVOICE", invoice.id);
    if (status === "FAILED") invoicesErrors += 1;
    if (isHistoricalImport(invoice.importMode)) {
      historicalProtected += 1;
      continue;
    }
    if (!afterStart(invoice.issueDate, start)) {
      beforeStartDate += 1;
      continue;
    }
    invoicesEligible += 1;
    if (!status || status === "PENDING" || status === "NEEDS_REVIEW") invoicesPending += 1;
  }
  for (const payment of payments) {
    const status = statusOf("PAYMENT", payment.id);
    if (status === "FAILED") paymentsErrors += 1;
    if (isHistoricalImport(payment.importMode)) {
      historicalProtected += 1;
      continue;
    }
    if (!afterStart(payment.paidAt, start)) {
      beforeStartDate += 1;
      continue;
    }
    paymentsEligible += 1;
    if (!status || status === "PENDING" || status === "NEEDS_REVIEW") paymentsPending += 1;
  }
  for (const expense of expenses) {
    const status = statusOf("EXPENSE", expense.id);
    if (status === "FAILED") expensesErrors += 1;
    if (isHistoricalImport(expense.importMode)) {
      historicalProtected += 1;
      continue;
    }
    if (!afterStart(expense.date, start)) {
      beforeStartDate += 1;
      continue;
    }
    expensesEligible += 1;
    if (!status || status === "PENDING" || status === "NEEDS_REVIEW") expensesPending += 1;
  }

  const customerMaps = mappings.filter((row) => row.entityType === "CUSTOMER");
  const customersLinked = customerMaps.filter((row) => row.status === "SYNCED").length;
  const customersNeedReview = customerMaps.filter((row) => row.status === "NEEDS_REVIEW").length;
  const invoicesSynced = mappings.filter((row) => row.entityType === "INVOICE" && row.status === "SYNCED").length;
  const paymentsSynced = mappings.filter((row) => row.entityType === "PAYMENT" && row.status === "SYNCED").length;
  const expensesSynced = mappings.filter((row) => row.entityType === "EXPENSE" && row.status === "SYNCED").length;
  const needReview = mappings.filter((row) => row.status === "NEEDS_REVIEW").length;

  return {
    customersAvailable: customers.length,
    customersLinked,
    customersNeedReview,
    invoicesEligible,
    invoicesSynced,
    invoicesPending,
    invoicesErrors,
    paymentsEligible,
    paymentsSynced,
    paymentsPending,
    paymentsErrors,
    expensesEligible,
    expensesSynced,
    expensesPending,
    expensesErrors,
    conflicts: needReview,
    needReview,
    historicalProtected,
    beforeStartDate,
    syncActivated: Boolean(settings?.syncActivated),
    syncStartDate: start,
  };
}
