import { Prisma, type InvoiceStatus, type PaymentMethod, type PrismaClient } from "@prisma/client";
import { applyCompensation } from "@/lib/compensation/apply";
import { attributionUserIds } from "@/lib/compensation/attribute";
import { isHistoricalImport } from "@/lib/imports/safety";
import { maybeAutoSyncPayment, maybeAutoSyncInvoice } from "@/server/actions/quickbooks";

export async function applyInvoicePaidCompensation(input: {
  prisma: PrismaClient;
  companyId: string;
  invoice: {
    id: string;
    jobId: string | null;
    customerId: string;
    totalCents: number;
    importMode: string;
  };
}) {
  if (isHistoricalImport(input.invoice.importMode)) return [];
  const job = input.invoice.jobId
    ? await input.prisma.job.findFirst({
        where: { id: input.invoice.jobId, companyId: input.companyId },
        select: { jobType: true, estimate: { select: { createdById: true } } },
      })
    : null;
  const userIds = await attributionUserIds(input.prisma, {
    jobId: input.invoice.jobId,
    createdById: job?.estimate?.createdById,
  });
  const created: string[] = [];
  for (const userId of userIds) {
    created.push(
      ...(await applyCompensation({
        prisma: input.prisma,
        companyId: input.companyId,
        userId,
        trigger: "INVOICE_PAID",
        sourceType: "INVOICE",
        sourceId: input.invoice.id,
        saleCents: input.invoice.totalCents,
        jobId: input.invoice.jobId,
        customerId: input.invoice.customerId,
        importMode: input.invoice.importMode,
        jobType: job?.jobType,
      }))
    );
  }
  return created;
}

export async function applyPaymentToInvoice(input: {
  prisma: PrismaClient;
  invoice: { id: string; totalCents: number; amountPaidCents: number; status: InvoiceStatus };
  amountCents: number;
}) {
  const amountPaidCents = input.invoice.amountPaidCents + input.amountCents;
  const balanceCents = Math.max(0, input.invoice.totalCents - amountPaidCents);
  let status: InvoiceStatus = input.invoice.status;
  if (input.invoice.status === "VOID") status = "VOID";
  else if (balanceCents === 0) status = "PAID";
  else if (amountPaidCents > 0) status = "PARTIALLY_PAID";
  return input.prisma.invoice.update({
    where: { id: input.invoice.id },
    data: { amountPaidCents, balanceCents, status },
  });
}

export async function recordConfirmedProviderPayment(input: {
  prisma: PrismaClient;
  companyId: string;
  invoiceId: string;
  amountCents: number;
  provider: string;
  providerPaymentId: string;
  method: PaymentMethod;
  notes?: string | null;
}) {
  const existing = await input.prisma.payment.findFirst({
    where: {
      companyId: input.companyId,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
    },
  });
  if (existing) return { created: false as const, payment: existing };

  const invoice = await input.prisma.invoice.findFirst({
    where: { id: input.invoiceId, companyId: input.companyId },
  });
  if (!invoice) return { created: false as const, payment: null, error: "Invoice not found." };

  try {
    const payment = await input.prisma.payment.create({
      data: {
        companyId: input.companyId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        jobId: invoice.jobId,
        amountCents: input.amountCents,
        method: input.method,
        status: "CONFIRMED",
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
        notes: input.notes ?? null,
        importMode: invoice.importMode,
      },
    });
    await applyPaymentToInvoice({ prisma: input.prisma, invoice, amountCents: input.amountCents });
    await applyInvoicePaidCompensation({ prisma: input.prisma, companyId: input.companyId, invoice });
    await maybeAutoSyncInvoice({
      companyId: input.companyId,
      invoiceId: invoice.id,
      actorId: "payment-provider",
      event: "payment_received",
      importMode: invoice.importMode,
    });
    await maybeAutoSyncPayment({
      companyId: input.companyId,
      paymentId: payment.id,
      importMode: payment.importMode,
    });
    return { created: true as const, payment };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await input.prisma.payment.findFirst({
        where: {
          companyId: input.companyId,
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
        },
      });
      if (again) return { created: false as const, payment: again };
    }
    throw error;
  }
}
