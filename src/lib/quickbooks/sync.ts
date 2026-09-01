import type { PrismaClient, QuickBooksInvoiceTrigger } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";
import { lineTotalCents } from "@/lib/money";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import {
  qboCreateCustomer,
  qboCreateOrUpdateInvoice,
  qboCreatePayment,
  qboFindCustomer,
  type QboTransport,
} from "@/lib/quickbooks/client";

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

export async function upsertMapping(
  prisma: PrismaClient,
  input: { companyId: string; entityType: string; internalId: string; quickbooksId: string }
) {
  return prisma.quickBooksMapping.upsert({
    where: {
      companyId_entityType_internalId: {
        companyId: input.companyId,
        entityType: input.entityType,
        internalId: input.internalId,
      },
    },
    create: { ...input, status: "SYNCED", lastSyncedAt: new Date() },
    update: { quickbooksId: input.quickbooksId, status: "SYNCED", lastSyncedAt: new Date() },
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
  }
): Promise<{ quickbooksId: string; created: boolean }> {
  const existing = await prisma.quickBooksMapping.findFirst({
    where: { companyId: input.companyId, entityType: "CUSTOMER", internalId: input.customer.id },
  });
  if (existing) return { quickbooksId: existing.quickbooksId, created: false };
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
  const found = await qboFindCustomer(transport, display);
  if (found) {
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      internalId: input.customer.id,
      quickbooksId: found,
    });
    return { quickbooksId: found, created: false };
  }
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
    const customer = await resolveQuickBooksCustomer(prisma, transport, {
      companyId: input.companyId,
      customer: invoice.customer,
    });
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
      })),
    });
    await upsertMapping(prisma, {
      companyId: input.companyId,
      entityType: "INVOICE",
      internalId: invoice.id,
      quickbooksId: qbId,
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
    });
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
