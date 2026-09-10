import type { PrismaClient } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";
import { ENTITY_INVOICE, ENTITY_PAYMENT } from "@/lib/quickbooks/mappings";

const ENTITY_EXPENSE = "EXPENSE";
import {
  evaluateInvoiceEligibility,
  evaluatePaymentEligibility,
  hasValidQuickBooksMapping,
  isAfterSyncStart,
  mappingKey,
  QBO_PAYMENT_SUCCESS_STATUSES,
  reviewItemFromPaymentEligibility,
  type PaymentEligibility,
  type PaymentReviewItem,
  type QboMappingSnapshot,
} from "@/lib/quickbooks/eligibility";

export type QuickBooksPreview = {
  customersAvailable: number;
  customersLinked: number;
  customersNeedReview: number;
  invoicesEligible: number;
  invoicesSynced: number;
  invoicesPending: number;
  invoicesErrors: number;
  invoicesNeedsReview: number;
  paymentsEligible: number;
  paymentsSynced: number;
  paymentsPending: number;
  paymentsErrors: number;
  paymentsNeedsReview: number;
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
  paymentReviews: PaymentReviewItem[];
  paymentEligibility: Array<{ paymentId: string } & PaymentEligibility>;
};

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
      where: { companyId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issueDate: true,
        importMode: true,
        totalCents: true,
      },
    }),
    prisma.payment.findMany({
      where: { companyId, status: { in: [...QBO_PAYMENT_SUCCESS_STATUSES] } },
      select: {
        id: true,
        invoiceId: true,
        paidAt: true,
        importMode: true,
        status: true,
        amountCents: true,
        refundedCents: true,
        provider: true,
        providerPaymentId: true,
      },
    }),
    prisma.expense.findMany({
      where: { companyId, status: { in: ["APPROVED", "POSTED"] } },
      select: { id: true, date: true, importMode: true },
    }),
    prisma.quickBooksMapping.findMany({
      where: { companyId, entityType: { in: ["CUSTOMER", ENTITY_INVOICE, ENTITY_PAYMENT, ENTITY_EXPENSE] } },
      select: { entityType: true, internalId: true, status: true, quickbooksId: true },
    }),
  ]);

  const map = new Map<string, QboMappingSnapshot>(
    mappings.map((row) => [mappingKey(row.entityType, row.internalId), row])
  );
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const paymentsByInvoice = new Map<string, typeof payments>();
  for (const payment of payments) {
    const list = paymentsByInvoice.get(payment.invoiceId) ?? [];
    list.push(payment);
    paymentsByInvoice.set(payment.invoiceId, list);
  }
  const syncedPaymentIds = mappings
    .filter((row) => row.entityType === ENTITY_PAYMENT && hasValidQuickBooksMapping(row))
    .map((row) => row.internalId);

  let invoicesEligible = 0;
  let invoicesPending = 0;
  let invoicesErrors = 0;
  let invoicesNeedsReview = 0;
  let paymentsEligible = 0;
  let paymentsPending = 0;
  let paymentsErrors = 0;
  let paymentsNeedsReview = 0;
  let expensesEligible = 0;
  let expensesPending = 0;
  let expensesErrors = 0;
  let historicalProtected = 0;
  let beforeStartDate = 0;
  const paymentEligibility: QuickBooksPreview["paymentEligibility"] = [];
  const paymentReviews: PaymentReviewItem[] = [];

  for (const invoice of invoices) {
    if (invoice.status === "DRAFT" || invoice.status === "VOID") continue;
    const mapping = map.get(mappingKey(ENTITY_INVOICE, invoice.id));
    if (mapping?.status === "FAILED") invoicesErrors += 1;
    const eligibility = evaluateInvoiceEligibility(invoice, { syncStartDate: start, mapping });
    if (eligibility.state === "HISTORICAL") {
      historicalProtected += 1;
      continue;
    }
    if (eligibility.state === "OUT_OF_SCOPE") {
      beforeStartDate += 1;
      continue;
    }
    if (eligibility.state === "NEEDS_REVIEW") invoicesNeedsReview += 1;
    if (eligibility.state === "MAPPED" || eligibility.state === "ELIGIBLE" || eligibility.state === "NEEDS_REVIEW") {
      invoicesEligible += 1;
    }
    if (eligibility.state === "ELIGIBLE" || eligibility.state === "NEEDS_REVIEW") {
      invoicesPending += 1;
    }
  }

  for (const payment of payments) {
    const invoice = invoicesById.get(payment.invoiceId) ?? null;
    const eligibility = evaluatePaymentEligibility({
      payment,
      invoice,
      siblingPayments: paymentsByInvoice.get(payment.invoiceId) ?? [payment],
      paymentMapping: map.get(mappingKey(ENTITY_PAYMENT, payment.id)),
      invoiceMapping: invoice ? map.get(mappingKey(ENTITY_INVOICE, invoice.id)) : null,
      syncedPaymentIds,
      syncStartDate: start,
    });
    paymentEligibility.push({ paymentId: payment.id, ...eligibility });
    const mapping = map.get(mappingKey(ENTITY_PAYMENT, payment.id));
    if (mapping?.status === "FAILED") paymentsErrors += 1;
    if (eligibility.state === "HISTORICAL") {
      historicalProtected += 1;
      continue;
    }
    if (eligibility.state === "OUT_OF_SCOPE") {
      beforeStartDate += 1;
      continue;
    }
    if (eligibility.pending) {
      paymentsEligible += 1;
      paymentsPending += 1;
    }
    if (eligibility.needsReview) {
      paymentsNeedsReview += 1;
      const review = reviewItemFromPaymentEligibility(payment.id, eligibility);
      if (review) paymentReviews.push(review);
    }
  }

  for (const expense of expenses) {
    const mapping = map.get(mappingKey(ENTITY_EXPENSE, expense.id));
    if (mapping?.status === "FAILED") expensesErrors += 1;
    if (isHistoricalImport(expense.importMode)) {
      historicalProtected += 1;
      continue;
    }
    if (!isAfterSyncStart(expense.date, start)) {
      beforeStartDate += 1;
      continue;
    }
    expensesEligible += 1;
    if (!mapping?.status || mapping.status === "PENDING" || mapping.status === "NEEDS_REVIEW") {
      expensesPending += 1;
    }
  }

  const customerMaps = mappings.filter((row) => row.entityType === "CUSTOMER");
  const customersLinked = customerMaps.filter((row) => row.status === "SYNCED").length;
  const customersNeedReview = customerMaps.filter((row) => row.status === "NEEDS_REVIEW").length;
  const invoicesSynced = mappings.filter((row) => row.entityType === ENTITY_INVOICE && row.status === "SYNCED").length;
  const paymentsSynced = mappings.filter((row) => row.entityType === ENTITY_PAYMENT && row.status === "SYNCED").length;
  const expensesSynced = mappings.filter((row) => row.entityType === ENTITY_EXPENSE && row.status === "SYNCED").length;
  const mappingNeedReview = mappings.filter((row) => row.status === "NEEDS_REVIEW").length;

  return {
    customersAvailable: customers.length,
    customersLinked,
    customersNeedReview,
    invoicesEligible,
    invoicesSynced,
    invoicesPending,
    invoicesErrors,
    invoicesNeedsReview,
    paymentsEligible,
    paymentsSynced,
    paymentsPending,
    paymentsErrors,
    paymentsNeedsReview,
    expensesEligible,
    expensesSynced,
    expensesPending,
    expensesErrors,
    conflicts: mappingNeedReview + paymentsNeedsReview,
    needReview: mappingNeedReview + paymentsNeedsReview,
    historicalProtected,
    beforeStartDate,
    syncActivated: Boolean(settings?.syncActivated),
    syncStartDate: start,
    paymentReviews,
    paymentEligibility,
  };
}
