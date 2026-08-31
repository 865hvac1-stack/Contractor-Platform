import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseStripeCheckoutCompleted, verifyStripeSignature } from "@/lib/payments/stripe";
import { recordConfirmedProviderPayment } from "@/lib/payments/record";

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Stripe webhook is not configured." }, { status: 503 });
  }
  const header = request.headers.get("stripe-signature");
  if (!verifyStripeSignature(raw, header, secret)) {
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }
  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw) as { type?: string; data?: { object?: Record<string, unknown> } };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
  }
  const completed = parseStripeCheckoutCompleted(event);
  if (!completed) return NextResponse.json({ ok: true, ignored: true });
  const result = await recordConfirmedProviderPayment({
    prisma,
    companyId: completed.companyId,
    invoiceId: completed.invoiceId,
    amountCents: completed.amountCents,
    provider: "STRIPE",
    providerPaymentId: completed.providerPaymentId,
    method: "CREDIT_CARD",
    notes: "Stripe Checkout confirmed",
  });
  return NextResponse.json({ ok: true, created: result.created });
}
