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
import {
  evaluateInvoiceEligibility,
  evaluatePaymentEligibility,
  hasValidQuickBooksMapping,
  mappingKey,
  QBO_PAYMENT_SUCCESS_STATUSES,
  type QboMappingSnapshot,
} from "@/lib/quickbooks/eligibility";
import type { QboTransport } from "@/lib/quickbooks/client";

export type QuickBooksSyncRun = {
  preview: QuickBooksPreview;
  pushed: { invoices: number; payments: number; expenses: number };
  skipped: number;
  errors: string[];
  activated: boolean;
};

export async function syncPaymentWithInvoiceDependency(
  prisma: PrismaClient,
  transport: QboTransport,
  input: {
    companyId: string;
    actorId: string;
    paymentId: string;
    invoiceId: string;
    invoiceCanSyncAsDependency: boolean;
    invoiceHasValidMapping: boolean;
  }
): Promise<{ ok: boolean; pushedInvoice: boolean; pushedPayment: boolean; error?: string; skipped?: boolean }> {
  let invoiceHasValidMapping = input.invoiceHasValidMapping;
  let pushedInvoice = false;

  if (!invoiceHasValidMapping && !input.invoiceCanSyncAsDependency) {
    return { ok: false, pushedInvoice: false, pushedPayment: false, skipped: true };
  }

  if (!invoiceHasValidMapping && input.invoiceCanSyncAsDependency) {
    const invoiceResult = await syncInvoiceToQuickBooks(prisma, transport, {
      companyId: input.companyId,
      invoiceId: input.invoiceId,
      actorId: input.actorId,
    });
    if (!invoiceResult.ok) {
      return { ok: false, pushedInvoice: false, pushedPayment: false, error: invoiceResult.error };
    }
    pushedInvoice = true;
    invoiceHasValidMapping = true;
  }

  const paymentResult = await syncPaymentToQuickBooks(prisma, transport, {
    companyId: input.companyId,
    paymentId: input.paymentId,
  });
  if (!paymentResult.ok) {
    return { ok: false, pushedInvoice, pushedPayment: false, error: paymentResult.error };
  }
  return { ok: true, pushedInvoice, pushedPayment: true };
}

export async function runQuickBooksSync(
  prisma: PrismaClient,
  input: { companyId: string; actorId: string; push: boolean }
): Promise<QuickBooksSyncRun> {
  const preview = await previewQuickBooksSync(prisma, input.companyId);
  const errors: string[] = [];
  const pushed = { invoices: 0, payments: 0, expenses: 0 };
  let skipped = 0;

  if (!input.push || !preview.syncActivated) {
    return {
      preview,
      pushed,
      skipped: preview.invoicesEligible + preview.paymentsEligible + preview.expensesEligible,
      errors,
      activated: preview.syncActivated,
    };
  }

  const loaded = await loadQuickBooksTransport(input.companyId);
  if (!loaded.ok) {
    return { preview, pushed, skipped: 0, errors: [loaded.error], activated: preview.syncActivated };
  }

  const settings = await prisma.quickBooksSettings.findUnique({ where: { companyId: input.companyId } });
  const mappings = await prisma.quickBooksMapping.findMany({
    where: { companyId: input.companyId, entityType: { in: [ENTITY_INVOICE, ENTITY_PAYMENT] } },
    select: { entityType: true, internalId: true, status: true, quickbooksId: true },
  });
  const map = new Map<string, QboMappingSnapshot>(
    mappings.map((row) => [mappingKey(row.entityType, row.internalId), row])
  );

  const invoices = await prisma.invoice.findMany({
    where: { companyId: input.companyId, status: { notIn: ["DRAFT", "VOID"] } },
    select: { id: true, invoiceNumber: true, status: true, issueDate: true, importMode: true, totalCents: true },
  });
  for (const invoice of invoices) {
    const eligibility = evaluateInvoiceEligibility(invoice, {
      syncStartDate: settings?.syncStartDate,
      mapping: map.get(mappingKey(ENTITY_INVOICE, invoice.id)),
    });
    if (eligibility.hasValidMapping) continue;
    if (!eligibility.canSyncAsDependency) {
      skipped += 1;
      continue;
    }
    const result = await syncInvoiceToQuickBooks(prisma, loaded.transport, {
      companyId: input.companyId,
      invoiceId: invoice.id,
      actorId: input.actorId,
    });
    if (result.ok) {
      pushed.invoices += 1;
      if (result.quickbooksId) {
        map.set(mappingKey(ENTITY_INVOICE, invoice.id), {
          entityType: ENTITY_INVOICE,
          internalId: invoice.id,
          quickbooksId: result.quickbooksId,
          status: "SYNCED",
        });
      }
    } else {
      skipped += 1;
      if (result.error) errors.push(result.error);
    }
  }

  const payments = await prisma.payment.findMany({
    where: { companyId: input.companyId, status: { in: [...QBO_PAYMENT_SUCCESS_STATUSES] } },
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
  });
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const paymentsByInvoice = new Map<string, typeof payments>();
  for (const payment of payments) {
    const list = paymentsByInvoice.get(payment.invoiceId) ?? [];
    list.push(payment);
    paymentsByInvoice.set(payment.invoiceId, list);
  }
  const syncedPaymentIds = [...map.values()]
    .filter((row) => row.entityType === ENTITY_PAYMENT && hasValidQuickBooksMapping(row))
    .map((row) => row.internalId);

  for (const payment of payments) {
    const invoice = invoicesById.get(payment.invoiceId) ?? null;
    const invoiceEligibility = invoice
      ? evaluateInvoiceEligibility(invoice, {
          syncStartDate: settings?.syncStartDate,
          mapping: map.get(mappingKey(ENTITY_INVOICE, invoice.id)),
        })
      : null;
    const eligibility = evaluatePaymentEligibility({
      payment,
      invoice,
      siblingPayments: paymentsByInvoice.get(payment.invoiceId) ?? [payment],
      paymentMapping: map.get(mappingKey(ENTITY_PAYMENT, payment.id)),
      invoiceMapping: invoice ? map.get(mappingKey(ENTITY_INVOICE, invoice.id)) : null,
      syncedPaymentIds,
      syncStartDate: settings?.syncStartDate,
    });
    if (!eligibility.canAutoSync || !invoice || !invoiceEligibility) {
      skipped += 1;
      continue;
    }
    const result = await syncPaymentWithInvoiceDependency(prisma, loaded.transport, {
      companyId: input.companyId,
      actorId: input.actorId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      invoiceCanSyncAsDependency: invoiceEligibility.canSyncAsDependency,
      invoiceHasValidMapping: invoiceEligibility.hasValidMapping,
    });
    if (result.pushedInvoice) pushed.invoices += 1;
    if (result.pushedPayment) {
      pushed.payments += 1;
      syncedPaymentIds.push(payment.id);
    } else {
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
