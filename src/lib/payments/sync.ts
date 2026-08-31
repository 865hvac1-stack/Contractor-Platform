import type { PrismaClient } from "@prisma/client";
import { getConnectAccount } from "@/lib/payments/connect";
import { recordConfirmedProviderPayment } from "@/lib/payments/record";
import { requireStripe } from "@/lib/payments/stripe-client";

const OPEN_STRIPE_STATUSES = ["PROCESSING", "PENDING"];

export async function invoiceForStripeIntent(
  prisma: PrismaClient,
  input: {
    providerPaymentId: string;
    metadataCompanyId?: string;
    metadataInvoiceId?: string;
    stripeAccountId?: string;
  }
) {
  const existing = await prisma.payment.findFirst({
    where: { provider: "STRIPE", providerPaymentId: input.providerPaymentId },
  });
  if (existing) {
    if (input.stripeAccountId && existing.stripeAccountId && existing.stripeAccountId !== input.stripeAccountId) {
      return null;
    }
    const invoice = await prisma.invoice.findFirst({
      where: { id: existing.invoiceId, companyId: existing.companyId },
    });
    if (!invoice) return null;
    if (input.metadataCompanyId && input.metadataCompanyId !== invoice.companyId) return null;
    if (input.metadataInvoiceId && input.metadataInvoiceId !== invoice.id) return null;
    if (input.stripeAccountId) {
      const owner = await prisma.stripeConnectAccount.findUnique({
        where: { stripeAccountId: input.stripeAccountId },
      });
      if (owner && owner.companyId !== invoice.companyId) return null;
    }
    return invoice;
  }

  if (!input.metadataInvoiceId) return null;
  const invoice = await prisma.invoice.findFirst({ where: { id: input.metadataInvoiceId } });
  if (!invoice) return null;
  if (input.metadataCompanyId && input.metadataCompanyId !== invoice.companyId) return null;
  if (input.stripeAccountId) {
    const owner = await prisma.stripeConnectAccount.findUnique({
      where: { stripeAccountId: input.stripeAccountId },
    });
    if (!owner || owner.companyId !== invoice.companyId) return null;
  }
  return invoice;
}

export async function confirmStripeIntentPayment(
  prisma: PrismaClient,
  input: {
    providerPaymentId: string;
    amountCents: number;
    metadata?: Record<string, string>;
    paymentMethodTypes?: string[];
    stripeAccountId?: string;
  }
) {
  const invoice = await invoiceForStripeIntent(prisma, {
    providerPaymentId: input.providerPaymentId,
    metadataCompanyId: input.metadata?.companyId,
    metadataInvoiceId: input.metadata?.invoiceId,
    stripeAccountId: input.stripeAccountId,
  });
  if (!invoice) return { ok: false as const, reason: "unmapped" as const, created: false, payment: null };
  const method =
    input.paymentMethodTypes?.includes("us_bank_account") && !input.paymentMethodTypes.includes("card")
      ? "ACH"
      : "CREDIT_CARD";
  const result = await recordConfirmedProviderPayment({
    prisma,
    companyId: invoice.companyId,
    invoiceId: invoice.id,
    amountCents: input.amountCents,
    provider: "STRIPE",
    providerPaymentId: input.providerPaymentId,
    method,
    notes: "Stripe payment confirmed",
    stripeAccountId: input.stripeAccountId,
    status: "SUCCEEDED",
  });
  return { ok: true as const, ...result };
}

export async function syncStripePaymentFromProvider(
  prisma: PrismaClient,
  payment: {
    id: string;
    companyId: string;
    invoiceId: string;
    providerPaymentId: string | null;
    stripeAccountId: string | null;
    status: string;
  }
) {
  if (!payment.providerPaymentId) return { ok: false as const };
  const stripeAccountId =
    payment.stripeAccountId || (await getConnectAccount(prisma, payment.companyId))?.stripeAccountId;
  if (!stripeAccountId) return { ok: false as const };
  const stripe = requireStripe();
  const intent = await stripe.paymentIntents.retrieve(payment.providerPaymentId, undefined, {
    stripeAccount: stripeAccountId,
  });
  if (intent.status === "succeeded") {
    return confirmStripeIntentPayment(prisma, {
      providerPaymentId: intent.id,
      amountCents: intent.amount_received || intent.amount,
      metadata: (intent.metadata ?? {}) as Record<string, string>,
      paymentMethodTypes: intent.payment_method_types,
      stripeAccountId,
    });
  }
  if (intent.status === "canceled") {
    if (OPEN_STRIPE_STATUSES.includes(payment.status)) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "CANCELED" },
      });
    }
  }
  return { ok: true as const, created: false, payment };
}

export async function syncOpenStripePaymentsForInvoice(
  prisma: PrismaClient,
  companyId: string,
  invoiceId: string
) {
  const open = await prisma.payment.findMany({
    where: {
      companyId,
      invoiceId,
      provider: "STRIPE",
      status: { in: OPEN_STRIPE_STATUSES },
      providerPaymentId: { not: null },
    },
  });
  for (const payment of open) {
    try {
      await syncStripePaymentFromProvider(prisma, payment);
    } catch {
      // Stripe retrieve can fail; invoice page still renders the last stored state.
    }
  }
}

export function invoicePaymentSnapshot(invoice: {
  status: string;
  amountPaidCents: number;
  balanceCents: number;
  totalCents: number;
  invoiceNumber?: string;
}) {
  return {
    invoiceStatus: invoice.status,
    amountPaidCents: invoice.amountPaidCents,
    balanceCents: invoice.balanceCents,
    totalCents: invoice.totalCents,
    invoiceNumber: invoice.invoiceNumber,
  };
}

export async function loadAuthoritativeInvoice(
  prisma: PrismaClient,
  companyId: string,
  invoiceId: string
) {
  await syncOpenStripePaymentsForInvoice(prisma, companyId, invoiceId);
  return prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
  });
}

export async function loadAuthoritativePublicInvoice(prisma: PrismaClient, token: string) {
  const invoice = await prisma.invoice.findFirst({ where: { publicToken: token } });
  if (!invoice) return null;
  await syncOpenStripePaymentsForInvoice(prisma, invoice.companyId, invoice.id);
  return prisma.invoice.findFirst({ where: { id: invoice.id, companyId: invoice.companyId } });
}
