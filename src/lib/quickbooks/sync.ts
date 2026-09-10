import type { PrismaClient, QuickBooksInvoiceTrigger } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";
import { lineTotalCents } from "@/lib/money";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import {
  qboCreateCustomer,
  qboCreateOrUpdateInvoice,
  qboCreatePayment,
  qboCreatePurchase,
  qboGetInvoice,
  qboSearchCustomers,
  type QboTransport,
} from "@/lib/quickbooks/client";
import { decideCustomerMatch } from "@/lib/quickbooks/match";
import { humanQuickBooksError } from "@/lib/quickbooks/errors";

export function canAutoSyncInvoice(input: {
  trigger: QuickBooksInvoiceTrigger;
  event: "created" | "sent" | "job_completed" | "payment_received" | "manual";
  importMode?: string | null;
}): { allowed: boolean; reason: string } {
  if (isHistoricalImport(input.importMode)) {
    return { allowed: false, reason: "Historical imported invoices do not sync unless you choose Sync to QuickBooks." };
  }
  if (input.event === "manual") return { allowed: true, reason: "Manual sync" };
  if (input.trigger === "MANUAL_ONLY") {
    return { allowed: false, reason: "This company only syncs invoices when someone presses Sync to QuickBooks." };
  }
  if (input.trigger === "WHEN_CREATED" && input.event === "created") return { allowed: true, reason: "Created" };
  if (input.trigger === "WHEN_SENT" && input.event === "sent") return { allowed: true, reason: "Sent" };
  if (input.trigger === "WHEN_JOB_COMPLETED" && input.event === "job_completed") return { allowed: true, reason: "Job completed" };
  if (input.trigger === "WHEN_PAYMENT_RECEIVED" && input.event === "payment_received") {
    return { allowed: true, reason: "Payment received" };
  }
  return { allowed: false, reason: "This invoice does not match the company’s QuickBooks setting." };
}

async function recordEvent(
  prisma: PrismaClient,
  input: {
    companyId: string;
    entityType: string;
    internalId?: string | null;
    quickbooksId?: string | null;
    status: "SYNCED" | "FAILED" | "NEEDS_REVIEW" | "REAUTH_REQUIRED";
    action: string;
    errorMessage?: string | null;
  }
) {
  await prisma.quickBooksSyncEvent.create({
    data: {
      companyId: input.companyId,
      entityType: input.entityType,
      internalId: input.internalId ?? null,
      quickbooksId: input.quickbooksId ?? null,
      status: input.status,
      action: input.action,
      errorMessage: input.errorMessage ?? null,
    },
  });
}

export function isEligibleForBulkSync(input: {
  importMode?: string | null;
  recordDate: Date;
  syncActivated: boolean;
  syncStartDate?: Date | null;
}): { allowed: boolean; reason: string } {
  if (!input.syncActivated) {
    return { allowed: false, reason: "QuickBooks is in safe mode. Finish the setup wizard before automatic sync." };
  }
  if (isHistoricalImport(input.importMode)) {
    return { allowed: false, reason: "Imported history stays in ContractorYou until you sync that record on purpose." };
  }
  if (input.syncStartDate && input.recordDate < input.syncStartDate) {
    return { allowed: false, reason: humanQuickBooksError({ missing: "date" }) };
  }
  return { allowed: true, reason: "Eligible" };
}

export async function upsertMapping(
  prisma: PrismaClient,
  input: { companyId: string; entityType: string; internalId: string; quickbooksId: string; syncToken?: string | null }
) {
  return prisma.quickBooksMapping.upsert({
    where: {
      companyId_entityType_internalId: {
        companyId: input.companyId,
        entityType: input.entityType,
        internalId: input.internalId,
      },
    },
    create: {
      ...input,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      syncToken: input.syncToken ?? null,
    },
    update: {
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      syncToken: input.syncToken ?? undefined,
    },
  });
}

