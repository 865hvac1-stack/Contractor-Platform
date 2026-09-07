"use client";

import type { WaitingCard } from "@/lib/waiting/types";
import { formatWaitingDate, relativeWaitingDay, waitingSinceLabel } from "@/lib/waiting/format";

export function WaitingJobCard({
  card,
  timezone,
  onOpen,
  draggable,
}: {
  card: WaitingCard;
  timezone: string;
  onOpen: (id: string) => void;
  draggable?: boolean;
}) {
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/waiting-record", card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(card.id)}
      className="w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-left shadow-sm transition hover:border-[var(--cy-orange)]/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--cy-navy)]">{card.customerName}</p>
          <p className="text-xs text-[var(--muted-foreground)]">{card.jobNumber}</p>
        </div>
        <PriorityDot priority={card.priority} overdue={card.overdue || card.urgent} />
      </div>
      {card.address ? <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">{card.address}</p> : null}
      <p className="mt-2 text-sm font-medium">{card.waitingFor || card.reason}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
        <div>{waitingSinceLabel(card.enteredAt)}</div>
        <div>
          {card.expectedResolutionAt
            ? `Expected ${formatWaitingDate(card.expectedResolutionAt, timezone)}`
            : "No expected date"}
        </div>
        <div>Last update: {relativeWaitingDay(card.lastCustomerUpdateAt)}</div>
        <div>
          Next:{" "}
          {card.communicationEnabled && card.nextCustomerUpdateAt
            ? relativeWaitingDay(card.nextCustomerUpdateAt)
            : "—"}
        </div>
      </dl>
      <div className="mt-2 flex flex-wrap gap-1">
        {card.overdue || card.urgent ? (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
            Overdue
          </span>
        ) : card.warning ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            Watch
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
        ) : card.communicationEnabled ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
            Updates on
          </span>
        ) : (
          <span className="rounded-full bg-[var(--cy-gray)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Manual
          </span>
        )}
        {card.technicianName ? (
          <span className="truncate text-[10px] text-[var(--muted-foreground)]">Tech {card.technicianName}</span>
        ) : null}
        {card.ownerName ? (
          <span className="truncate text-[10px] text-[var(--muted-foreground)]">Office {card.ownerName}</span>
        ) : null}
      </div>
    </button>
  );
}

function PriorityDot({ priority, overdue }: { priority: string; overdue: boolean }) {
  const color = overdue
    ? "bg-rose-500"
    : priority === "URGENT"
      ? "bg-rose-500"
      : priority === "HIGH"
        ? "bg-[var(--cy-orange)]"
        : "bg-slate-300";
  return <span className={`mt-1 inline-block size-2.5 rounded-full ${color}`} title={priority} />;
}
