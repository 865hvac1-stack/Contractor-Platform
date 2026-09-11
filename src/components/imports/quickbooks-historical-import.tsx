"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuickBooksHistoricalResetZone } from "@/components/imports/quickbooks-historical-reset";
import { importQuickBooksHistoricalAction, previewQuickBooksHistoricalAction } from "@/server/actions/import-reset";

export function QuickBooksHistoricalImport({
  preview,
  canReset = false,
  realm,
  lastDryRun,
  lastExecute,
}: {
  preview?: {
    connected: boolean;
    customers: number;
    invoices: number;
    payments: number;
    items: number;
    expenses: number;
    error?: string;
  } | null;
  canReset?: boolean;
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
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">QuickBooks</p>
      <h2 className="mt-2 font-semibold text-[var(--cy-navy)]">Accounting & financial history</h2>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Preview first. Historical invoices and payments appear on Customer 360 as financial history. They do not enter
        Billing Watchdog, Ready to Invoice, or sync back to QuickBooks.
      </p>

      {preview?.connected ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Count label="Customers" value={preview.customers} />
          <Count label="Invoices" value={preview.invoices} />
          <Count label="Payments" value={preview.payments} />
          <Count label="Products / services" value={preview.items} />
          <Count label="Expenses" value={preview.expenses} />
        </dl>
      ) : (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">
          {preview?.error || "Connect QuickBooks to scan available historical records."}
        </p>
      )}

      <ActionForm action={previewQuickBooksHistoricalAction} className="mt-4">
        <Button type="submit" variant="outline">
          Preview import
        </Button>
      </ActionForm>

      {preview?.connected ? (
        <ActionForm action={importQuickBooksHistoricalAction} className="mt-6 space-y-3 border-t border-[var(--border)] pt-4">
          <p className="text-sm font-medium">Select categories, then confirm</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="customers" defaultChecked /> Customers
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="invoices" defaultChecked /> Historical invoices
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="payments" defaultChecked /> Historical payments
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="expenses" /> Expenses
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="items" /> Products / services
          </label>
          <div className="space-y-1">
            <Label htmlFor="qbo-confirm">Type IMPORT QUICKBOOKS HISTORY</Label>
            <Input id="qbo-confirm" name="confirm" autoComplete="off" />
          </div>
          <Button type="submit">Import selected history</Button>
        </ActionForm>
      ) : null}

      <QuickBooksHistoricalResetZone
        canReset={canReset}
        realm={realm}
        lastDryRun={lastDryRun}
        lastExecute={lastExecute}
      />
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--cy-gray)]/50 px-3 py-2">
      <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-lg font-semibold text-[var(--cy-navy)]">{value.toLocaleString()}</dd>
    </div>
  );
}
