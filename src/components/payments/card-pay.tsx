"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

const stripePromises = new Map<string, Promise<Stripe | null>>();

function stripePromise(publishableKey: string, stripeAccount: string) {
  const key = `${publishableKey}:${stripeAccount}`;
  if (!stripePromises.has(key)) {
    stripePromises.set(key, loadStripe(publishableKey, { stripeAccount }));
  }
  return stripePromises.get(key)!;
}

export function CardPay({
  invoiceId,
  amountCents,
  publishableKey,
  stripeAccountId,
  returnUrl,
}: {
  invoiceId: string;
  amountCents: number;
  publishableKey: string;
  stripeAccountId: string;
  returnUrl: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = (await res.json()) as { clientSecret?: string; error?: string };
      if (!res.ok || !data.clientSecret) throw new Error(data.error ?? "Could not start payment.");
      setClientSecret(data.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment.");
    } finally {
      setStarting(false);
    }
  }

  const promise = useMemo(
    () => stripePromise(publishableKey, stripeAccountId),
    [publishableKey, stripeAccountId],
  );

  if (!clientSecret) {
    return (
      <div className="space-y-2">
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button type="button" disabled={starting} onClick={() => void start()}>
          {starting ? "Starting…" : `Collect card ${formatMoney(amountCents)}`}
        </Button>
      </div>
    );
  }

  return (
    <Elements stripe={promise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <PayForm amountCents={amountCents} returnUrl={returnUrl} />
    </Elements>
  );
}

export function PublicCardPay({
  token,
  amountCents,
  publishableKey,
  stripeAccountId,
  returnUrl,
}: {
  token: string;
  amountCents: number;
  publishableKey: string;
  stripeAccountId: string;
  returnUrl: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/public-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as { clientSecret?: string; error?: string };
      if (!res.ok || !data.clientSecret) throw new Error(data.error ?? "Could not start payment.");
      setClientSecret(data.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment.");
    } finally {
      setStarting(false);
    }
  }

  const promise = useMemo(
    () => stripePromise(publishableKey, stripeAccountId),
    [publishableKey, stripeAccountId],
  );

  if (!clientSecret) {
    return (
      <div className="space-y-3">
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button type="button" className="w-full" disabled={starting} onClick={() => void start()}>
          {starting ? "Preparing secure payment…" : `Pay ${formatMoney(amountCents)}`}
        </Button>
      </div>
    );
  }

  return (
    <Elements stripe={promise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <PayForm amountCents={amountCents} returnUrl={returnUrl} />
    </Elements>
  );
}

function PayForm({ amountCents, returnUrl }: { amountCents: number; returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (confirmError) {
        setError(confirmError.message ?? "Payment failed.");
        return;
      }
      if (paymentIntent?.status === "succeeded") {
        setMessage(`Payment successful. ${formatMoney(amountCents)} received.`);
        return;
      }
      if (paymentIntent?.status === "processing") {
        setMessage("Bank payment processing. The invoice updates when the bank confirms.");
        return;
      }
      if (paymentIntent?.status === "requires_action") {
        setMessage("Additional authentication is required. Follow the prompts from your bank.");
        return;
      }
      setMessage("Payment submitted. Status updates when the processor confirms.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      {!message ? (
        <Button type="submit" className="w-full" disabled={!stripe || submitting}>
          {submitting ? "Processing payment…" : `Pay ${formatMoney(amountCents)}`}
        </Button>
      ) : null}
      <p className="text-[11px] text-navy-500">
        Card and bank details stay with Stripe. ContractorYou never sees full card numbers or bank credentials.
      </p>
    </form>
  );
}
