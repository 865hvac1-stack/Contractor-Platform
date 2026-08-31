"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

export type InvoiceSyncTarget = { invoiceId: string } | { token: string };

type InvoiceSnapshot = {
  ok?: boolean;
  invoiceStatus?: string;
  amountPaidCents?: number;
  balanceCents?: number;
  totalCents?: number;
};

async function postSync(target: InvoiceSyncTarget) {
  const res = await fetch("/api/payments/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
  });
  return (await res.json()) as InvoiceSnapshot;
}

async function getStatus(target: InvoiceSyncTarget) {
  const query = "invoiceId" in target ? `invoiceId=${encodeURIComponent(target.invoiceId)}` : `token=${encodeURIComponent(target.token)}`;
  const res = await fetch(`/api/payments/status?${query}`);
  return (await res.json()) as InvoiceSnapshot;
}

function invoiceSettled(snapshot: InvoiceSnapshot) {
  return snapshot.ok === true && typeof snapshot.balanceCents === "number" && snapshot.balanceCents === 0;
}

function invoicePartiallyUpdated(snapshot: InvoiceSnapshot, chargedCents: number) {
  return (
    snapshot.ok === true &&
    typeof snapshot.amountPaidCents === "number" &&
    snapshot.amountPaidCents >= chargedCents
  );
}

async function syncAndWait(target: InvoiceSyncTarget, chargedCents: number) {
  let snapshot = await postSync(target);
  if (invoiceSettled(snapshot) || invoicePartiallyUpdated(snapshot, chargedCents)) return snapshot;
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    snapshot = i % 3 === 0 ? await postSync(target) : await getStatus(target);
    if (invoiceSettled(snapshot) || invoicePartiallyUpdated(snapshot, chargedCents)) return snapshot;
  }
  return snapshot;
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
      <PayForm amountCents={amountCents} returnUrl={returnUrl} syncTarget={{ invoiceId }} />
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
      <PayForm amountCents={amountCents} returnUrl={returnUrl} syncTarget={{ token }} />
    </Elements>
  );
}

function PayForm({
  amountCents,
  returnUrl,
  syncTarget,
}: {
  amountCents: number;
  returnUrl: string;
  syncTarget: InvoiceSyncTarget;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<InvoiceSnapshot | null>(null);

  async function refreshFromServer() {
    setUpdating(true);
    setError(null);
    try {
      const next = await syncAndWait(syncTarget, amountCents);
      setSnapshot(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh invoice status.");
    } finally {
      setUpdating(false);
    }
  }

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
        setMessage("Payment received. Updating invoice…");
        setUpdating(true);
        const next = await syncAndWait(syncTarget, amountCents);
        setSnapshot(next);
        router.refresh();
        return;
      }
      if (paymentIntent?.status === "processing") {
        setMessage("Bank payment processing. The invoice updates when the bank confirms — not when details are submitted.");
        setUpdating(true);
        const next = await syncAndWait(syncTarget, amountCents);
        setSnapshot(next);
        router.refresh();
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
      setUpdating(false);
    }
  }

  const serverConfirmed =
    snapshot?.ok &&
    typeof snapshot.amountPaidCents === "number" &&
    snapshot.amountPaidCents > 0;

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      {updating ? <p className="text-sm text-navy-700">Payment received. Updating invoice…</p> : null}
      {serverConfirmed ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          <p>
            Paid {formatMoney(snapshot.amountPaidCents ?? 0)} · Balance due{" "}
            {formatMoney(snapshot.balanceCents ?? 0)}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wide">
            Invoice status: {(snapshot.invoiceStatus ?? "").replaceAll("_", " ")}
          </p>
        </div>
      ) : null}
      {!message ? (
        <Button type="submit" className="w-full" disabled={!stripe || submitting}>
          {submitting ? "Processing payment…" : `Pay ${formatMoney(amountCents)}`}
        </Button>
      ) : (
        <Button type="button" variant="outline" className="w-full" disabled={updating} onClick={() => void refreshFromServer()}>
          {updating ? "Updating invoice…" : "Refresh status"}
        </Button>
      )}
      <p className="text-[11px] text-navy-500">
        Card and bank details stay with Stripe. ContractorYou never sees full card numbers or bank credentials.
      </p>
    </form>
  );
}
