"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { kindFromRequest, kindLabel } from "@/lib/actions/kind";
import type { PublicActionRequest, PublicActionTarget } from "@/lib/actions/types";
import {
  approveActionRequestAction,
  cancelActionRequestAction,
  retryFailedActionAction,
  updateActionTargetsAction,
} from "@/server/actions/action-engine";

const kindTone: Record<string, string> = {
  ANSWER: "bg-white/10 text-white/80",
  INSIGHT: "bg-sky-500/20 text-sky-100",
  DRAFT: "bg-amber-500/20 text-amber-50",
  ACTION_REQUIRES_APPROVAL: "bg-[var(--cy-orange)] text-white",
  ACTION_COMPLETED: "bg-emerald-500/20 text-emerald-50",
  ACTION_FAILED: "bg-rose-500/20 text-rose-50",
};

export function KindBadge({ kind }: { kind?: string | null }) {
  const label = kindLabel(kind);
  const tone = kindTone[kind || "ANSWER"] || kindTone.ANSWER;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
      {label}
    </span>
  );
}

export function ActionCard({
  request: initial,
  compact = false,
  onNavy = true,
}: {
  request: PublicActionRequest;
  compact?: boolean;
  onNavy?: boolean;
}) {
  const [request, setRequest] = useState(initial);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const kind = kindFromRequest(request.status);
  const pendingTargets = request.targets.filter((target) => target.status === "PENDING");
  const opportunity = useMemo(
    () => pendingTargets.reduce((sum, target) => sum + (target.amountCents ?? 0), 0),
    [pendingTargets]
  );
  const awaiting = request.status === "AWAITING_APPROVAL" || request.status === "DRAFT";
  const surface = onNavy
    ? "border-white/15 bg-white/8 text-white"
    : "border-[var(--border)] bg-white text-[var(--cy-navy)]";

  function run(task: () => Promise<{ ok: boolean; error?: string; request?: PublicActionRequest | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error || "That action could not be completed.");
        if (result.request) setRequest(result.request);
        return;
      }
      if (result.request) setRequest(result.request);
    });
  }

  return (
    <article className={`rounded-2xl border p-4 ${surface}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">{request.title}</p>
          <p className={`mt-1 text-sm ${onNavy ? "text-white/80" : "text-[var(--muted-foreground)]"}`}>{request.summary}</p>
        </div>
        <KindBadge kind={kind} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className={onNavy ? "text-white/45" : "text-[var(--muted-foreground)]"}>Targets</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{awaiting ? pendingTargets.length : request.targetCount}</dd>
        </div>
        {opportunity > 0 || request.estimatedImpactCents ? (
          <div>
            <dt className={onNavy ? "text-white/45" : "text-[var(--muted-foreground)]"}>Dollar impact</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">
              {formatMoney(awaiting ? opportunity : request.estimatedImpactCents || opportunity)}
            </dd>
          </div>
        ) : null}
      </dl>

      {awaiting ? (
        <p className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-xs font-medium text-[var(--cy-orange)]">
          DRAFT — NOTHING HAS BEEN SENT
        </p>
      ) : null}
      {request.executionMode === "demo" ? (
        <p className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-xs font-medium text-amber-100">
          DEMO MODE. No external action was performed.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-rose-200" role="alert">
          {error}
        </p>
      ) : null}

      {reviewing ? (
        <div className="mt-4 space-y-3">
          {request.targets.map((target) => (
            <TargetEditor
              key={target.id}
              target={target}
              onNavy={onNavy}
              disabled={!awaiting || pending}
              onExclude={() => run(() => updateActionTargetsAction({ requestId: request.id, excludeIds: [target.id] }))}
              onInclude={() => run(() => updateActionTargetsAction({ requestId: request.id, includeIds: [target.id] }))}
              onSave={(draftMessage) =>
                run(() => updateActionTargetsAction({ requestId: request.id, edits: [{ targetId: target.id, draftMessage }] }))
              }
            />
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {request.targets.length > 0 ? (
          <Button
            type="button"
            variant={onNavy ? "secondary" : "outline"}
            className="h-11 min-h-11 flex-1"
            onClick={() => setReviewing((value) => !value)}
          >
            {reviewing ? "Hide messages" : `Review ${pendingTargets.length || request.targets.length} messages`}
          </Button>
        ) : null}
        {awaiting ? (
          <Button
            type="button"
            className="h-11 min-h-11 flex-1"
            disabled={pending || pendingTargets.length === 0}
            onClick={() => run(() => approveActionRequestAction(request.id))}
          >
            {pending ? "Working…" : `Approve & ${request.actionKey.includes("assign") ? "assign" : request.actionKey.includes("task") ? "create" : request.actionKey.includes("social") ? "schedule" : "send"} ${pendingTargets.length}`}
          </Button>
        ) : null}
        {awaiting ? (
          <Button
            type="button"
            variant="ghost"
            className={`h-11 ${onNavy ? "text-white/70" : ""}`}
            disabled={pending}
            onClick={() => run(() => cancelActionRequestAction(request.id))}
          >
            Cancel
          </Button>
        ) : null}
        {request.status === "FAILED" || request.status === "PARTIALLY_COMPLETED" ? (
          <Button type="button" className="h-11 flex-1" disabled={pending} onClick={() => run(() => retryFailedActionAction(request.id))}>
            Retry failed
          </Button>
        ) : null}
      </div>

      {!compact ? (
        <p className="mt-3">
          <Link href={`/actions/${request.id}`} className="text-xs text-[var(--cy-orange)]">
            Open in Action Center
          </Link>
        </p>
      ) : null}
    </article>
  );
}

function TargetEditor({
  target,
  onNavy,
  disabled,
  onExclude,
  onInclude,
  onSave,
}: {
  target: PublicActionTarget;
  onNavy: boolean;
  disabled: boolean;
  onExclude: () => void;
  onInclude: () => void;
  onSave: (message: string) => void;
  }) {
  const [message, setMessage] = useState(target.draftMessage || "");
  const excluded = target.status === "EXCLUDED";
  return (
    <div className={`rounded-xl border p-3 ${onNavy ? "border-white/10 bg-black/15" : "border-[var(--border)] bg-[var(--cy-gray)]"} ${excluded ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{target.customerName || target.recordType}</p>
          <p className={`text-xs ${onNavy ? "text-white/50" : "text-[var(--muted-foreground)]"}`}>
            {[
              target.amountCents ? formatMoney(target.amountCents) : null,
              target.daysValue != null ? `${target.daysValue} days` : null,
              target.recipient,
              target.reason,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide">{target.status.replaceAll("_", " ")}</span>
      </div>
      {target.draftMessage != null ? (
        <textarea
          value={message}
          disabled={disabled || excluded}
          onChange={(event) => setMessage(event.target.value)}
          onBlur={() => {
            if (message !== (target.draftMessage || "")) onSave(message);
          }}
          className={`mt-2 min-h-24 w-full rounded-lg border px-3 py-2 text-sm ${
            onNavy ? "border-white/10 bg-white/8 text-white" : "border-[var(--border)] bg-white"
          }`}
        />
      ) : null}
      {target.skipReason ? <p className="mt-2 text-xs text-amber-200">{target.skipReason}</p> : null}
      {target.failureReason ? <p className="mt-2 text-xs text-rose-200">{target.failureReason}</p> : null}
      {!disabled ? (
        <div className="mt-2">
          {excluded ? (
            <button type="button" className="text-xs text-[var(--cy-orange)]" onClick={onInclude}>
              Include again
            </button>
          ) : (
            <button type="button" className="text-xs text-[var(--cy-orange)]" onClick={onExclude}>
              Exclude
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
