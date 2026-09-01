"use client";

import { useTransition } from "react";
import { prepareDispatchMessageAction } from "@/server/actions/action-engine";
import type { DispatchCard, DispatchIssue } from "@/lib/dispatch/types";

const KIND_LABEL: Record<string, string> = {
  running_late: "Running late",
  conflict: "Schedule conflict",
  unassigned: "Unassigned",
  emergency: "Emergency",
  missing_technician: "Missing technician",
  missing_contact: "Missing contact info",
  missing_address: "Missing address",
};

export function DispatchIssuesPanel({
  issues,
  jobs,
  onSelectJob,
}: {
  issues: DispatchIssue[];
  jobs: DispatchCard[];
  onSelectJob: (jobId: string) => void;
}) {
  const [pending, start] = useTransition();
  if (issues.length === 0) {
    return <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">No dispatch issues right now.</p>;
  }
  const groups = new Map<string, DispatchIssue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.kind) ?? [];
    list.push(issue);
    groups.set(issue.kind, list);
  }
  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 pb-4">
      {[...groups.entries()].map(([kind, rows]) => (
        <section key={kind}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">
            {KIND_LABEL[kind] || kind} · {rows.length}
          </h3>
          <ul className="mt-2 space-y-2">
            {rows.map((issue) => {
              const job = issue.jobId ? jobs.find((row) => row.id === issue.jobId) : undefined;
              return (
                <li key={issue.id} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2">
                  <p className="text-sm font-medium text-[var(--cy-navy)]">{issue.title}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{issue.subtitle}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {issue.jobId ? (
                      <button
                        type="button"
                        className="rounded-md bg-[var(--cy-navy)] px-2.5 py-1 text-xs font-medium text-white"
                        onClick={() => onSelectJob(issue.jobId!)}
                      >
                        View job
                      </button>
                    ) : null}
                    {kind === "running_late" && job?.customerId && job.phone ? (
                      <button
                        type="button"
                        className="rounded-md border px-2.5 py-1 text-xs font-medium"
                        disabled={pending}
                        onClick={() => {
                          start(async () => {
                            const result = await prepareDispatchMessageAction(job.customerId);
                            if (result.ok && result.request) window.location.href = `/actions/${result.request.id}`;
                          });
                        }}
                      >
                        Prepare customer update
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
