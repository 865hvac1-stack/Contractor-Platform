"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QBO_RESET_CONFIRMATION } from "@/lib/imports/provenance";
import {
  dryRunQuickBooksHistoricalResetAction,
  executeQuickBooksHistoricalResetAction,
} from "@/server/actions/import-reset";

export function QuickBooksHistoricalResetZone({
  canReset,
  realm,
  lastDryRun,
  lastExecute,
}: {
  canReset: boolean;
  realm: {
    companyName: string | null;
    realmId: string | null;
    environmentLabel: string;
    connectionStatus: string | null;
  };
  lastDryRun?: {
    createdAt: string;
    invoices: number;
    payments: number;
    customers: number;
    operationId: string;
    completed?: boolean;
  } | null;
  lastExecute?: {
    createdAt: string;
    invoices: number;
    payments: number;
    customers: number;
    operationId: string;
    executed: boolean;
  } | null;
}) {
  const [typed, setTyped] = useState("");
  const ready = typed.trim() === QBO_RESET_CONFIRMATION;

  if (!canReset) return null;

  return (
    <div className="mt-8 border-t border-[var(--border)] pt-6">
      <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-800">Danger zone</p>
        <h3 className="mt-2 font-semibold text-[var(--cy-navy)]">QuickBooks historical import reset</h3>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Removes only records created by the QuickBooks historical import. Native ContractorYou invoices, payments,
          jobs, Stripe payments, HighLevel data, live QuickBooks mappings, OAuth, and the current QuickBooks connection
          stay. Defaults to dry run.
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-rose-100 bg-white px-3 py-2">
            <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">QuickBooks company</dt>
            <dd className="font-medium text-[var(--cy-navy)]">{realm.companyName || "Unknown"}</dd>
          </div>
          <div className="rounded-xl border border-rose-100 bg-white px-3 py-2">
            <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Realm ID</dt>
            <dd className="break-all font-medium text-[var(--cy-navy)]">{realm.realmId || "Not connected / not stored"}</dd>
          </div>
          <div className="rounded-xl border border-rose-100 bg-white px-3 py-2">
            <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Environment</dt>
            <dd className="font-medium text-[var(--cy-navy)]">{realm.environmentLabel}</dd>
          </div>
          <div className="rounded-xl border border-rose-100 bg-white px-3 py-2">
            <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Connection</dt>
            <dd className="font-medium text-[var(--cy-navy)]">{realm.connectionStatus || "Not connected"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          This reset applies only to historical QuickBooks imports associated with this source/realm.
        </p>

        {lastExecute?.executed ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm">
            <p className="font-medium text-[var(--cy-navy)]">QuickBooks historical import reset completed.</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              {new Date(lastExecute.createdAt).toLocaleString()} · {lastExecute.invoices.toLocaleString()} invoices ·{" "}
              {lastExecute.payments.toLocaleString()} payments · {lastExecute.customers.toLocaleString()} customers ·
              Operation {lastExecute.operationId}
            </p>
          </div>
        ) : null}

        {lastDryRun ? (
          <div className="mt-4 rounded-xl border border-rose-100 bg-white px-4 py-3 text-sm">
            <p className="font-medium text-[var(--cy-navy)]">Last dry run</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              {new Date(lastDryRun.createdAt).toLocaleString()} · {lastDryRun.invoices.toLocaleString()} historical
              invoices · {lastDryRun.payments.toLocaleString()} historical payments ·{" "}
              {lastDryRun.customers.toLocaleString()} historical-only customers · Operation {lastDryRun.operationId}
            </p>
          </div>
        ) : null}

        <ActionForm action={dryRunQuickBooksHistoricalResetAction} className="mt-4">
          <Button type="submit" variant="outline">
            Run dry run
          </Button>
        </ActionForm>

        <details className="mt-6 rounded-xl border border-rose-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-rose-900">
            Execute reset — requires typed confirmation
          </summary>
          <ActionForm action={executeQuickBooksHistoricalResetAction} className="mt-4 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="qbo-reset-confirm">Type {QBO_RESET_CONFIRMATION}</Label>
              <Input
                id="qbo-reset-confirm"
                name="confirmation"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="finalConfirm" value="yes" className="mt-1" />
              <span>I understand this permanently removes confirmed QuickBooks historical import records from ContractorYou.</span>
            </label>
            <Button type="submit" variant="outline" disabled={!ready} className="border-rose-300 text-rose-900">
              Delete QuickBooks historical import
            </Button>
          </ActionForm>
        </details>
      </section>
    </div>
  );
}
