import { startOfMonth, subMonths } from "date-fns";
import type { PrismaClient } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";
import { importedMoneySnapshot, accountMappingReady } from "@/lib/quickbooks/imported-finance";

export async function queryImportedFinancials(
  prisma: PrismaClient,
  companyId: string,
  question: string
) {
  const now = new Date();
  const start = startOfMonth(now);
  const snapshot = await importedMoneySnapshot(prisma, companyId, start, now);
  const mappings = await accountMappingReady(prisma, companyId);
  const q = question.toLowerCase();

  if (/owe|outstanding|a\/?r|overdue|30 days/.test(q)) {
    const overdue = await prisma.invoice.findMany({
      where: {
        companyId,
        sourceSystem: QUICKBOOKS_SOURCE,
        balanceCents: { gt: 0 },
        status: { not: "VOID" },
        dueDate: { lt: now },
      },
      include: { customer: { select: { firstName: true, lastName: true, businessName: true } } },
      orderBy: { dueDate: "asc" },
      take: 20,
    });
    return {
      narrative: overdue.length
        ? `Outstanding imported A/R includes ${overdue.length} unpaid QuickBooks invoices. Top overdue: ${overdue
            .slice(0, 5)
            .map((row) => `${row.customer.businessName || `${row.customer.firstName} ${row.customer.lastName}`} ${formatMoney(row.balanceCents)}`)
            .join("; ")}.`
        : snapshot.outstandingCents
          ? `Imported outstanding balance is ${formatMoney(snapshot.outstandingCents)}. No overdue dated invoices were found in the first 20 rows.`
          : "No imported unpaid invoices are on file yet. Run QuickBooks analysis and import before answering A/R from history.",
      outstandingCents: snapshot.outstandingCents,
      overdueCount: overdue.length,
      incomplete: !snapshot.invoiceCount,
    };
  }

  if (/top 20|top customers|spent over/.test(q)) {
    const grouped = await prisma.invoice.groupBy({
      by: ["customerId"],
      where: { companyId, sourceSystem: QUICKBOOKS_SOURCE, status: { not: "VOID" } },
      _sum: { totalCents: true },
      orderBy: { _sum: { totalCents: "desc" } },
      take: 20,
    });
    const customers = await prisma.customer.findMany({
      where: { companyId, id: { in: grouped.map((row) => row.customerId) } },
      select: { id: true, firstName: true, lastName: true, businessName: true },
    });
    const names = new Map(customers.map((row) => [row.id, row.businessName || `${row.firstName} ${row.lastName}`]));
    const min = /over \$ ?10/.test(q) ? 1_000_000 : 0;
    const rows = grouped.filter((row) => (row._sum.totalCents ?? 0) >= min);
    return {
      narrative: rows.length
        ? `Top imported customers by invoiced total: ${rows
            .slice(0, 10)
            .map((row) => `${names.get(row.customerId) || "Customer"} ${formatMoney(row._sum.totalCents ?? 0)}`)
            .join("; ")}.`
        : "No imported customer invoice totals are available yet.",
      incomplete: !grouped.length,
    };
  }

  if (/johnstone|vendor spend|largest expense/.test(q)) {
    const yearStart = startOfMonth(subMonths(now, now.getMonth()));
    const expenses = await prisma.expense.groupBy({
      by: ["vendor"],
      where: { companyId, sourceSystem: QUICKBOOKS_SOURCE, date: { gte: yearStart } },
      _sum: { amountCents: true },
      orderBy: { _sum: { amountCents: "desc" } },
      take: 15,
    });
    return {
      narrative: expenses.length
        ? `Imported vendor spend this year: ${expenses
            .map((row) => `${row.vendor || "Unknown vendor"} ${formatMoney(row._sum.amountCents ?? 0)}`)
            .join("; ")}.`
        : "No imported vendor expenses are on file yet.",
      incomplete: !expenses.length,
    };
  }

  if (/gross margin|gross profit/.test(q) && !mappings.ready) {
    return {
      narrative:
        "Gross margin cannot be answered yet. Chart of Accounts mappings for Income and COGS have not been imported for this tenant. ContractorYou will not invent a profit number.",
      incomplete: true,
    };
  }

  return {
    narrative: snapshot.incompleteReason
      ? `${snapshot.incompleteReason} Imported invoiced ${formatMoney(snapshot.revenueCents)}, collected ${formatMoney(snapshot.collectedCents)}, outstanding ${formatMoney(snapshot.outstandingCents)} this month.`
      : `This month imported QuickBooks history: invoiced ${formatMoney(snapshot.revenueCents)}, collected ${formatMoney(snapshot.collectedCents)}, outstanding ${formatMoney(snapshot.outstandingCents)}${
          snapshot.grossProfitCents != null ? `, gross profit ${formatMoney(snapshot.grossProfitCents)}` : ""
        }. Average ticket ${snapshot.averageTicketCents != null ? formatMoney(snapshot.averageTicketCents) : "is not available"}.`,
    ...snapshot,
  };
}
