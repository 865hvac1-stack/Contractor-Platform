import { createHmac, timingSafeEqual } from "crypto";
import { stripeConfigured } from "@/lib/payments/provider";

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

export async function createStripeCheckoutSession(input: {
  invoiceNumber: string;
  invoiceId: string;
  companyId: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
}) {
  if (!stripeConfigured()) {
    return { ok: false as const, error: "Card payments are not configured." };
  }
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("client_reference_id", input.invoiceId);
  body.set("metadata[companyId]", input.companyId);
  body.set("metadata[invoiceId]", input.invoiceId);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "usd");
  body.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
  body.set("line_items[0][price_data][product_data][name]", `Invoice ${input.invoiceNumber}`);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await response.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !json.url) {
    return { ok: false as const, error: json.error?.message ?? "Stripe checkout could not be created." };
  }
  return { ok: true as const, url: json.url, id: json.id ?? "" };
}

export function parseStripeCheckoutCompleted(event: {
  type?: string;
  data?: { object?: Record<string, unknown> };
}) {
  if (event.type !== "checkout.session.completed") return null;
  const session = event.data?.object ?? {};
  const metadata = (session.metadata as Record<string, string> | undefined) ?? {};
  const amount = Number(session.amount_total ?? 0);
  const providerPaymentId = String(session.id ?? session.payment_intent ?? "");
  if (!metadata.companyId || !metadata.invoiceId || !providerPaymentId || !(amount > 0)) return null;
  return {
    companyId: metadata.companyId,
    invoiceId: metadata.invoiceId,
    amountCents: amount,
    providerPaymentId,
  };
}
