"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PaymentsOnboardingEmbed } from "@/app/(app)/settings/payments/payments-onboarding-embed";
import type { ConnectUxStatus } from "@/lib/payments/connect";
import {
  disconnectPaymentsAction,
  refreshPaymentsStatusAction,
  startPaymentsOnboardingAction,
} from "@/server/actions/connect-payments";

export function PaymentsSettingsActions({
  status,
  publishableKey,
  startOpen = false,
}: {
  status: ConnectUxStatus;
  publishableKey: string;
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [showEmbed, setShowEmbed] = useState(startOpen && status !== "NOT_CONFIGURED");

  async function openOnboarding(name: string) {
    setPending(name);
    setError(null);
    setDiagnostic(null);
    if (!publishableKey) {
      setError("Payments are not configured.");
      setPending(null);
      return;
    }
    try {
      const result = await startPaymentsOnboardingAction();
      if (result && !result.ok) {
        setError(result.error ?? "ContractorYou Payments couldn't start setup. Please try again or contact your administrator.");
        setDiagnostic(result.diagnostic ?? null);
        return;
      }
      setShowEmbed(true);
    } catch {
      setError("ContractorYou Payments couldn't start setup. Please try again or contact your administrator.");
    } finally {
      setPending(null);
    }
  }

  async function handleExit() {
    setShowEmbed(false);
    await refreshPaymentsStatusAction();
    router.refresh();
  }

  return (
    <div className="mt-5 space-y-3">
      {error ? (
        <div className="space-y-1">
          <p className="text-sm text-red-700">{error}</p>
          {diagnostic ? (
            <details className="text-xs text-[var(--muted-foreground)]">
              <summary>Administrator reference</summary>
              <p className="mt-1 break-words font-mono">{diagnostic}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {/* Future Stripe embeds (account management, payouts, balances, payments,
          refunds/disputes, notification banner) mount in this same Payments panel. */}
      {showEmbed && publishableKey ? (
        <PaymentsOnboardingEmbed publishableKey={publishableKey} onExit={() => void handleExit()} />
      ) : null}
      {!showEmbed && (status === "NOT_CONNECTED" || status === "DISABLED") ? (
        <Button
          type="button"
          className="h-11 w-full sm:w-auto"
          disabled={Boolean(pending)}
          onClick={() => void openOnboarding("setup")}
        >
          {pending === "setup" ? "Starting…" : "Set Up Payments"}
        </Button>
      ) : null}
      {!showEmbed && status === "ONBOARDING" ? (
        <Button
          type="button"
          className="h-11 w-full sm:w-auto"
          disabled={Boolean(pending)}
          onClick={() => void openOnboarding("continue")}
        >
          {pending === "continue" ? "Opening…" : "Continue Setup"}
        </Button>
      ) : null}
      {!showEmbed && (status === "ACTION_REQUIRED" || status === "RESTRICTED") ? (
        <Button
          type="button"
          className="h-11 w-full sm:w-auto"
          disabled={Boolean(pending)}
          onClick={() => void openOnboarding("complete")}
        >
          {pending === "complete" ? "Opening…" : "Resolve With Stripe"}
        </Button>
      ) : null}
      {!showEmbed && status === "CONNECTED" ? (
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={Boolean(pending)}
          onClick={() => void openOnboarding("manage")}
        >
          {pending === "manage" ? "Opening…" : "Update payment details"}
        </Button>
      ) : null}
      {showEmbed ? (
        <Button type="button" variant="ghost" className="h-11" onClick={() => void handleExit()}>
          Close setup
        </Button>
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
            void (async () => {
              setPending("disconnect");
              await disconnectPaymentsAction();
              setShowEmbed(false);
              setPending(null);
              router.refresh();
            })();
          }}
        >
          {pending === "disconnect" ? "Disabling…" : "Disable payments"}
        </Button>
      ) : null}
    </div>
  );
}
