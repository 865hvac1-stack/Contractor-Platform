"use client";

import { useState } from "react";
import Link from "next/link";
import type { WaitingCard } from "@/lib/waiting/types";
import { formatWaitingDate, relativeWaitingDay } from "@/lib/waiting/format";
import { isWaitingUpdateDueToday } from "@/lib/waiting/focus";
import { PartArrivedDialog } from "@/components/waiting/part-arrived-dialog";
import { SendUpdateDialog } from "@/components/waiting/send-update-dialog";
import { UpdateFailedDialog } from "@/components/waiting/update-failed-dialog";

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
  const updateDue = isWaitingUpdateDueToday(card);
  const daysLabel = card.daysWaiting === 1 ? "1 day" : `${card.daysWaiting} days`;
  const [partOpen, setPartOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const itemName = card.waitingFor || card.reason;

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
        <p className="mt-1 text-sm font-medium text-[var(--cy-navy)]">{itemName}</p>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {ready && card.actualArrivalAt
            ? `Part arrived ${formatWaitingDate(card.actualArrivalAt, timezone)}`
            : card.expectedResolutionAt
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
        </div>
        {card.ownerName || card.technicianName ? (
          <p className="mt-2 truncate text-[11px] text-[var(--muted-foreground)]">
            Assigned: {card.ownerName || card.technicianName}
          </p>
        ) : null}
      </button>
      {card.communicationStatus === "FAILED" ? (
        <button
          type="button"
          onClick={() => setFailedOpen(true)}
          className="mt-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800"
        >
          Update failed
        </button>
      ) : null}
      {ready ? (
        <div className="mt-3 space-y-2">
          <Link
            href={`/jobs/${card.jobId}#schedule`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white"
          >
            Schedule Now
          </Link>
          <div className="flex gap-2">
            <Link
              href={`/jobs/${card.jobId}`}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--cy-navy)]"
            >
              Open Job
            </Link>
            <Link
              href={`/customers/${card.customerId}`}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--cy-navy)]"
            >
              Open Customer
            </Link>
          </div>
        </div>
      ) : card.columnKey === "WAITING_ON_PART" && readyColumnId ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => setPartOpen(true)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--cy-orange)] text-sm font-medium text-white"
          >
            Part Arrived
          </button>
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="inline-flex h-8 w-full items-center justify-center text-xs font-medium text-[var(--cy-navy)] underline"
          >
            Send update now
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSendOpen(true)}
          className="mt-3 inline-flex h-8 w-full items-center justify-center text-xs font-medium text-[var(--cy-navy)] underline"
        >
          Send update now
        </button>
      )}
      <PartArrivedDialog
        open={partOpen}
        onOpenChange={setPartOpen}
        recordId={card.id}
        customerName={card.customerName}
        itemName={itemName}
        communicationEnabled={card.communicationEnabled}
      />
      <SendUpdateDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        recordId={card.id}
        customerName={card.customerName}
      />
      <UpdateFailedDialog
        open={failedOpen}
        onOpenChange={setFailedOpen}
        customerName={card.customerName}
        attemptedAt={card.lastFailedAt}
        provider={card.lastProvider}
        reason={card.communicationError}
        timezone={timezone}
        onRetry={() => setSendOpen(true)}
      />
    </div>
  );
}
