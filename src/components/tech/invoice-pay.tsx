import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/money";
import { recordPaymentAction } from "@/server/actions/billing";
import { CardPay } from "@/components/payments/card-pay";
import { cn } from "@/lib/utils";

export function TechInvoicePay({
  invoice,
  canPay,
  card,
}: {
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    totalCents: number;
    amountPaidCents: number;
    balanceCents: number;
    publicToken: string | null;
  };
  canPay: boolean;
  card?: {
    publishableKey: string;
    stripeAccountId: string;
    returnUrl: string;
  } | null;
}) {
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-[var(--foreground)]">
        {invoice.invoiceNumber} · {invoice.status.replaceAll("_", " ")}
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[11px] text-[var(--muted-foreground)]">Invoice</p>
          <p className="text-sm font-semibold tabular-nums">{formatMoney(invoice.totalCents)}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--muted-foreground)]">Paid</p>
          <p className="text-sm font-semibold tabular-nums">{formatMoney(invoice.amountPaidCents)}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--muted-foreground)]">Balance</p>
          <p className="text-sm font-semibold tabular-nums">{formatMoney(invoice.balanceCents)}</p>
        </div>
      </div>
      {invoice.balanceCents === 0 ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Payment received. Receipt sending stays with the company communications setup.
        </p>
      ) : canPay ? (
        <>
          {card ? (
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="mb-2 text-sm font-medium">Collect card</p>
              <CardPay
                invoiceId={invoice.id}
                amountCents={invoice.balanceCents}
                publishableKey={card.publishableKey}
                stripeAccountId={card.stripeAccountId}
                returnUrl={card.returnUrl}
              />
            </div>
          ) : invoice.publicToken ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              Card collection is not set up. Cash and check can still be recorded.
            </p>
          ) : null}
          <ActionForm action={recordPaymentAction} successMessage="Recorded as a manual payment. This is not a card charge.">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <Label htmlFor="pay-amount">Record cash / check / other</Label>
            <Input
              id="pay-amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={(invoice.balanceCents / 100).toFixed(2)}
              className="mt-1 h-11"
            />
            <select
              name="method"
              defaultValue="CASH"
              className="mt-2 h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              <option value="CASH">Cash (recorded)</option>
              <option value="CHECK">Check (recorded)</option>
              <option value="OTHER">Other recorded payment</option>
            </select>
            <Input name="reference" placeholder="Check number or note" className="mt-2 h-11" />
            <Button type="submit" className="mt-2 h-12 w-full">
              Record payment
            </Button>
          </ActionForm>
          {invoice.publicToken ? (
            <Link
              href={`/i/${invoice.publicToken}`}
              className={cn(buttonVariants({ variant: "outline" }), "flex h-12 w-full items-center justify-center")}
            >
              Open customer payment page
            </Link>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">You cannot record payments on this invoice.</p>
      )}
    </div>
  );
}
