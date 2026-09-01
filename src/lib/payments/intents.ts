import type { PrismaClient } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";
import { platformFeeBps, stripePublishableKey } from "@/lib/payments/config";
import { getConnectAccount } from "@/lib/payments/connect";
import { requireStripe } from "@/lib/payments/stripe-client";
import { demoOutboundBlock } from "@/lib/demo/guard";

/** Server-side destination only. Browser never chooses company, amount, or Stripe account. */
export async function resolveInvoicePaymentDestination(
  prisma: PrismaClient,
  input: { companyId: string; invoiceId: string }
) {
  const blocked = await demoOutboundBlock(input.companyId, prisma);
  if (blocked.blocked) return { ok: false as const, error: blocked.message };
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, companyId: input.companyId },
  });
  if (!invoice) return { ok: false as const, error: "Invoice not found." };
  if (isHistoricalImport(invoice.importMode)) {
    return { ok: false as const, error: "Imported historical invoices cannot be charged." };
  }
  if (invoice.status === "VOID") return { ok: false as const, error: "This invoice is void." };
  if (invoice.balanceCents <= 0) return { ok: false as const, error: "This invoice has no balance due." };

  const account = await getConnectAccount(prisma, invoice.companyId);
  if (!account || account.disabledAt) {
    return { ok: false as const, error: "Payments are not set up for this company." };
  }
  if (!account.chargesEnabled) {
    return { ok: false as const, error: "Card payments are not enabled yet. Complete payment setup." };
  }
  return {
    ok: true as const,
    companyId: invoice.companyId,
    invoiceId: invoice.id,
    stripeAccountId: account.stripeAccountId,
    amountCents: invoice.balanceCents,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    jobId: invoice.jobId,
    importMode: invoice.importMode,
  };
}

export async function createInvoicePaymentIntent(
  prisma: PrismaClient,
  input: {
    companyId: string;
    invoiceId: string;
    actorId?: string | null;
  }
) {
  const destination = await resolveInvoicePaymentDestination(prisma, input);
  if (!destination.ok) return destination;

  const amountCents = destination.amountCents;
  const existing = await prisma.payment.findFirst({
    where: {
      companyId: destination.companyId,
      invoiceId: destination.invoiceId,
      provider: "STRIPE",
      status: "PROCESSING",
      amountCents,
    },
    orderBy: { createdAt: "desc" },
  });
  const stripe = requireStripe();
  if (existing?.providerPaymentId) {
    try {
      const prior = await stripe.paymentIntents.retrieve(
        existing.providerPaymentId,
        undefined,
        { stripeAccount: destination.stripeAccountId }
      );
      if (
        prior.client_secret &&
        (prior.status === "requires_payment_method" ||
          prior.status === "requires_confirmation" ||
          prior.status === "requires_action")
      ) {
        const publishable = stripePublishableKey();
        if (!publishable) {
          return { ok: false as const, error: "Card payments are not configured (missing publishable key)." };
        }
        return {
          ok: true as const,
          clientSecret: prior.client_secret,
          publishableKey: publishable,
          stripeAccountId: destination.stripeAccountId,
          amountCents,
          invoiceNumber: destination.invoiceNumber,
        };
      }
    } catch {
      // Create a new intent if the prior one cannot be reused.
    }
  }

  const feeBps = platformFeeBps();
  const applicationFee = feeBps > 0 ? Math.round((amountCents * feeBps) / 10_000) : 0;
  const intent = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        companyId: destination.companyId,
        invoiceId: destination.invoiceId,
        invoiceNumber: destination.invoiceNumber,
      },
      ...(applicationFee > 0 ? { application_fee_amount: applicationFee } : {}),
    },
    { stripeAccount: destination.stripeAccountId }
  );

  await prisma.payment.create({
    data: {
      companyId: destination.companyId,
      invoiceId: destination.invoiceId,
      customerId: destination.customerId,
      jobId: destination.jobId,
      amountCents,
      method: "CREDIT_CARD",
      status: "PROCESSING",
      provider: "STRIPE",
      providerPaymentId: intent.id,
      recordedById: input.actorId ?? null,
      stripeAccountId: destination.stripeAccountId,
      currency: "usd",
      importMode: destination.importMode,
      notes: "Stripe PaymentIntent created",
    },
  });

  const publishable = stripePublishableKey();
  if (!publishable) {
    return { ok: false as const, error: "Card payments are not configured (missing publishable key)." };
  }
  if (!intent.client_secret) {
    return { ok: false as const, error: "Stripe did not return a client secret." };
  }

  return {
    ok: true as const,
    clientSecret: intent.client_secret,
    publishableKey: publishable,
    stripeAccountId: destination.stripeAccountId,
    amountCents,
    invoiceNumber: destination.invoiceNumber,
  };
}
