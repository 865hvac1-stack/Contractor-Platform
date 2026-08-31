import { createHmac, timingSafeEqual } from "crypto";
import { platformFeeBps, stripeConfigured } from "@/lib/payments/config";
import { getConnectAccount } from "@/lib/payments/connect";
import { requireStripe } from "@/lib/payments/stripe-client";
import type { PrismaClient } from "@prisma/client";

export function verifyStripeSignature(payload: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key.trim(), rest.join("=")];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createStripeCheckoutSession(
  prisma: PrismaClient,
  input: {
    invoiceNumber: string;
    invoiceId: string;
    companyId: string;
    amountCents: number;
    successUrl: string;
    cancelUrl: string;
  }
) {
  if (!stripeConfigured()) {
    return { ok: false as const, error: "Card payments are not configured." };
  }
  const account = await getConnectAccount(prisma, input.companyId);
  if (!account || account.disabledAt) {
    return { ok: false as const, error: "Payments are not set up for this company." };
  }
  if (!account.chargesEnabled) {
    return { ok: false as const, error: "Card payments are not enabled yet. Complete payment setup." };
  }
  const feeBps = platformFeeBps();
  const applicationFee = feeBps > 0 ? Math.round((input.amountCents * feeBps) / 10_000) : 0;
  const stripe = requireStripe();
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.invoiceId,
        metadata: { companyId: input.companyId, invoiceId: input.invoiceId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: input.amountCents,
              product_data: { name: `Invoice ${input.invoiceNumber}` },
            },
          },
        ],
        ...(applicationFee > 0 ? { payment_intent_data: { application_fee_amount: applicationFee } } : {}),
      },
      { stripeAccount: account.stripeAccountId }
    );
    if (!session.url) return { ok: false as const, error: "Stripe checkout could not be created." };
    return { ok: true as const, url: session.url, id: session.id };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Stripe checkout could not be created.",
    };
  }
}

export function parseStripeCheckoutCompleted(event: {
  type?: string;
  data?: { object?: Record<string, unknown> };
}) {
  if (event.type !== "checkout.session.completed") return null;
  const session = event.data?.object ?? {};
  const metadata = (session.metadata as Record<string, string> | undefined) ?? {};
  const amount = Number(session.amount_total ?? 0);
  const providerPaymentId = String(
    typeof session.payment_intent === "string" ? session.payment_intent : (session.id ?? "")
  );
  if (!metadata.companyId || !metadata.invoiceId || !providerPaymentId || !(amount > 0)) return null;
  return {
    companyId: metadata.companyId,
    invoiceId: metadata.invoiceId,
    amountCents: amount,
    providerPaymentId,
  };
}
