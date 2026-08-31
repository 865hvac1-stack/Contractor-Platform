import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { refreshConnectAccount } from "@/lib/payments/connect";
import { recordConfirmedProviderPayment, reconcileInvoiceFromPayments } from "@/lib/payments/record";
import { sendPaymentReceiptEmail } from "@/lib/payments/receipt";
import { requireStripe, type Stripe } from "@/lib/payments/stripe-client";
import { stripeWebhookSecret } from "@/lib/payments/config";
import { emitPaymentAutomationEvent } from "@/lib/payments/events";

export function constructStripeEvent(raw: string, signature: string | null) {
  const secret = stripeWebhookSecret();
  if (!secret) return { ok: false as const, error: "Stripe webhook is not configured.", status: 503 };
  if (!signature) return { ok: false as const, error: "Invalid signature.", status: 401 };
  try {
    const event = requireStripe().webhooks.constructEvent(raw, signature, secret);
    return { ok: true as const, event };
  } catch {
    return { ok: false as const, error: "Invalid signature.", status: 401 };
  }
}

export async function processStripeEvent(prisma: PrismaClient, event: Stripe.Event) {
  const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
  if (existing) return { ok: true as const, duplicate: true };

  const connectedAccount =
    typeof event.account === "string" ? event.account : undefined;
  const company = connectedAccount
    ? await prisma.stripeConnectAccount.findUnique({ where: { stripeAccountId: connectedAccount } })
    : null;

  await prisma.stripeWebhookEvent.create({
    data: {
      id: event.id,
      eventType: event.type,
      companyId: company?.companyId ?? null,
    },
  });

  try {
  switch (event.type) {
    case "account.updated": {
      if (company) await refreshConnectAccount(prisma, company.companyId);
      break;
    }
    case "payment_intent.processing": {
      await markIntentStatus(prisma, event.data.object as Stripe.PaymentIntent, "PROCESSING", connectedAccount);
      break;
    }
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      await markIntentStatus(
        prisma,
        event.data.object as Stripe.PaymentIntent,
        event.type === "payment_intent.canceled" ? "CANCELED" : "FAILED",
        connectedAccount
      );
      break;
    }
    case "payment_intent.succeeded": {
      await confirmIntent(prisma, event.data.object as Stripe.PaymentIntent, connectedAccount);
      break;
    }
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata ?? {};
      if (metadata.companyId && metadata.invoiceId && session.payment_intent) {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
        await recordConfirmedProviderPayment({
          prisma,
          companyId: metadata.companyId,
          invoiceId: metadata.invoiceId,
          amountCents: session.amount_total ?? 0,
          provider: "STRIPE",
          providerPaymentId: pi,
          method: "CREDIT_CARD",
          notes: "Stripe Checkout confirmed",
          stripeAccountId: connectedAccount,
        });
      }
      break;
    }
    case "charge.refunded":
    case "refund.updated": {
      await applyRefundEvent(prisma, event, connectedAccount);
      break;
    }
    case "charge.dispute.created": {
      await markDispute(prisma, event.data.object as Stripe.Dispute, connectedAccount);
      break;
    }
    default:
      break;
  }
  } catch (error) {
    await prisma.stripeWebhookEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    throw error;
  }

  return { ok: true as const, duplicate: false };
}