export async function resolveQuickBooksCustomer(
  prisma: PrismaClient,
  transport: QboTransport,
  input: {
    companyId: string;
    customer: {
      id: string;
      firstName: string;
      lastName: string;
      businessName: string | null;
      email: string | null;
      phone: string | null;
      externalId: string | null;
      sourceSystem: string | null;
    };
    mode?: "auto" | "manual";
  }
): Promise<{ quickbooksId: string; created: boolean } | { error: string; review?: boolean }> {
  const existing = await prisma.quickBooksMapping.findFirst({
    where: { companyId: input.companyId, entityType: "CUSTOMER", internalId: input.customer.id },
  });
  if (existing?.status === "NEEDS_REVIEW") {
    return { error: humanQuickBooksError({ missing: "customer" }), review: true };
  }
  if (existing?.quickbooksId && existing.status !== "FAILED") {
    return { quickbooksId: existing.quickbooksId, created: false };
  }
  if (input.customer.sourceSystem === QUICKBOOKS_PROVIDER_KEY && input.customer.externalId) {
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      internalId: input.customer.id,
      quickbooksId: input.customer.externalId,
    });
    return { quickbooksId: input.customer.externalId, created: false };
  }
  const display =
    input.customer.businessName || `${input.customer.firstName} ${input.customer.lastName}`.trim() || "Customer";
  const candidates = await qboSearchCustomers(transport, {
    displayName: display,
    email: input.customer.email,
  });
  const decision = decideCustomerMatch(input.customer, candidates, input.mode ?? "auto");
  if (decision.outcome === "LINKED") {
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      internalId: input.customer.id,
      quickbooksId: decision.quickbooksId,
    });
    return { quickbooksId: decision.quickbooksId, created: false };
  }
  if (decision.outcome === "NEEDS_REVIEW") {
    await prisma.quickBooksMapping.upsert({
      where: {
        companyId_entityType_internalId: {
          companyId: input.companyId,
          entityType: "CUSTOMER",
          internalId: input.customer.id,
        },
      },
      create: {
        companyId: input.companyId,
        entityType: "CUSTOMER",
        internalId: input.customer.id,
        quickbooksId: decision.candidates[0]?.id || "REVIEW",
        status: "NEEDS_REVIEW",
        lastSyncError: decision.reason,
        metadata: { candidates: decision.candidates.map((row) => ({ id: row.id, score: row.score })) },
      },
      update: {
        status: "NEEDS_REVIEW",
        lastSyncError: decision.reason,
        metadata: { candidates: decision.candidates.map((row) => ({ id: row.id, score: row.score })) },
      },
    });
    return { error: humanQuickBooksError({ missing: "customer" }), review: true };
  }
  if (decision.outcome === "CREATE") {
    const created = await qboCreateCustomer(transport, {
      displayName: display,
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
      email: input.customer.email,
      phone: input.customer.phone,
    });
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      internalId: input.customer.id,
      quickbooksId: created,
    });
    return { quickbooksId: created, created: true };
  }
  return { error: humanQuickBooksError({ missing: "customer" }), review: true };
}

async function resolveInvoiceItemId(prisma: PrismaClient, companyId: string, serviceTypeId?: string | null) {
  if (serviceTypeId) {
    const mapped = await prisma.quickBooksMapping.findFirst({
      where: { companyId, entityType: "SERVICE_ITEM", internalId: serviceTypeId, status: "SYNCED" },
    });
    if (mapped) return mapped.quickbooksId;
  }
  const fallback = await prisma.quickBooksMapping.findFirst({
    where: { companyId, entityType: "DEFAULT_ITEM", status: "SYNCED" },
  });
  return fallback?.quickbooksId ?? null;
}

