"use client";

import { useMemo, useState } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";

export function PaymentsOnboardingEmbed({
  publishableKey,
  onExit,
}: {
  publishableKey: string;
  onExit: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const connectInstance = useMemo(
    () =>
      loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret: async () => {
          const response = await fetch("/api/payments/connect/account-session", {
            method: "POST",
            credentials: "same-origin",
          });
          const payload = (await response.json().catch(() => ({}))) as {
            clientSecret?: string;
            error?: string;
          };
          if (!response.ok || !payload.clientSecret) {
            const message =
              payload.error ||
              "ContractorYou Payments couldn't start setup. Please try again or contact your administrator.";
            setError(message);
            throw new Error(message);
          }
          setError(null);
          return payload.clientSecret;
        },
        locale: "en-US",
        appearance: {
          overlays: "dialog",
          variables: {
            colorPrimary: "#f87000",
            buttonPrimaryColorBackground: "#f87000",
            buttonPrimaryColorText: "#ffffff",
          },
        },
      }),
    [publishableKey]
  );

  return (
    <div className="mt-5 min-h-[28rem] w-full overflow-hidden rounded-xl border border-[var(--border)] bg-white p-2 sm:p-4">
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          collectionOptions={{ fields: "eventually_due", futureRequirements: "omit" }}
          onExit={onExit}
          onLoadError={() => {
            setError(
              "ContractorYou Payments couldn't load Stripe setup. Please try again or contact your administrator."
            );
          }}
        />
      </ConnectComponentsProvider>
    </div>
  );
}
