"use client";

import { useMemo, useState } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import {
  EMBEDDED_SETUP_COPY,
  PAYMENTS_EMBED_FRAME_CLASS,
  PAYMENTS_NAVY,
  PAYMENTS_ORANGE,
} from "@/lib/payments/payments-ux";

export function PaymentsOnboardingEmbed({
  publishableKey,
  onExit,
}: {
  publishableKey: string;
  onExit: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const connectInstance = useMemo(
    () =>
      loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret: async () => {
          // Connect.js calls this again when an Account Session expires.
          // The server reuses the same connected account and issues a new session.
          const response = await fetch("/api/payments/connect/account-session", {
            method: "POST",
            credentials: "same-origin",
          });
          const payload = (await response.json().catch(() => ({}))) as {
            clientSecret?: string;
            error?: string;
          };
          if (!response.ok || !payload.clientSecret) {
            setError(EMBEDDED_SETUP_COPY.failed);
            throw new Error(EMBEDDED_SETUP_COPY.failed);
          }
          setError(null);
          return payload.clientSecret;
        },
        locale: "en-US",
        appearance: {
          overlays: "dialog",
          variables: {
            colorPrimary: PAYMENTS_ORANGE,
            colorText: PAYMENTS_NAVY,
            colorBackground: "#ffffff",
            buttonPrimaryColorBackground: PAYMENTS_ORANGE,
            buttonPrimaryColorText: "#ffffff",
          },
        },
      }),
    [publishableKey]
  );

  return (
    <div className={PAYMENTS_EMBED_FRAME_CLASS}>
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {!loaded && !error ? (
        <p className="mb-3 text-sm text-[var(--muted-foreground)]">{EMBEDDED_SETUP_COPY.loading}</p>
      ) : null}
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          collectionOptions={{ fields: "eventually_due", futureRequirements: "omit" }}
          onExit={onExit}
          onLoaderStart={() => setLoaded(true)}
          onLoadError={() => {
            setLoaded(true);
            setError(EMBEDDED_SETUP_COPY.failed);
          }}
        />
      </ConnectComponentsProvider>
    </div>
  );
}