export async function syncInvoiceToQuickBooks(
  prisma: PrismaClient,
  transport: QboTransport,
  input: { companyId: string; invoiceId: string; actorId: string }
): Promise<{ ok: boolean; quickbooksId?: string; error?: string }> {
  const { demoOutboundBlock } = await import("@/lib/demo/guard");
  const blocked = await demoOutboundBlock(input.companyId, prisma);
  if (blocked.blocked) return { ok: false, error: blocked.message };
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, companyId: input.companyId },
    include: { customer: true, job: true, lineItems: true },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  try {
    const itemId = await resolveInvoiceItemId(prisma, input.companyId, invoice.serviceTypeId);
    if (!itemId) {
      await recordEvent(prisma, {
        companyId: input.companyId,
        entityType: "INVOICE",
        internalId: invoice.id,
        status: "NEEDS_REVIEW",
        action: "invoice.sync",
        errorMessage: humanQuickBooksError({ missing: "item" }),
      });
      return { ok: false, error: humanQuickBooksError({ missing: "item" }) };
    }
    const customer = await resolveQuickBooksCustomer(prisma, transport, {
      companyId: input.companyId,
      customer: invoice.customer,
      mode: "manual",
    });
    if ("error" in customer) {
      await recordEvent(prisma, {
        companyId: input.companyId,
        entityType: "INVOICE",
        internalId: invoice.id,
        status: "NEEDS_REVIEW",
        action: "invoice.sync",
        errorMessage: customer.error,
      });
      return { ok: false, error: customer.error };
    }
    const existing = await prisma.quickBooksMapping.findFirst({
      where: { companyId: input.companyId, entityType: "INVOICE", internalId: invoice.id },
    });
    const qbId = await qboCreateOrUpdateInvoice(transport, {
      existingId: existing?.quickbooksId,
      customerId: customer.quickbooksId,
      docNumber: invoice.invoiceNumber,
      txnDate: invoice.issueDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      memo: invoice.job ? `ContractorYou job ${invoice.job.jobNumber}` : invoice.notes,
      lines: invoice.lineItems.map((line) => ({
        description: line.description || line.name,
        quantity: Number(line.quantity),
        unitPrice: line.unitPriceCents / 100,
        amount: lineTotalCents(Number(line.quantity), line.unitPriceCents) / 100,
        itemId,
      })),
    });
    const remote = await qboGetInvoice(transport, qbId);
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "INVOICE",
      internalId: invoice.id,
      quickbooksId: qbId,
      syncToken: remote?.syncToken,
    });
    await prisma.quickBooksMapping.update({
      where: {
        companyId_entityType_internalId: {
          companyId: input.companyId,
          entityType: "INVOICE",
          internalId: invoice.id,
        },
      },
      data: {
        metadata: {
          qboBalance: remote?.balance != null ? `$${Number(remote.balance).toFixed(2)}` : null,
          qboTotal: remote?.total ?? null,
        },
      },
    });
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "INVOICE",
      internalId: invoice.id,
      quickbooksId: qbId,
      status: "SYNCED",
      action: existing ? "invoice.update" : "invoice.create",
    });
    await prisma.integrationConnection.updateMany({
      where: { companyId: input.companyId, providerKey: QUICKBOOKS_PROVIDER_KEY },
      data: { lastSyncAt: new Date(), lastAttemptAt: new Date(), errorMessage: null, healthMessage: "Last invoice sync succeeded." },
    });
    return { ok: true, quickbooksId: qbId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks sync failed.";
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "INVOICE",
      internalId: invoice.id,
      status: "FAILED",
      action: "invoice.sync",
      errorMessage: message,
    });
    return { ok: false, error: "We could not sync that invoice to QuickBooks. Try again or reconnect." };
  }
}

