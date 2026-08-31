"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PaymentsOnboardingEmbed } from "@/app/(app)/settings/payments/payments-onboarding-embed";
import type { ConnectUxStatus } from "@/lib/payments/connect";
import { EMBEDDED_SETUP_COPY, paymentsStatusCopy } from "@/lib/payments/payments-ux";
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
  const copy = paymentsStatusCopy(status);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [showEmbed, setShowEmbed] = useState(startOpen && status !== "NOT_CONFIGURED");

  async function openOnboarding(name: string) {
    setPending(name);
    setError(null);
    setDiagnostic(null);
    if (!publishableKey) {
      setError(EMBEDDED_SETUP_COPY.failed);
      setPending(null);
      return;
    }
    try {
      const result = await startPaymentsOnboardingAction();
      if (result && !result.ok) {
        setError(result.error ?? EMBEDDED_SETUP_COPY.failed);
        setDiagnostic(result.diagnostic ?? null);
        return;
      }
      setShowEmbed(true);
    } catch {
      setError(EMBEDDED_SETUP_COPY.failed);
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
      {showEmbed ? (
        <div>
          <h2 className="text-xl font-semibold">{EMBEDDED_SETUP_COPY.title}</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{EMBEDDED_SETUP_COPY.body}</p>
          {pending ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">{EMBEDDED_SETUP_COPY.preparing}</p>
          ) : null}
          {/* Future Stripe embeds (account management, payouts, balances, payments,
              refunds/disputes, notification banner) mount in this same Payments panel. */}
          {publishableKey ? (
            <PaymentsOnboardingEmbed publishableKey={publishableKey} onExit={() => void handleExit()} />
          ) : null}
        </div>
      ) : null}
      {!showEmbed && copy.action && status !== "NOT_CONFIGURED" ? (
        <Button
          type="button"
          variant={status === "CONNECTED" ? "outline" : "default"}
          className="h-11 w-full min-[375px]:w-full sm:w-auto"
          disabled={Boolean(pending)}
          onClick={() => void openOnboarding(status === "CONNECTED" ? "manage" : "setup")}
        >
          {pending ? EMBEDDED_SETUP_COPY.preparing : copy.action}
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
            if (
              !window.confirm(
                "Disable ContractorYou Payments? Historical payments stay. Customers cannot pay by card until you set up again."
              )
            ) {
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
