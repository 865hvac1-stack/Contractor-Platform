import type { PrismaClient } from "@prisma/client";
import { QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { type QuickBooksScope } from "@/lib/quickbooks/ownership";
import { loadQuickBooksProductionPreview } from "@/lib/quickbooks/production-preview";
import { qboCount, readOnlyQuickBooksTransport } from "@/lib/quickbooks/read-only";
import { INBOUND_OBJECT_TYPES, type InboundObjectType } from "@/lib/quickbooks/inbound-types";

export type ReconciliationRow = {
  objectType: InboundObjectType;
  quickbooks: number;
  contractorYou: number;
  difference: number;
  status: "MATCHED" | "DIFFERENCE" | "REQUIRES_REVIEW";
  note: string;
};

export async function buildQuickBooksReconciliation(prisma: PrismaClient, companyId: string, scope: QuickBooksScope) {
  const preview = await loadQuickBooksProductionPreview(prisma, companyId).catch(() => null);
  const loaded = await loadQuickBooksTransport(companyId);
  const transport = loaded.ok ? readOnlyQuickBooksTransport(loaded.transport) : null;

  const qboCounts: Record<InboundObjectType, number> = {
    CUSTOMER: preview?.customers.count ?? 0,
    INVOICE: preview?.invoices.count ?? 0,
    PAYMENT: preview?.payments.count ?? 0,
    ITEM: preview?.items.count ?? 0,
    PURCHASE: preview?.expenses.count ?? 0,
    VENDOR: transport ? (await qboCount(transport, "Vendor")).count : 0,
    ACCOUNT: transport ? (await qboCount(transport, "Account")).count : 0,
  };

  const [customers, invoices, payments, items, expenses, vendors, accounts, invoiceSum, paymentSum, expenseSum] =
    await Promise.all([
      prisma.customer.count({ where: { companyId, OR: [{ quickbooksRealmId: scope.realmId }, { sourceSystem: QUICKBOOKS_SOURCE }] } }),
      prisma.invoice.count({ where: { companyId, OR: [{ quickbooksRealmId: scope.realmId }, { sourceSystem: QUICKBOOKS_SOURCE }] } }),
      prisma.payment.count({ where: { companyId, OR: [{ quickbooksRealmId: scope.realmId }, { sourceSystem: QUICKBOOKS_SOURCE }] } }),
      prisma.pricebookItem.count({ where: { companyId, OR: [{ quickbooksRealmId: scope.realmId }, { sourceSystem: QUICKBOOKS_SOURCE }] } }),
      prisma.expense.count({ where: { companyId, OR: [{ quickbooksRealmId: scope.realmId }, { sourceSystem: QUICKBOOKS_SOURCE }] } }),
      prisma.vendor.count({ where: { companyId, quickbooksRealmId: scope.realmId } }),
      prisma.accountingAccount.count({ where: { companyId, quickbooksRealmId: scope.realmId } }),
      prisma.invoice.aggregate({
        where: { companyId, sourceSystem: QUICKBOOKS_SOURCE, status: { not: "VOID" } },
        _sum: { totalCents: true, balanceCents: true },
      }),
      prisma.payment.aggregate({
        where: { companyId, sourceSystem: QUICKBOOKS_SOURCE },
        _sum: { amountCents: true },
      }),
      prisma.expense.aggregate({
        where: { companyId, sourceSystem: QUICKBOOKS_SOURCE },
        _sum: { amountCents: true },
      }),
    ]);

  const cy: Record<InboundObjectType, number> = {
    CUSTOMER: customers,
    INVOICE: invoices,
    PAYMENT: payments,
    ITEM: items,
    PURCHASE: expenses,
    VENDOR: vendors,
    ACCOUNT: accounts,
  };

  const rows: ReconciliationRow[] = INBOUND_OBJECT_TYPES.map((objectType) => {
    const quickbooks = qboCounts[objectType];
    const contractorYou = cy[objectType];
    const difference = contractorYou - quickbooks;
    return {
      objectType,
      quickbooks,
      contractorYou,
      difference,
      status: difference === 0 ? "MATCHED" : Math.abs(difference) / Math.max(quickbooks, 1) < 0.02 ? "DIFFERENCE" : "REQUIRES_REVIEW",
      note:
        difference === 0
          ? "Counts match the last QuickBooks read."
          : "Counts differ. Possible matches still in review or analysis is incomplete.",
    };
  });

  const reviewCount = await prisma.quickBooksImportReview.count({
    where: { companyId, environment: scope.environment, realmId: scope.realmId, status: { in: ["OPEN", "FAILED"] } },
  });
  if (reviewCount > 0) {
    for (const row of rows) {
      if (row.status === "MATCHED") continue;
      row.status = "REQUIRES_REVIEW";
      row.note = `${reviewCount} review items are still open.`;
    }
  }

  return {
    rows,
    totals: {
      invoiceTotalCents: invoiceSum._sum.totalCents ?? 0,
      outstandingCents: invoiceSum._sum.balanceCents ?? 0,
      paymentTotalCents: paymentSum._sum.amountCents ?? 0,
      expenseTotalCents: expenseSum._sum.amountCents ?? 0,
    },
    mappingsSufficient: (await prisma.accountingAccount.count({ where: { companyId, classification: "INCOME" } })) > 0,
    writeBack: "disabled" as const,
  };
}
