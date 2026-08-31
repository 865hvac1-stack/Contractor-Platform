"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ConnectUxStatus } from "@/lib/payments/connect";
import {
  continuePaymentsSetupAction,
  disconnectPaymentsAction,
  manageStripeAccountAction,
  startPaymentsOnboardingAction,
  updateStripePayoutAccountAction,
} from "@/server/actions/connect-payments";

export function PaymentsSettingsActions({ status }: { status: ConnectUxStatus }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function run(name: string, action: () => Promise<{ ok: boolean; error?: string } | void>) {
    setPending(name);
    setError(null);
    try {
      const result = await action();
      if (result && !result.ok) setError(result.error ?? "Something went wrong.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {status === "NOT_CONNECTED" || status === "DISABLED" ? (
        <Button
          type="button"
          className="h-11 w-full sm:w-auto"
          disabled={Boolean(pending)}
          onClick={() => void run("setup", startPaymentsOnboardingAction)}
        >
          {pending === "setup" ? "Starting…" : "Set Up Payments"}
        </Button>
      ) : null}
      {status === "ONBOARDING" ? (
        <Button
          type="button"
          className="h-11 w-full sm:w-auto"
          disabled={Boolean(pending)}
          onClick={() => void run("continue", continuePaymentsSetupAction)}
        >
          {pending === "continue" ? "Opening…" : "Continue Setup"}
        </Button>
      ) : null}
      {status === "ACTION_REQUIRED" || status === "RESTRICTED" ? (
        <Button
          type="button"
          className="h-11 w-full sm:w-auto"
          disabled={Boolean(pending)}
          onClick={() => void run("complete", continuePaymentsSetupAction)}
        >
          {pending === "complete" ? "Opening…" : "Complete Payment Setup"}
        </Button>
      ) : null}
      {status === "CONNECTED" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={Boolean(pending)}
            onClick={() => void run("manage", manageStripeAccountAction)}
          >
            {pending === "manage" ? "Opening…" : "Manage Payment Account"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={Boolean(pending)}
            onClick={() => void run("payout", updateStripePayoutAccountAction)}
          >
            {pending === "payout" ? "Opening…" : "Update payout bank"}
          </Button>
        </div>
      ) : null}
      {status !== "NOT_CONFIGURED" && status !== "NOT_CONNECTED" ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-red-700"
          disabled={Boolean(pending)}
          onClick={() => {
            if (!window.confirm("Disable ContractorYou Payments? Historical payments stay. Customers cannot pay by card until you set up again.")) {
              return;
            }
            void run("disconnect", disconnectPaymentsAction);
          }}
        >
          {pending === "disconnect" ? "Disabling…" : "Disable payments"}
        </Button>
      ) : null}
    </div>
  );
}
