import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { refreshConnectAccount } from "@/lib/payments/connect";
import { recordConfirmedProviderPayment, reconcileInvoiceFromPayments } from "@/lib/payments/record";
import { sendPaymentReceiptEmail } from "@/lib/payments/receipt";
import { requireStripe, type Stripe } from "@/lib/payments/stripe-client";
import { stripeWebhookSecret } from "@/lib/payments/config";
import { emitPaymentAutomationEvent } from "@/lib/payments/events";
import { connectAccountIdFromEvent, isV2AccountEvent } from "@/lib/payments/connect-v2";
import { confirmStripeIntentPayment } from "@/lib/payments/sync";

export function constructStripeEvent(raw: string, signature: string | null) {
  const secret = stripeWebhookSecret();
  if (!secret) return { ok: false as const, error: "Stripe webhook is not configured.", status: 503 };
  if (!signature) return { ok: false as const, error: "Invalid signature.", status: 401 };
  try {
    const stripe = requireStripe();
    let objectType: string | undefined;
    try {
      objectType = (JSON.parse(raw) as { object?: string }).object;
    } catch {
      return { ok: false as const, error: "Invalid signature.", status: 401 };
    }
    if (objectType === "v2.core.event") {
      const event = stripe.parseEventNotification(raw, signature, secret);
      return { ok: true as const, event };
    }
    const event = stripe.webhooks.constructEvent(raw, signature, secret);
    return { ok: true as const, event };
  } catch {
    return { ok: false as const, error: "Invalid signature.", status: 401 };
  }
}

function eventDataObject(event: { data?: { object?: unknown } }) {
  return event.data?.object;
}

