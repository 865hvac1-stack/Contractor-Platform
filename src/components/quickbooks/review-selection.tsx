"use client";

import { createContext, useActionState, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bulkQuickBooksReviewAction } from "@/server/actions/quickbooks-sync-center";
import type { ActionResult } from "@/server/actions/auth";

const SelectionContext = createContext<{
  selected: Set<string>;
  toggle: (id: string) => void;
} | null>(null);

export function ReviewSelection({
  pageIds,
  confidenceFilter,
  safeExact,
  unsafeExact,
  safeNew,
  exactTotal,
  search,
  reason,
  differences,
  children,
}: {
  pageIds: string[];
  confidenceFilter?: string | null;
  safeExact: number;
  unsafeExact: number;
  safeNew: number;
  exactTotal: number;
  search?: string | null;
  reason?: string | null;
  differences?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [confirm, setConfirm] = useState<"exact" | "new" | null>(null);
  const [state, formAction, pending] = useActionState(
    bulkQuickBooksReviewAction,
    null as ActionResult | null
  );
  useEffect(() => {
    if (!state?.ok) return;
    setSelected(new Set());
    setAllFiltered(false);
    setConfirm(null);
    router.refresh();
  }, [state, router]);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectPage = () => {
    setAllFiltered(false);
    setSelected((current) =>
      pageIds.every((id) => current.has(id)) ? new Set() : new Set(pageIds)
    );
  };

  return (
    <SelectionContext.Provider value={{ selected, toggle }}>
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={selectPage}>
            {pageIds.every((id) => selected.has(id)) ? "Clear Page" : "Select Page"}
          </Button>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={allFiltered}
              onChange={(event) => setAllFiltered(event.target.checked)}
            />
            Select All Filtered Results
          </label>
          <span className="text-xs text-[var(--muted-foreground)]">
            {allFiltered ? "All filtered results selected" : `${selected.size} selected`}
          </span>
        </div>
        <form action={formAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="selectedIds" value={[...selected].join(",")} />
          <input type="hidden" name="allFiltered" value={String(allFiltered)} />
          <input type="hidden" name="confidenceFilter" value={confidenceFilter || ""} />
          <input type="hidden" name="search" value={search || ""} />
          <input type="hidden" name="reason" value={reason || ""} />
          <input type="hidden" name="differences" value={differences || ""} />
          <Button type="submit" size="sm" name="bulkAction" value="APPROVE_SELECTED" disabled={pending || (!allFiltered && !selected.size)}>
            Approve Selected
          </Button>
          <Button type="submit" size="sm" variant="outline" name="bulkAction" value="NOT_SAME_SELECTED" disabled={pending || (!allFiltered && !selected.size)}>
            Mark Not Same Customer
          </Button>
          <Button type="submit" size="sm" variant="outline" name="bulkAction" value="MANUAL_SELECTED" disabled={pending || (!allFiltered && !selected.size)}>
            Move to Manual Review
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {safeExact > 0 ? (
            <Button type="button" size="sm" onClick={() => setConfirm("exact")}>
              Approve Safe Exact Matches
            </Button>
          ) : null}
          {safeNew > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirm("new")}>
              Approve All Safe New Customers
            </Button>
          ) : null}
        </div>
        {state ? (
          <p className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`} role={state.ok ? "status" : "alert"}>
            {state.ok ? state.message : state.error}
          </p>
        ) : null}
      </div>

      {children}

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Confirm bulk approval">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="font-semibold text-[var(--cy-navy)]">
              {confirm === "exact" ? "Approve Safe Exact Matches" : "Approve All Safe New Customers"}
            </h3>
            {confirm === "exact" ? (
              <div className="mt-3 space-y-1 text-sm">
                <p>{exactTotal.toLocaleString()} proposed exact matches</p>
                <p className="text-emerald-700">{safeExact.toLocaleString()} qualify for safe approval</p>
                <p className="text-amber-700">{unsafeExact.toLocaleString()} contain conflicting information and remain in review</p>
              </div>
            ) : (
              <p className="mt-3 text-sm">
                {safeNew.toLocaleString()} records have no external-ID, exact email, exact phone, or strong duplicate collision.
              </p>
            )}
            <p className="mt-3 text-sm font-medium">
              This approves the Stage 1 plan only. It does not create, merge, overwrite, or import customers.
            </p>
            <form action={formAction} className="mt-4 flex justify-end gap-2">
              <input
                type="hidden"
                name="bulkAction"
                value={confirm === "exact" ? "APPROVE_SAFE_EXACT" : "APPROVE_SAFE_NEW"}
              />
              <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Approve Plan
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </SelectionContext.Provider>
  );
}

export function ReviewCheckbox({ id }: { id: string }) {
  const context = useContext(SelectionContext);
  if (!context) return null;
  return (
    <input
      type="checkbox"
      checked={context.selected.has(id)}
      onChange={() => context.toggle(id)}
      aria-label="Select review record"
      className="mt-1 size-4"
    />
  );
}
