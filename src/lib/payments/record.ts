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

const COUNTS_AS_COLLECTED = new Set(["CONFIRMED", "SUCCEEDED", "RECORDED", "PARTIALLY_REFUNDED"]);

export function collectedAmountCents(payment: { status: string; amountCents: number; refundedCents?: number | null }) {
  if (!COUNTS_AS_COLLECTED.has(payment.status) && payment.status !== "REFUNDED") return 0;
  return Math.max(0, payment.amountCents - (payment.refundedCents ?? 0));
}

export async function reconcileInvoiceFromPayments(
  prisma: PrismaClient,
  invoiceId: string,
  companyId: string
) {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!invoice) return null;
  const payments = await prisma.payment.findMany({
    where: { invoiceId, companyId, importMode: invoice.importMode },
  });
  const amountPaidCents = payments.reduce((sum, payment) => sum + collectedAmountCents(payment), 0);
  const balanceCents = Math.max(0, invoice.totalCents - amountPaidCents);
  let status: InvoiceStatus = invoice.status;
  if (invoice.status === "VOID") status = "VOID";
  else if (amountPaidCents <= 0 && invoice.status !== "DRAFT") status = invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID" ? "SENT" : invoice.status;
  else if (balanceCents === 0) status = "PAID";
  else if (amountPaidCents > 0) status = "PARTIALLY_PAID";
  return prisma.invoice.update({
    where: { id: invoice.id },
    data: { amountPaidCents, balanceCents, status },
  });
}

export async function applyPaymentToInvoice(input: {
  prisma: PrismaClient;
  invoice: { id: string; companyId: string; totalCents: number; amountPaidCents: number; status: InvoiceStatus };
  amountCents: number;
}) {
  return reconcileInvoiceFromPayments(input.prisma, input.invoice.id, input.invoice.companyId);
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
  stripeAccountId?: string | null;
  /** Stripe card/ACH success uses SUCCEEDED. Manual recorded payments stay RECORDED. */
  status?: string;
}) {
  const invoice = await input.prisma.invoice.findFirst({
    where: { id: input.invoiceId, companyId: input.companyId },
  });
  if (!invoice) return { created: false as const, payment: null, error: "Invoice not found." };
  if (isHistoricalImport(invoice.importMode)) {
    return { created: false as const, payment: null, error: "Imported historical invoices cannot be charged." };
  }

  const existing = await input.prisma.payment.findFirst({
    where: {
      companyId: input.companyId,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
    },
  });
  if (existing && COUNTS_AS_COLLECTED.has(existing.status)) {
    return { created: false as const, payment: existing };
  }

  const status = input.status ?? "SUCCEEDED";

  try {
    const payment = existing
      ? await input.prisma.payment.update({
          where: { id: existing.id },
          data: {
            status,
            amountCents: input.amountCents,
            method: input.method,
            notes: input.notes ?? existing.notes,
            stripeAccountId: input.stripeAccountId ?? existing.stripeAccountId,
            paidAt: new Date(),
          },
        })
      : await input.prisma.payment.create({
          data: {
            companyId: input.companyId,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            jobId: invoice.jobId,
            amountCents: input.amountCents,
            method: input.method,
            status,
            provider: input.provider,
            providerPaymentId: input.providerPaymentId,
            notes: input.notes ?? null,
            stripeAccountId: input.stripeAccountId ?? null,
            importMode: invoice.importMode,
            paidAt: new Date(),
          },
        });
    const firstSuccess = !existing || !COUNTS_AS_COLLECTED.has(existing.status);
    await reconcileInvoiceFromPayments(input.prisma, invoice.id, input.companyId);
    if (firstSuccess) {
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
    }
    return { created: firstSuccess, payment };
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
