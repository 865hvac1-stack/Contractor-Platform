"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AnalyzeQuickBooksState } from "@/server/actions/quickbooks-sync-center";
import { analyzeQuickBooksImportAction } from "@/server/actions/quickbooks-sync-center";

const initialState: AnalyzeQuickBooksState = null;

export function AnalyzeImportControl({
  resumeRunId,
  initialStatus,
}: {
  resumeRunId?: string | null;
  initialStatus?: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(analyzeQuickBooksImportAction, initialState);

  useEffect(() => {
    if (!state?.ok || (state.paused && state.autoContinue)) return;
    router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (!state?.ok || !state.paused || !state.autoContinue) return;
    const timer = window.setTimeout(() => formRef.current?.requestSubmit(), 800);
    return () => window.clearTimeout(timer);
  }, [state]);

  const active = pending || (state?.ok === true && state.paused && state.autoContinue);
  const runId = state?.ok ? state.runId : resumeRunId;
  const statusText = pending
    ? state?.ok
      ? `Analyzing ${state.progress.categoryLabel.toLowerCase()}…`
      : "Starting read-only analysis…"
    : state?.ok
      ? state.message
      : state?.error;

  return (
    <div className="min-w-56">
      <form ref={formRef} action={formAction}>
        {runId ? <input type="hidden" name="resumeRunId" value={runId} /> : null}
        <Button type="submit" size="sm" disabled={active} aria-busy={active}>
          {active ? "Analyzing QuickBooks…" : initialStatus === "PAUSED" ? "Continue Analyze Import" : "Analyze Import"}
        </Button>
      </form>
      {active || state ? (
        <div
          className={`mt-2 text-xs ${state && !state.ok ? "text-rose-700" : "text-[var(--muted-foreground)]"}`}
          role={state && !state.ok ? "alert" : "status"}
          aria-live="polite"
        >
          <p>{statusText}</p>
          {state?.ok ? (
            <>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-[var(--cy-orange)] transition-[width]"
                  style={{ width: `${state.progress.percent}%` }}
                />
              </div>
              <p className="mt-1">
                {state.progress.recordsExamined.toLocaleString()} of approximately{" "}
                {state.progress.totalAvailable.toLocaleString()} records examined · {state.progress.percent}%
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Read-only, batched, and resumable. No records are imported.
        </p>
      )}
    </div>
  );
}
