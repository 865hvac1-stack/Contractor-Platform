"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function InvoiceStatusRefresh({
  invoiceId,
  token,
}: {
  invoiceId?: string;
  token?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { token } : { invoiceId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not refresh invoice status.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh invoice status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
        {busy ? "Updating invoice…" : "Refresh status"}
      </Button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