async function trustedInvoiceForPayment(
  prisma: PrismaClient,
  input: { metadataCompanyId?: string; invoiceId?: string; stripeAccountId?: string }
) {
  if (!input.invoiceId) return null;
  const invoice = await prisma.invoice.findFirst({ where: { id: input.invoiceId } });
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

export async function processStripeEvent(
  prisma: PrismaClient,
  event: Stripe.Event | {
    id: string;
    type: string;
    account?: string;
    related_object?: { id?: string };
    data?: { object?: unknown };
  }
) {
  const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
  if (existing) return { ok: true as const, duplicate: true };

  const connectedAccount = connectAccountIdFromEvent(event);
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
    case "account.updated":
    case "v2.core.account.updated":
    case "v2.core.account.created":
    case "v2.core.account[requirements].updated":
    case "v2.core.account[configuration.merchant].updated":
    case "v2.core.account[configuration.merchant].capability_status_updated":
    case "v2.core.account[future_requirements].updated":
    case "v2.core.account_link.returned": {
      if (company) await refreshConnectAccount(prisma, company.companyId);
      break;
    }
    case "v2.core.account.closed": {
      if (company) {
        await prisma.stripeConnectAccount.update({
          where: { id: company.id },
          data: { onboardingStatus: "DISABLED" },
        });
        await refreshConnectAccount(prisma, company.companyId).catch(() => undefined);
      }
      break;
    }
    case "payment_intent.processing": {
      await markIntentStatus(prisma, eventDataObject(event) as Stripe.PaymentIntent, "PROCESSING", connectedAccount);
      break;
    }
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      await markIntentStatus(
        prisma,
        eventDataObject(event) as Stripe.PaymentIntent,
        event.type === "payment_intent.canceled" ? "CANCELED" : "FAILED",
        connectedAccount
      );
      break;
    }
    case "payment_intent.succeeded": {
      await confirmIntent(prisma, eventDataObject(event) as Stripe.PaymentIntent, connectedAccount);
      break;
    }
    case "charge.succeeded": {
      await confirmCharge(prisma, eventDataObject(event) as Stripe.Charge, connectedAccount);
      break;
    }
    case "checkout.session.completed": {
      const session = eventDataObject(event) as Stripe.Checkout.Session | undefined;
      if (!session) break;
      const metadata = session.metadata ?? {};
      const invoice = await trustedInvoiceForPayment(prisma, {
        metadataCompanyId: metadata.companyId,
        invoiceId: metadata.invoiceId,
        stripeAccountId: connectedAccount,
      });
      if (invoice && session.payment_intent) {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
        await recordConfirmedProviderPayment({
          prisma,
          companyId: invoice.companyId,
          invoiceId: invoice.id,
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
      await markDispute(prisma, eventDataObject(event) as Stripe.Dispute, connectedAccount);
      break;
    }
    default:
      if (isV2AccountEvent(event.type) && company) {
        await refreshConnectAccount(prisma, company.companyId);
      }
      break;
  }
  } catch (error) {
    await prisma.stripeWebhookEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    throw error;
  }

  return { ok: true as const, duplicate: false };
}

function paymentIntentIdFromCharge(charge: Stripe.Charge | undefined) {
  if (!charge) return null;
  const raw = charge.payment_intent;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string") return raw.id;
  return null;
}

async function confirmCharge(prisma: PrismaClient, charge: Stripe.Charge, stripeAccountId?: string) {
  const providerPaymentId = paymentIntentIdFromCharge(charge);
  if (!providerPaymentId) return;
  const methodTypes =
    charge.payment_method_details?.type === "us_bank_account" ? ["us_bank_account"] : ["card"];
  await confirmIntent(
    prisma,
    {
      id: providerPaymentId,
      amount: charge.amount,
      amount_received: charge.amount,
      payment_method_types: methodTypes,
      metadata: (charge.metadata ?? {}) as Stripe.PaymentIntent["metadata"],
    } as Stripe.PaymentIntent,
    stripeAccountId
  );
}

async function confirmIntent(
  prisma: PrismaClient,
  intent: Stripe.PaymentIntent,
  stripeAccountId?: string
) {
  if (!intent?.id) return;
  const metadata = (intent.metadata ?? {}) as Record<string, string>;
  const method = intent.payment_method_types?.includes("us_bank_account") && !intent.payment_method_types.includes("card")
    ? "ACH"
    : "CREDIT_CARD";
  const result = await confirmStripeIntentPayment(prisma, {
    providerPaymentId: intent.id,
    amountCents: intent.amount_received || intent.amount,
    metadata,
    paymentMethodTypes: intent.payment_method_types,
    stripeAccountId,
  });
  if (!result.ok || !result.created || !result.payment) return;
  const companyId = result.payment.companyId;
  const invoiceId = result.payment.invoiceId;
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
      companyId,
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

async function markIntentStatus(
  prisma: PrismaClient,
  intent: Stripe.PaymentIntent,
  status: string,
  stripeAccountId?: string
) {
  const payment = await prisma.payment.findFirst({
    where: { provider: "STRIPE", providerPaymentId: intent.id },
  });
  if (!payment) return;
  if (stripeAccountId && payment.stripeAccountId && payment.stripeAccountId !== stripeAccountId) return;
  await prisma.payment.updateMany({
    where: {
      id: payment.id,
      companyId: payment.companyId,
      status: { notIn: ["CONFIRMED", "SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] },
    },
    data: { status, stripeAccountId: stripeAccountId ?? payment.stripeAccountId ?? undefined },
  });
  if (status === "FAILED") {
    await writeAudit({
      companyId: payment.companyId,
      action: "payment.failed",
      entityType: "Invoice",
      entityId: payment.invoiceId || intent.id,
      metadata: { providerPaymentId: intent.id },
    });
    await emitPaymentAutomationEvent(prisma, { companyId: payment.companyId, trigger: "PAYMENT_FAILED" });
  }
}

async function applyRefundEvent(
  prisma: PrismaClient,
  event: { type: string; data?: { object?: unknown } },
  stripeAccountId?: string
) {
  const object = eventDataObject(event) as { payment_intent?: string | { id?: string }; amount_refunded?: number; amount?: number } | undefined;
  if (!object) return;
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
