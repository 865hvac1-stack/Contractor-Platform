import type { PrismaClient } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";
import { platformFeeBps, stripePublishableKey } from "@/lib/payments/config";
import { getConnectAccount } from "@/lib/payments/connect";
import { requireStripe } from "@/lib/payments/stripe-client";

export async function createInvoicePaymentIntent(
  prisma: PrismaClient,
  input: {
    companyId: string;
    invoiceId: string;
    actorId?: string | null;
  }
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, companyId: input.companyId },
  });
  if (!invoice) return { ok: false as const, error: "Invoice not found." };
  if (isHistoricalImport(invoice.importMode)) {
    return { ok: false as const, error: "Imported historical invoices cannot be charged." };
  }
  if (invoice.status === "VOID") return { ok: false as const, error: "This invoice is void." };
  if (invoice.balanceCents <= 0) return { ok: false as const, error: "This invoice has no balance due." };

  const account = await getConnectAccount(prisma, input.companyId);
  if (!account || account.disabledAt) {
    return { ok: false as const, error: "Payments are not set up for this company." };
  }
  if (!account.chargesEnabled) {
    return { ok: false as const, error: "Card payments are not enabled yet. Complete payment setup." };
  }

  const amountCents = invoice.balanceCents;
  const existing = await prisma.payment.findFirst({
    where: {
      companyId: invoice.companyId,
      invoiceId: invoice.id,
      provider: "STRIPE",
      status: "PROCESSING",
      amountCents,
    },
    orderBy: { createdAt: "desc" },
  });
  const stripe = requireStripe();
  if (existing?.providerPaymentId) {
    try {
      const prior = await stripe.paymentIntents.retrieve(existing.providerPaymentId, {
        stripeAccount: account.stripeAccountId,
      });
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
          stripeAccountId: account.stripeAccountId,
          amountCents,
          invoiceNumber: invoice.invoiceNumber,
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
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      },
      ...(applicationFee > 0 ? { application_fee_amount: applicationFee } : {}),
    },
    { stripeAccount: account.stripeAccountId }
  );

  await prisma.payment.create({
    data: {
      companyId: invoice.companyId,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      jobId: invoice.jobId,
      amountCents,
      method: "CREDIT_CARD",
      status: "PROCESSING",
      provider: "STRIPE",
      providerPaymentId: intent.id,
      recordedById: input.actorId ?? null,
      stripeAccountId: account.stripeAccountId,
      currency: "usd",
      importMode: invoice.importMode,
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
    stripeAccountId: account.stripeAccountId,
    amountCents,
    invoiceNumber: invoice.invoiceNumber,
  };
}
