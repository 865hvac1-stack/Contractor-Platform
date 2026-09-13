import type { PrismaClient } from "@prisma/client";
import { QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";

export async function customerFinancialHistory(prisma: PrismaClient, companyId: string, customerId: string) {
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, customerId },
      include: { lineItems: { orderBy: { sortOrder: "asc" } }, payments: { orderBy: { paidAt: "desc" } } },
      orderBy: { issueDate: "desc" },
    }),
    prisma.payment.findMany({
      where: { companyId, customerId },
      orderBy: { paidAt: "desc" },
    }),
  ]);
  const live = invoices.filter((row) => row.status !== "VOID");
  const invoiced = live.reduce((sum, row) => sum + row.totalCents, 0);
  const outstanding = live.reduce((sum, row) => sum + row.balanceCents, 0);
  const collected = payments.reduce((sum, row) => sum + Math.max(0, row.amountCents - row.refundedCents), 0);
  const lastPayment = payments[0] ?? null;
  const averageInvoice = live.length ? Math.round(invoiced / live.length) : 0;
  return {
    lifetimeRevenueCents: collected,
    totalInvoicedCents: invoiced,
    totalPaidCents: collected,
    outstandingBalanceCents: outstanding,
    averageInvoiceCents: averageInvoice,
    lastPayment,
    openInvoices: live.filter((row) => row.balanceCents > 0 && row.status !== "VOID"),
    historicalInvoices: invoices,
    historicalPayments: payments,
  };
}

export async function importedMoneySnapshot(prisma: PrismaClient, companyId: string, start: Date, end: Date) {
  const classifiedAccounts = await prisma.accountingAccount.count({
    where: { companyId, classification: { in: ["INCOME", "COGS", "OPERATING_EXPENSE"] } },
  });
  const [invoices, payments, expenses, cogs] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        companyId,
        sourceSystem: QUICKBOOKS_SOURCE,
        status: { not: "VOID" },
        issueDate: { gte: start, lte: end },
      },
      select: { totalCents: true, balanceCents: true, customerId: true },
    }),
    prisma.payment.findMany({
      where: { companyId, sourceSystem: QUICKBOOKS_SOURCE, paidAt: { gte: start, lte: end } },
      select: { amountCents: true, refundedCents: true },
    }),
    prisma.expense.findMany({
      where: { companyId, sourceSystem: QUICKBOOKS_SOURCE, date: { gte: start, lte: end } },
      include: { account: true, vendorRecord: true },
    }),
    prisma.expense.aggregate({
      where: {
        companyId,
        sourceSystem: QUICKBOOKS_SOURCE,
        date: { gte: start, lte: end },
        account: { classification: "COGS" },
      },
      _sum: { amountCents: true },
    }),
  ]);
  const revenueCents = invoices.reduce((sum, row) => sum + row.totalCents, 0);
  const collectedCents = payments.reduce((sum, row) => sum + Math.max(0, row.amountCents - row.refundedCents), 0);
  const outstandingCents = invoices.reduce((sum, row) => sum + row.balanceCents, 0);
  const expenseCents = expenses.reduce((sum, row) => sum + row.amountCents, 0);
  const cogsCents = cogs._sum.amountCents ?? 0;
  const operatingCents = expenses
    .filter((row) => row.account?.classification === "OPERATING_EXPENSE")
    .reduce((sum, row) => sum + row.amountCents, 0);
  const mappingsReady = classifiedAccounts > 0;
  return {
    mappingsReady,
    incompleteReason: mappingsReady
      ? null
      : "Chart of Accounts has not been imported and classified yet. These figures are imported transaction totals, not a profit and loss statement.",
    revenueCents,
    collectedCents,
    outstandingCents,
    expenseCents: mappingsReady ? operatingCents + cogsCents : expenseCents,
    cogsCents: mappingsReady ? cogsCents : null,
    grossProfitCents: mappingsReady ? revenueCents - cogsCents : null,
    grossMarginPercent:
      mappingsReady && revenueCents > 0 ? Math.round(((revenueCents - cogsCents) / revenueCents) * 1000) / 10 : null,
    averageTicketCents: invoices.length ? Math.round(revenueCents / invoices.length) : null,
    invoiceCount: invoices.length,
    paymentCount: payments.length,
    expenses,
  };
}

export async function accountMappingReady(prisma: PrismaClient, companyId: string) {
  const [income, cogs, opex] = await Promise.all([
    prisma.accountingAccount.count({ where: { companyId, classification: "INCOME" } }),
    prisma.accountingAccount.count({ where: { companyId, classification: "COGS" } }),
    prisma.accountingAccount.count({ where: { companyId, classification: "OPERATING_EXPENSE" } }),
  ]);
  return { income, cogs, opex, ready: income > 0 && (cogs > 0 || opex > 0) };
}
