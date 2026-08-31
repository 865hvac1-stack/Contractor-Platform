"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/money";
import { refundPaymentAction } from "@/server/actions/stripe-pay";

export function RefundForm({
  paymentId,
  remainingCents,
}: {
  paymentId: string;
  remainingCents: number;
}) {
  const [open, setOpen] = useState(false);
  if (remainingCents <= 0) return null;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Refund
      </Button>
    );
  }
  return (
    <ActionForm
      action={refundPaymentAction}
      successMessage="Refund submitted. Status updates when Stripe confirms it."
      className="mt-2 space-y-2 rounded-lg border border-[var(--border)] p-3"
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      <p className="text-xs text-[var(--muted-foreground)]">
        Remaining refundable: {formatMoney(remainingCents)}. This sends a refund to Stripe. The invoice updates
        after Stripe confirms it.
      </p>
      <Label htmlFor={`refund-${paymentId}`}>Refund amount ($)</Label>
      <Input
        id={`refund-${paymentId}`}
        name="amount"
        type="number"
        min="0.01"
        step="0.01"
        defaultValue={(remainingCents / 100).toFixed(2)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" required />
        I confirm this refund
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Submit refund
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}
