import type { PrismaClient } from "@prisma/client";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { previewQuickBooksSync, type QuickBooksPreview } from "@/lib/quickbooks/preview";
import {
  isEligibleForBulkSync,
  syncExpenseToQuickBooks,
  syncInvoiceToQuickBooks,
  syncPaymentToQuickBooks,
} from "@/lib/quickbooks/sync";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { ENTITY_INVOICE, ENTITY_PAYMENT } from "@/lib/quickbooks/mappings";

export type QuickBooksSyncRun = {
  preview: QuickBooksPreview;
  pushed: { invoices: number; payments: number; expenses: number };
  skipped: number;
  errors: string[];
  activated: boolean;
};

export async function runQuickBooksSync(
  prisma: PrismaClient,
  input: { companyId: string; actorId: string; push: boolean }
): Promise<QuickBooksSyncRun> {
  const preview = await previewQuickBooksSync(prisma, input.companyId);
  const errors: string[] = [];
  const pushed = { invoices: 0, payments: 0, expenses: 0 };
  let skipped = 0;

  if (!input.push || !preview.syncActivated) {
    return { preview, pushed, skipped: preview.invoicesEligible + preview.paymentsEligible + preview.expensesEligible, errors, activated: preview.syncActivated };
  }

  const loaded = await loadQuickBooksTransport(input.companyId);
  if (!loaded.ok) {
    return { preview, pushed, skipped: 0, errors: [loaded.error], activated: preview.syncActivated };
  }

  const settings = await prisma.quickBooksSettings.findUnique({ where: { companyId: input.companyId } });
  const invoices = await prisma.invoice.findMany({
    where: { companyId: input.companyId, status: { notIn: ["DRAFT", "VOID"] } },
    select: { id: true, issueDate: true, importMode: true },
    take: 50,
  });
  for (const invoice of invoices) {
    const gate = isEligibleForBulkSync({
      importMode: invoice.importMode,
      recordDate: invoice.issueDate,
      syncActivated: Boolean(settings?.syncActivated),
      syncStartDate: settings?.syncStartDate,
    });
    if (!gate.allowed) {
      skipped += 1;
      continue;
    }
    const existing = await prisma.quickBooksMapping.findFirst({
      where: { companyId: input.companyId, entityType: ENTITY_INVOICE, internalId: invoice.id, status: "SYNCED" },
    });
    if (existing) continue;
    const result = await syncInvoiceToQuickBooks(prisma, loaded.transport, {
      companyId: input.companyId,
      invoiceId: invoice.id,
      actorId: input.actorId,
    });
    if (result.ok) pushed.invoices += 1;
    else {
      skipped += 1;
      if (result.error) errors.push(result.error);
    }
  }

  const payments = await prisma.payment.findMany({
    where: { companyId: input.companyId, status: { in: ["CONFIRMED", "SUCCEEDED", "RECORDED", "PARTIALLY_REFUNDED"] } },
    select: { id: true, paidAt: true, importMode: true },
    take: 50,
  });
  for (const payment of payments) {
    const gate = isEligibleForBulkSync({
      importMode: payment.importMode,
      recordDate: payment.paidAt,
      syncActivated: Boolean(settings?.syncActivated),
      syncStartDate: settings?.syncStartDate,
    });
    if (!gate.allowed) {
      skipped += 1;
      continue;
    }
    const existing = await prisma.quickBooksMapping.findFirst({
      where: { companyId: input.companyId, entityType: ENTITY_PAYMENT, internalId: payment.id, status: "SYNCED" },
    });
    if (existing) continue;
    const result = await syncPaymentToQuickBooks(prisma, loaded.transport, {
      companyId: input.companyId,
      paymentId: payment.id,
    });
    if (result.ok) pushed.payments += 1;
    else {
      skipped += 1;
      if (result.error) errors.push(result.error);
    }
  }

  const expenses = await prisma.expense.findMany({
    where: { companyId: input.companyId, status: "APPROVED" },
    select: { id: true, date: true, importMode: true },
    take: 50,
  });
  for (const expense of expenses) {
    const gate = isEligibleForBulkSync({
      importMode: expense.importMode,
      recordDate: expense.date,
      syncActivated: Boolean(settings?.syncActivated),
      syncStartDate: settings?.syncStartDate,
    });
    if (!gate.allowed) {
      skipped += 1;
      continue;
    }
    const result = await syncExpenseToQuickBooks(prisma, loaded.transport, {
      companyId: input.companyId,
      expenseId: expense.id,
    });
    if (result.ok) pushed.expenses += 1;
    else {
      skipped += 1;
      if (result.error) errors.push(result.error);
    }
  }

  await prisma.integrationConnection.updateMany({
    where: { companyId: input.companyId, providerKey: QUICKBOOKS_PROVIDER_KEY },
    data: {
      lastSyncAt: new Date(),
      lastAttemptAt: new Date(),
      healthMessage: input.push ? "Manual sync finished." : "Preview only. Automatic sync is not active.",
    },
  });

  return {
    preview: await previewQuickBooksSync(prisma, input.companyId),
    pushed,
    skipped,
    errors: [...new Set(errors)].slice(0, 8),
    activated: true,
  };
}
