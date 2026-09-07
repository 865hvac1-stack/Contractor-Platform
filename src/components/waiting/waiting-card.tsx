"use client";

import Link from "next/link";
import type { WaitingCard } from "@/lib/waiting/types";
import { formatWaitingDate, relativeWaitingDay } from "@/lib/waiting/format";
import { ActionForm } from "@/components/action-form";
import { markPartArrivedAction } from "@/server/actions/waiting";

export function WaitingJobCard({
  card,
  timezone,
  onOpen,
  draggable,
  readyColumnId,
}: {
  card: WaitingCard;
  timezone: string;
  onOpen: (id: string) => void;
  draggable?: boolean;
  readyColumnId?: string | null;
}) {
  const ready = card.columnKind === "READY" || card.columnKey === "READY_TO_SCHEDULE";
  const updateDue = isUpdateDue(card);
  const daysLabel = card.daysWaiting === 1 ? "1 day" : `${card.daysWaiting} days`;

  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/waiting-record", card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={`rounded-2xl border bg-white p-3 text-left shadow-sm transition hover:border-[var(--cy-orange)]/50 ${
        ready ? "border-[var(--cy-orange)]/45" : "border-[var(--border)]"
      }`}
    >
      <button type="button" onClick={() => onOpen(card.id)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--cy-navy)]">{card.customerName}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{card.jobNumber}</p>
          </div>
          {card.priority === "HIGH" || card.priority === "URGENT" ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
              High priority
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {card.columnName} · {daysLabel}
        </p>
        <p className="mt-1 text-sm font-medium text-[var(--cy-navy)]">{card.waitingFor || card.reason}</p>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {card.expectedResolutionAt
            ? `Expected ${formatWaitingDate(card.expectedResolutionAt, timezone)}`
            : "No expected date"}
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Last update: {relativeWaitingDay(card.lastCustomerUpdateAt)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {ready ? (
            <span className="rounded-full bg-[var(--cy-orange)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--cy-orange)]">
              Ready to schedule
            </span>
          ) : null}
          {card.overdue || card.urgent ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
              Overdue
            </span>
          ) : null}
          {updateDue ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              Update due today
            </span>
          ) : null}
          {card.customerReplied ? (
            <span className="rounded-full bg-[var(--cy-navy)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Customer replied
            </span>
          ) : null}
          {card.communicationStatus === "FAILED" ? (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800">
              Update failed
            </span>
          ) : null}
        </div>
        {card.ownerName || card.technicianName ? (
          <p className="mt-2 truncate text-[11px] text-[var(--muted-foreground)]">
            Assigned: {card.ownerName || card.technicianName}
          </p>
        ) : null}
      </button>
      {ready ? (
        <Link
          href={`/jobs/${card.jobId}#schedule`}
          className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white"
        >
          Schedule
        </Link>
      ) : card.columnKey === "WAITING_ON_PART" && readyColumnId ? (
        <ActionForm action={markPartArrivedAction} className="mt-3">
          <input type="hidden" name="recordId" value={card.id} />
          <input type="hidden" name="toColumnId" value={readyColumnId} />
          <button
            type="submit"
            className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-[var(--cy-orange)] text-sm font-medium text-white"
          >
            Part Arrived
          </button>
        </ActionForm>
      ) : null}
    </div>
  );
}

function isUpdateDue(card: WaitingCard) {
  if (!card.communicationEnabled || !card.nextCustomerUpdateAt) return false;
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return card.nextCustomerUpdateAt <= end;
}