async function confirmIntent(
  prisma: PrismaClient,
  intent: Stripe.PaymentIntent,
  stripeAccountId?: string
) {
  const metadata = intent.metadata ?? {};
  const companyId = metadata.companyId;
  const invoiceId = metadata.invoiceId;
  if (!companyId || !invoiceId) return;
  if (stripeAccountId) {
    const owner = await prisma.stripeConnectAccount.findUnique({ where: { stripeAccountId } });
    if (!owner || owner.companyId !== companyId) return;
  }
  const method = intent.payment_method_types?.includes("us_bank_account") && !intent.payment_method_types.includes("card")
    ? "ACH"
    : "CREDIT_CARD";
  const result = await recordConfirmedProviderPayment({
    prisma,
    companyId,
    invoiceId,
    amountCents: intent.amount_received || intent.amount,
    provider: "STRIPE",
    providerPaymentId: intent.id,
    method,
    notes: "Stripe PaymentIntent succeeded",
    stripeAccountId,
  });
  if (result.created && result.payment) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { company: true, customer: true },
    });
    if (invoice) {
      await sendPaymentReceiptEmail({
        to: invoice.customer.email,
        contractorName: invoice.company.businessName,
        customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`.trim(),
        invoiceNumber: invoice.invoiceNumber,
        amountCents: result.payment.amountCents,
        methodLabel: method === "ACH" ? "Bank payment" : "Card",
        reference: intent.id,
        paidAt: new Date(),
      });
    }
    await writeAudit({
      companyId,
      action: "payment.succeeded",
      entityType: "Payment",
      entityId: result.payment.id,
      metadata: { invoiceId, providerPaymentId: intent.id },
    });
    const invoiceAfter = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
    await emitPaymentAutomationEvent(prisma, { companyId, trigger: "PAYMENT_SUCCEEDED" });
    if (invoiceAfter?.status === "PAID") {
      await emitPaymentAutomationEvent(prisma, { companyId, trigger: "INVOICE_PAID" });
    } else if (invoiceAfter?.status === "PARTIALLY_PAID") {
      await emitPaymentAutomationEvent(prisma, { companyId, trigger: "PARTIAL_PAYMENT" });
    }
  }
}

async function markIntentStatus(
  prisma: PrismaClient,
  intent: Stripe.PaymentIntent,
  status: string,
  stripeAccountId?: string
) {
  const metadata = intent.metadata ?? {};
  if (!metadata.companyId) return;
  await prisma.payment.updateMany({
    where: {
      companyId: metadata.companyId,
      provider: "STRIPE",
      providerPaymentId: intent.id,
      status: { notIn: ["CONFIRMED", "SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] },
    },
    data: { status, stripeAccountId: stripeAccountId ?? undefined },
  });
  if (status === "FAILED") {
    await writeAudit({
      companyId: metadata.companyId,
      action: "payment.failed",
      entityType: "Invoice",
      entityId: metadata.invoiceId || intent.id,
      metadata: { providerPaymentId: intent.id },
    });
    await emitPaymentAutomationEvent(prisma, { companyId: metadata.companyId, trigger: "PAYMENT_FAILED" });
  }
}

async function applyRefundEvent(
  prisma: PrismaClient,
  event: Stripe.Event,
  stripeAccountId?: string
) {
  const object = event.data.object as { payment_intent?: string | { id?: string }; amount_refunded?: number; amount?: number };
  const paymentIntentId =
    typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id;
  if (!paymentIntentId) return;
  const payment = await prisma.payment.findFirst({
    where: { provider: "STRIPE", providerPaymentId: paymentIntentId },
  });
  if (!payment) return;
  const refundedCents = object.amount_refunded ?? object.amount ?? payment.refundedCents;
  const nextStatus =
    refundedCents >= payment.amountCents ? "REFUNDED" : refundedCents > 0 ? "PARTIALLY_REFUNDED" : payment.status;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { refundedCents, status: nextStatus, stripeAccountId: stripeAccountId ?? payment.stripeAccountId },
  });
  await reconcileInvoiceFromPayments(prisma, payment.invoiceId, payment.companyId);
  await writeAudit({
    companyId: payment.companyId,
    action: "payment.refunded",
    entityType: "Payment",
    entityId: payment.id,
    metadata: { refundedCents, eventType: event.type },
  });
  await emitPaymentAutomationEvent(prisma, { companyId: payment.companyId, trigger: "REFUND_COMPLETED" });
}

async function markDispute(
  prisma: PrismaClient,
  dispute: Stripe.Dispute,
  stripeAccountId?: string
) {
  const paymentIntentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
  if (!paymentIntentId) return;
  const payment = await prisma.payment.findFirst({
    where: { provider: "STRIPE", providerPaymentId: paymentIntentId },
  });
  if (!payment) return;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "DISPUTED", stripeAccountId: stripeAccountId ?? payment.stripeAccountId },
  });
  await writeAudit({
    companyId: payment.companyId,
    action: "payment.disputed",
    entityType: "Payment",
    entityId: payment.id,
    metadata: { disputeId: dispute.id },
  });
}
