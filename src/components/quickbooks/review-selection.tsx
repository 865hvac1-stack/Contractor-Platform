"use client";

import { createContext, useActionState, useContext, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bulkQuickBooksReviewAction } from "@/server/actions/quickbooks-sync-center";
import type { ActionResult } from "@/server/actions/auth";

const SelectionContext = createContext<{
  selected: Set<string>;
  allFiltered: boolean;
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
  reviewed,
  filteredTotal,
  analysisRunId,
  initialSelectionMode,
  filterKey,
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
  reviewed?: string | null;
  filteredTotal: number;
  analysisRunId: string;
  initialSelectionMode?: "ALL_FILTERED" | "NONE";
  filterKey: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState<"NONE" | "PAGE" | "ALL_FILTERED">(
    initialSelectionMode ?? "NONE"
  );
  const [confirm, setConfirm] = useState<"exact" | "new" | null>(null);
  const [state, formAction, pending] = useActionState(
    bulkQuickBooksReviewAction,
    null as ActionResult | null
  );
  useEffect(() => {
    if (!state?.ok) return;
    setSelected(new Set());
    setSelectionMode("NONE");
    setConfirm(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("selection");
    router.replace(`${pathname}?${params.toString()}`);
    router.refresh();
  }, [state, router, pathname, searchParams]);
  useEffect(() => {
    setSelected(new Set());
    setSelectionMode(initialSelectionMode ?? "NONE");
  }, [filterKey, initialSelectionMode]);
  useEffect(() => {
    setSelected((current) => (current.size ? new Set() : current));
  }, [pageIds]); // Page IDs are stable server props; ALL_FILTERED uses no browser ID set.
  const setUrlSelection = (mode: "ALL_FILTERED" | "NONE") => {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "ALL_FILTERED") params.set("selection", "all");
    else params.delete("selection");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const toggle = (id: string) => {
    if (selectionMode === "ALL_FILTERED") {
      setSelectionMode("PAGE");
      setUrlSelection("NONE");
      setSelected(new Set(pageIds.filter((pageId) => pageId !== id)));
      return;
    }
    setSelectionMode("PAGE");
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectPage = () => {
    setUrlSelection("NONE");
    setSelectionMode("PAGE");
    setSelected((current) =>
      selectionMode === "PAGE" && pageIds.every((id) => current.has(id)) ? new Set() : new Set(pageIds)
    );
  };
  const selectAllFiltered = () => {
    setSelected(new Set());
    setSelectionMode("ALL_FILTERED");
    setUrlSelection("ALL_FILTERED");
  };
  const clearSelection = () => {
    setSelected(new Set());
    setSelectionMode("NONE");
    setUrlSelection("NONE");
  };
  const selectedCount = selectionMode === "ALL_FILTERED" ? filteredTotal : selected.size;
  const allFiltered = selectionMode === "ALL_FILTERED";

  return (
    <SelectionContext.Provider value={{ selected, allFiltered, toggle }}>
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={selectPage}>
            Select Page
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={selectAllFiltered}>
            Select All Filtered Results
          </Button>
          {selectedCount ? (
            <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>Clear Selection</Button>
          ) : null}
          <span className="text-xs text-[var(--muted-foreground)]">
            {allFiltered
              ? `${filteredTotal.toLocaleString()} filtered results selected`
              : `${selected.size.toLocaleString()} selected`}
          </span>
        </div>
        <form action={formAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="selectedIds" value={[...selected].join(",")} />
          <input type="hidden" name="selectionMode" value={selectionMode} />
          <input type="hidden" name="analysisRunId" value={analysisRunId} />
          <input type="hidden" name="confidenceFilter" value={confidenceFilter || ""} />
          <input type="hidden" name="search" value={search || ""} />
          <input type="hidden" name="reason" value={reason || ""} />
          <input type="hidden" name="differences" value={differences || ""} />
          <input type="hidden" name="reviewed" value={reviewed || ""} />
          <Button type="submit" size="sm" name="bulkAction" value="APPROVE_SELECTED" disabled={pending || !selectedCount}>
            Approve Selected
          </Button>
          <Button type="submit" size="sm" variant="outline" name="bulkAction" value="NOT_SAME_SELECTED" disabled={pending || !selectedCount}>
            Mark Not Same Customer
          </Button>
          <Button type="submit" size="sm" variant="outline" name="bulkAction" value="MANUAL_SELECTED" disabled={pending || !selectedCount}>
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
              <input type="hidden" name="analysisRunId" value={analysisRunId} />
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
      checked={context.allFiltered || context.selected.has(id)}
      onChange={() => context.toggle(id)}
      aria-label="Select review record"
      className="mt-1 size-4"
    />
  );
}
