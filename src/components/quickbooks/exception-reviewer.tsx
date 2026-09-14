"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions/auth";
import {
  flagQuickBooksMergeReviewAction,
  resolveQuickBooksExceptionAction,
  skipQuickBooksExceptionAction,
  undoLastQuickBooksExceptionAction,
} from "@/server/actions/quickbooks-sync-center";

type Comparison = {
  field: string;
  quickBooks: string | null;
  contractorYou: string | null;
  status: "MATCH" | "DIFFERENT" | "MISSING";
};

type Candidate = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  confidence: number;
  matchedFields: string[];
  differentFields: string[];
  properties: Array<{
    id: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    isPrimary: boolean;
    matching: boolean;
  }>;
  comparisons: Comparison[];
};

type ExceptionItem = {
  id: string;
  quickbooksId: string;
  displayName: string;
  confidence: string;
  confidenceScore: number;
  blocker: string;
  blockerLabel: string;
  reason: string;
  skipped: boolean;
  qbo: {
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
    billingAddress: string | null;
    serviceAddress: string | null;
  };
  candidates: Candidate[];
  searchedCandidates: Candidate[];
};

export function ExceptionReviewer({
  current,
  canManage,
  canUndo,
  reason,
  skipped,
}: {
  current: ExceptionItem | null;
  canManage: boolean;
  canUndo: boolean;
  reason?: string;
  skipped?: boolean;
}) {
  const router = useRouter();
  const [decisionState, decisionAction, deciding] = useActionState(
    resolveQuickBooksExceptionAction,
    null as ActionResult | null
  );
  const [skipState, skipAction, skipping] = useActionState(
    skipQuickBooksExceptionAction,
    null as ActionResult | null
  );
  const [undoState, undoAction, undoing] = useActionState(
    undoLastQuickBooksExceptionAction,
    null as ActionResult | null
  );
  const handled = useRef<ActionResult | null>(null);
  const state = decisionState || skipState || undoState;
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  useEffect(() => {
    if (!canManage || !current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        (target instanceof HTMLElement && target.matches("input, textarea, select, button")) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) return;
      const button = document.querySelector<HTMLButtonElement>(`[data-review-shortcut="${event.key.toLowerCase()}"]`);
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canManage, current]);

  if (!current) {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="font-semibold text-emerald-900">All customer exceptions are resolved.</p>
        <p className="mt-1 text-sm text-emerald-800">Stage 1 is ready for final review. Nothing has been imported.</p>
        {canUndo && canManage ? (
          <form action={undoAction} className="mt-4">
            <Button type="submit" variant="outline" disabled={undoing}>Undo Last</Button>
          </form>
        ) : null}
      </div>
    );
  }

  const multiple = current.candidates.length > 1;
  const pending = deciding || skipping || undoing;
  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <form action={skipAction}>
              <input type="hidden" name="reviewId" value={current.id} />
              <Button type="submit" variant="outline" disabled={pending}>Skip for Later</Button>
            </form>
          ) : null}
          {canManage && canUndo ? (
            <form action={undoAction}>
              <Button type="submit" variant="ghost" disabled={pending}>Undo Last</Button>
            </form>
          ) : null}
        </div>
        {canManage ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            Keyboard: {multiple ? "1–3 link candidates · C create · N not duplicate · I ignore" : "1 link best · 2 create · 3 not duplicate · 4 ignore"}
          </p>
        ) : null}
      </div>

      {state ? (
        <p role={state.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {state.ok ? state.message : state.error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">QuickBooks customer</p>
            <h3 className="mt-2 text-xl font-semibold text-[var(--cy-navy)]">{current.qbo.name}</h3>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium">QB ID {current.quickbooksId}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Company" value={current.qbo.company} />
          <Field label="Phone" value={current.qbo.phone} />
          <Field label="Email" value={current.qbo.email} />
          <Field label="Billing address" value={current.qbo.billingAddress} />
          <Field label="Service address" value={current.qbo.serviceAddress} />
        </dl>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-900">Why this needs review</p>
        <p className="mt-2 font-semibold text-amber-950">{current.blockerLabel}</p>
        <p className="mt-1 text-sm text-amber-900">{current.reason}</p>
        {current.confidence === "NONE" ? (
          <p className="mt-2 text-sm font-medium text-amber-950">ContractorYou did not auto-approve this as new because a similar identity or customer candidate needs judgment.</p>
        ) : null}
      </section>

      {current.candidates.length ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Best ContractorYou match</p>
          <CandidateCard
            candidate={current.candidates[0]!}
            current={current}
            action={decisionAction}
            pending={pending}
            shortcut="1"
            label={multiple ? "Link to Candidate 1" : "Link to This Customer"}
            canManage={canManage}
          />
          {current.candidates.length > 1 ? (
            <div className="mt-5 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Other possible matches</p>
              {current.candidates.slice(1).map((candidate, index) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  current={current}
                  action={decisionAction}
                  pending={pending}
                  shortcut={index < 2 ? String(index + 2) : undefined}
                  label={`Link to Candidate ${index + 2}`}
                  canManage={canManage}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted-foreground)]">
          No existing ContractorYou candidate was identified. Search below before approving a new customer.
        </section>
      )}

      {canManage ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <DecisionForm action={decisionAction} current={current} resolution="CREATE" label="Create as New Customer" shortcut={multiple ? "c" : "2"} pending={pending} />
          <DecisionForm action={decisionAction} current={current} resolution="NOT_DUPLICATE" label="Not a Duplicate" shortcut={multiple ? "n" : "3"} pending={pending} />
          <DecisionForm action={decisionAction} current={current} resolution="IGNORE" label="Ignore / Do Not Import" shortcut={multiple ? "i" : "4"} pending={pending} />
        </div>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <h3 className="font-medium">Search ContractorYou</h3>
        <form method="get" className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="view" value="exceptions" />
          {reason ? <input type="hidden" name="exceptionReason" value={reason} /> : null}
          {skipped ? <input type="hidden" name="skipped" value="1" /> : null}
          <Input name="customerSearch" placeholder="Name, phone, email, or address" className="min-w-64 flex-1" />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        {current.searchedCandidates.length ? (
          <div className="mt-4 space-y-3">
            {current.searchedCandidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                current={current}
                action={decisionAction}
                pending={pending}
                label="Link This Search Result"
                canManage={canManage}
              />
            ))}
          </div>
        ) : null}
      </section>

      {canManage && current.candidates.length > 1 ? (
        <MergeFlagForm current={current} />
      ) : null}
    </div>
  );
}

function CandidateCard({
  candidate,
  current,
  action,
  pending,
  shortcut,
  label,
  canManage,
}: {
  candidate: Candidate;
  current: ExceptionItem;
  action: (payload: FormData) => void;
  pending: boolean;
  shortcut?: string;
  label: string;
  canManage: boolean;
}) {
  return (
    <article className="mt-2 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-lg font-semibold">{candidate.name}</h4>
          <p className="text-xs text-[var(--muted-foreground)]">{candidate.confidence}% comparison confidence</p>
        </div>
        {canManage ? (
          <form action={action}>
            <input type="hidden" name="reviewId" value={current.id} />
            <input type="hidden" name="resolution" value="LINK" />
            <input type="hidden" name="targetCustomerId" value={candidate.id} />
            <Button type="submit" disabled={pending} data-review-shortcut={shortcut}>
              {shortcut ? <kbd className="mr-2 rounded bg-white/20 px-1">{shortcut}</kbd> : null}{label}
            </Button>
          </form>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {candidate.comparisons.map((row) => (
          <div key={row.field} className={`rounded-lg border p-3 text-sm ${row.status === "MATCH" ? "border-emerald-200 bg-emerald-50" : row.status === "DIFFERENT" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex justify-between gap-2">
              <span className="font-medium">{row.field}</span>
              <span className={`text-xs font-semibold ${row.status === "MATCH" ? "text-emerald-700" : row.status === "DIFFERENT" ? "text-amber-700" : "text-slate-600"}`}>
                {row.status === "MISSING" ? "MISSING ON ONE SIDE" : row.status}
              </span>
            </div>
            <p className="mt-1 text-xs"><span className="text-[var(--muted-foreground)]">QuickBooks:</span> {row.quickBooks || "—"}</p>
            <p className="text-xs"><span className="text-[var(--muted-foreground)]">ContractorYou:</span> {row.contractorYou || "—"}</p>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em]">Properties</p>
        {candidate.properties.length ? (
          <ul className="mt-2 space-y-2 text-sm">
            {candidate.properties.map((property) => (
              <li key={property.id} className={`rounded-lg border px-3 py-2 ${property.matching ? "border-emerald-300 bg-emerald-50" : "border-[var(--border)]"}`}>
                {property.matching ? <span className="mr-2 text-xs font-semibold text-emerald-700">MATCHING PROPERTY</span> : null}
                {property.address}, {property.city}, {property.state} {property.zip}
                {property.isPrimary ? <span className="ml-2 text-xs text-[var(--muted-foreground)]">Primary</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-[var(--muted-foreground)]">No properties</p>}
      </div>
    </article>
  );
}

function DecisionForm({
  action,
  current,
  resolution,
  label,
  shortcut,
  pending,
}: {
  action: (payload: FormData) => void;
  current: ExceptionItem;
  resolution: "CREATE" | "NOT_DUPLICATE" | "IGNORE";
  label: string;
  shortcut: string;
  pending: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="reviewId" value={current.id} />
      <input type="hidden" name="resolution" value={resolution} />
      <Button type="submit" variant={resolution === "IGNORE" ? "outline" : "default"} className="w-full" disabled={pending} data-review-shortcut={shortcut}>
        <kbd className="mr-2 rounded bg-black/10 px-1">{shortcut.toUpperCase()}</kbd>{label}
      </Button>
    </form>
  );
}

function MergeFlagForm({ current }: { current: ExceptionItem }) {
  const [state, action, pending] = useActionState(flagQuickBooksMergeReviewAction, null as ActionResult | null);
  return (
    <section className="rounded-2xl border border-slate-300 bg-slate-50 p-4">
      <h3 className="font-medium">Separate merge review</h3>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">Flag a ContractorYou customer pair for later review. This does not merge anything or resolve this QuickBooks exception.</p>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="reviewId" value={current.id} />
        <label className="text-xs">Customer A
          <select name="customerAId" className="mt-1 block h-9 rounded-lg border border-[var(--border)] bg-white px-2" required>
            {current.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
        <label className="text-xs">Customer B
          <select name="customerBId" className="mt-1 block h-9 rounded-lg border border-[var(--border)] bg-white px-2" required>
            {current.candidates.slice().reverse().map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
        <Button type="submit" variant="outline" disabled={pending}>Flag for Merge</Button>
      </form>
      {state ? <p className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.ok ? state.message : state.error}</p> : null}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="text-[var(--muted-foreground)]">{label}</dt><dd className="font-medium">{value || "—"}</dd></div>;
}
