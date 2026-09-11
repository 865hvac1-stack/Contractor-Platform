"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dryRunHousecallResetAction, executeHousecallResetAction } from "@/server/actions/import-reset";
import { HCP_RESET_CONFIRMATION } from "@/lib/imports/provenance";

export function HousecallResetDangerZone({
  lastDryRun,
}: {
  lastDryRun?: {
    createdAt: string;
    jobs: number;
    customers: number;
    properties: number;
    operationId: string;
  } | null;
}) {
  const [typed, setTyped] = useState("");
  const ready = typed.trim() === HCP_RESET_CONFIRMATION;

  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-800">Danger zone</p>
      <h2 className="mt-2 font-semibold text-[var(--cy-navy)]">Housecall Pro import reset</h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
        Removes only records with authoritative Housecall Pro provenance. Native ContractorYou customers, jobs,
        invoices, Stripe payments, QuickBooks mappings, HighLevel conversations, and company settings stay.
        Defaults to dry run.
      </p>

      {lastDryRun ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-white px-4 py-3 text-sm">
          <p className="font-medium text-[var(--cy-navy)]">Last dry run</p>
          <p className="mt-1 text-[var(--muted-foreground)]">
            {new Date(lastDryRun.createdAt).toLocaleString()} · {lastDryRun.customers.toLocaleString()} customers ·{" "}
            {lastDryRun.properties.toLocaleString()} properties · {lastDryRun.jobs.toLocaleString()} jobs · Operation{" "}
            {lastDryRun.operationId}
          </p>
        </div>
      ) : null}

      <ActionForm action={dryRunHousecallResetAction} className="mt-4">
        <Button type="submit" variant="outline">
          Run dry run
        </Button>
      </ActionForm>

      <details className="mt-6 rounded-xl border border-rose-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-rose-900">
          Execute reset — requires typed confirmation
        </summary>
        <ActionForm action={executeHousecallResetAction} className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="hcp-confirm">Type {HCP_RESET_CONFIRMATION}</Label>
            <Input
              id="hcp-confirm"
              name="confirmation"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="finalConfirm" value="yes" className="mt-1" />
            <span>I understand this permanently deletes confirmed Housecall Pro historical records and cannot be undone from this screen.</span>
          </label>
          <Button type="submit" variant="outline" disabled={!ready} className="border-rose-300 text-rose-900">
            Delete Housecall Pro import
          </Button>
        </ActionForm>
      </details>
    </section>
  );
}