export async function syncPaymentToQuickBooks(
  prisma: PrismaClient,
  transport: QboTransport,
  input: { companyId: string; paymentId: string }
): Promise<{ ok: boolean; quickbooksId?: string; error?: string; review?: boolean }> {
  const { demoOutboundBlock } = await import("@/lib/demo/guard");
  const blocked = await demoOutboundBlock(input.companyId, prisma);
  if (blocked.blocked) return { ok: false, error: blocked.message };
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, companyId: input.companyId },
    include: { invoice: { include: { customer: true } } },
  });
  if (!payment) return { ok: false, error: "Payment not found." };
  if (isHistoricalImport(payment.importMode)) {
    return { ok: false, error: "Historical imported payments do not sync automatically." };
  }
  const invoiceMap = await prisma.quickBooksMapping.findFirst({
    where: { companyId: input.companyId, entityType: "INVOICE", internalId: payment.invoiceId },
  });
  if (!invoiceMap) {
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "PAYMENT",
      internalId: payment.id,
      status: "NEEDS_REVIEW",
      action: "payment.sync",
      errorMessage: "Invoice is not in QuickBooks yet.",
    });
    return { ok: false, review: true, error: "Sync the invoice first, then we can record this payment in QuickBooks." };
  }
  const existing = await prisma.quickBooksMapping.findFirst({
    where: { companyId: input.companyId, entityType: "PAYMENT", internalId: payment.id },
  });
  if (existing) {
    return { ok: true, quickbooksId: existing.quickbooksId };
  }
  try {
    const customer = await resolveQuickBooksCustomer(prisma, transport, {
      companyId: input.companyId,
      customer: payment.invoice.customer,
      mode: "auto",
    });
    if ("error" in customer) {
      return { ok: false, review: true, error: customer.error };
    }
    const qbId = await qboCreatePayment(transport, {
      customerId: customer.quickbooksId,
      invoiceId: invoiceMap.quickbooksId,
      amount: payment.amountCents / 100,
      txnDate: payment.paidAt.toISOString().slice(0, 10),
      reference: payment.externalRef,
    });
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "PAYMENT",
      internalId: payment.id,
      quickbooksId: qbId,
    });
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "PAYMENT",
      internalId: payment.id,
      quickbooksId: qbId,
      status: "SYNCED",
      action: "payment.create",
    });
    return { ok: true, quickbooksId: qbId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment sync failed.";
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "PAYMENT",
      internalId: payment.id,
      status: "FAILED",
      action: "payment.sync",
      errorMessage: message,
    });
    return { ok: false, error: "We could not record that payment in QuickBooks." };
  }
}

export async function syncExpenseToQuickBooks(
  prisma: PrismaClient,
  transport: QboTransport,
  input: { companyId: string; expenseId: string }
): Promise<{ ok: boolean; quickbooksId?: string; error?: string; review?: boolean }> {
  const { demoOutboundBlock } = await import("@/lib/demo/guard");
  const blocked = await demoOutboundBlock(input.companyId, prisma);
  if (blocked.blocked) return { ok: false, error: blocked.message };
  const expense = await prisma.expense.findFirst({
    where: { id: input.expenseId, companyId: input.companyId },
  });
  if (!expense) return { ok: false, error: "Expense not found." };
  if (expense.status !== "APPROVED" && expense.status !== "POSTED") {
    return { ok: false, review: true, error: "Only approved expenses sync to QuickBooks." };
  }
  if (isHistoricalImport(expense.importMode)) {
    return { ok: false, error: "Historical imported expenses do not sync automatically." };
  }
  const existing = await prisma.quickBooksMapping.findFirst({
    where: { companyId: input.companyId, entityType: "EXPENSE", internalId: expense.id },
  });
  if (existing?.quickbooksId && existing.status === "SYNCED") {
    return { ok: true, quickbooksId: existing.quickbooksId };
  }
  const account = await prisma.quickBooksMapping.findFirst({
    where: {
      companyId: input.companyId,
      entityType: "EXPENSE_ACCOUNT",
      status: "SYNCED",
      OR: [{ internalId: expense.category }, { internalId: "default" }],
    },
    orderBy: { internalId: "desc" },
  });
  if (!account) {
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "EXPENSE",
      internalId: expense.id,
      status: "NEEDS_REVIEW",
      action: "expense.sync",
      errorMessage: humanQuickBooksError({ missing: "account" }),
    });
    return { ok: false, review: true, error: humanQuickBooksError({ missing: "account" }) };
  }
  try {
    const qbId = await qboCreatePurchase(transport, {
      amount: expense.amountCents / 100,
      txnDate: expense.date.toISOString().slice(0, 10),
      accountId: account.quickbooksId,
      memo: expense.description,
      vendor: expense.vendor,
    });
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "EXPENSE",
      internalId: expense.id,
      quickbooksId: qbId,
    });
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "EXPENSE",
      internalId: expense.id,
      quickbooksId: qbId,
      status: "SYNCED",
      action: "expense.create",
    });
    return { ok: true, quickbooksId: qbId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Expense sync failed.";
    await recordEvent(prisma, {
      companyId: input.companyId,
      entityType: "EXPENSE",
      internalId: expense.id,
      status: "FAILED",
      action: "expense.sync",
      errorMessage: message,
    });
    return { ok: false, error: "We could not post that expense to QuickBooks." };
  }
}
