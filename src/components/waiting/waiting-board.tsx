"use client";

import { useMemo, useState } from "react";
import type { WaitingCard } from "@/lib/waiting/types";
import {
  waitingFocusCountLabel,
  waitingFocusEmptyMessage,
  waitingFocusTitle,
  type WaitingFocus,
} from "@/lib/waiting/focus";
import { WaitingJobCard } from "@/components/waiting/waiting-card";
import { WaitingTransitionDialog } from "@/components/waiting/transition-dialog";
import { WaitingDetailDrawer, type WaitingDetailPayload } from "@/components/waiting/detail-drawer";
import { AddWaitingJobDrawer } from "@/components/waiting/add-waiting-drawer";
import type { WaitingColumnOption, WaitingJobOption, WaitingOwnerOption } from "@/components/waiting/put-in-waiting-form";

type Column = WaitingColumnOption & { cards: WaitingCard[] };

const MOBILE_TABS: Array<{ match: (column: Column) => boolean; label: string }> = [
  { match: () => true, label: "All" },
  { match: (column) => column.key === "WAITING_ON_PART", label: "Parts" },
  { match: (column) => column.key === "WAITING_ON_WARRANTY", label: "Warranty" },
  { match: (column) => column.key === "WAITING_ON_CUSTOMER", label: "Customer" },
  { match: (column) => column.key === "WAITING_ON_APPROVAL", label: "Approval" },
  { match: (column) => column.key === "WAITING_ON_THIRD_PARTY", label: "Third party" },
  { match: (column) => column.kind === "READY" || column.key === "READY_TO_SCHEDULE", label: "Ready" },
];

export function WaitingBoard({
  columns,
  timezone,
  owners,
  jobs,
  details,
  initialRecordId,
  filters,
}: {
  columns: Column[];
  timezone: string;
  owners: WaitingOwnerOption[];
  jobs: WaitingJobOption[];
  details: WaitingDetailPayload[];
  initialRecordId?: string | null;
  filters: {
    q?: string;
    column?: string;
    owner?: string;
    overdue?: boolean;
    due?: boolean;
    focus?: WaitingFocus | null;
  };
}) {
  const [mobileTab, setMobileTab] = useState(0);
  const [openId, setOpenId] = useState<string | null>(initialRecordId ?? null);
  const [pending, setPending] = useState<{ card: WaitingCard; to: Column } | null>(null);
  const [adding, setAdding] = useState(false);

  const detailMap = useMemo(() => new Map(details.map((row) => [row.id, row])), [details]);
  const allCards = columns.flatMap((column) => column.cards);
  const readyColumn = columns.find((column) => column.kind === "READY" || column.key === "READY_TO_SCHEDULE");
  const mobileColumns =
    mobileTab === 0 ? columns : columns.filter((column) => MOBILE_TABS[mobileTab]?.match(column));
  const focus = filters.focus ?? null;
  const focused = Boolean(focus);

  return (
    <div className="space-y-3">
      <form
        method="get"
        className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-2 md:flex-row md:items-center md:gap-2 md:px-3 md:py-2"
      >
        {focus ? <input type="hidden" name="focus" value={focus} /> : null}
        {filters.due ? <input type="hidden" name="due" value="1" /> : null}
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Customer, job, phone, part, PO"
          className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 text-sm"
        />
        <select
          name="column"
          defaultValue={filters.column ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm md:w-40"
        >
          <option value="">Status</option>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
        <select
          name="owner"
          defaultValue={filters.owner ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm md:w-40"
        >
          <option value="">Owner</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-2 rounded-lg px-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} />
          Overdue
        </label>
        <button type="submit" className="h-10 rounded-lg bg-[var(--cy-navy)] px-3 text-sm font-medium text-white">
          Filter
        </button>
        <a href="/operations/waiting" className="h-10 content-center text-center text-sm text-[var(--muted-foreground)] underline md:px-1">
          Clear
        </a>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="h-10 shrink-0 rounded-lg bg-[var(--cy-orange)] px-4 text-sm font-semibold text-white md:ml-auto"
        >
          + Add Waiting Job
        </button>
      </form>

      {focused ? (
        <section className="space-y-3">
          <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--cy-navy)]">
                {waitingFocusTitle(focus)}
              </h2>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {waitingFocusCountLabel(focus, allCards.length)}
              </p>
            </div>
            <a
              href="/operations/waiting"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--cy-navy)] underline"
            >
              Clear Filter / View Full Board
            </a>
          </header>
          {allCards.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-white px-3 py-3 text-sm text-[var(--muted-foreground)]">
              {waitingFocusEmptyMessage(focus)}
            </p>
          ) : (
            <div className="grid gap-3 md:max-w-xl">
              {allCards.map((card) => (
                <WaitingJobCard
                  key={card.id}
                  card={card}
                  timezone={timezone}
                  onOpen={setOpenId}
                  readyColumnId={readyColumn?.id}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className={focused ? "hidden" : "md:hidden"}>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {MOBILE_TABS.map((tab, index) => {
            const count =
              index === 0
                ? allCards.length
                : columns.filter((column) => tab.match(column)).reduce((sum, column) => sum + column.cards.length, 0);
            return (
              <button
                key={tab.label}
                type="button"
                onClick={() => setMobileTab(index)}
                className={`h-11 shrink-0 rounded-full px-3 text-sm font-medium ${
                  mobileTab === index
                    ? "bg-[var(--cy-navy)] text-white"
                    : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
                }`}
              >
                {tab.label}
                <span className="ml-2 text-xs opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="space-y-3">
          {mobileColumns.map((column) => (
            <div key={column.id} className="space-y-2">
              {mobileTab === 0 ? (
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                  {column.name}
                </p>
              ) : null}
              {column.cards.map((card) => (
                <WaitingJobCard
                  key={card.id}
                  card={card}
                  timezone={timezone}
                  onOpen={setOpenId}
                  readyColumnId={readyColumn?.id}
                />
              ))}
              {column.cards.length === 0 ? <EmptyColumn name={column.name} kind={column.kind} /> : null}
            </div>
          ))}
        </div>
      </div>

      <div className={focused ? "hidden" : "-mx-3 hidden min-h-[62vh] gap-3 overflow-x-auto px-3 pb-4 md:flex"}>
        {columns.map((column) => {
          const ready = column.kind === "READY" || column.key === "READY_TO_SCHEDULE";
          return (
            <section
              key={column.id}
              className={`flex w-[300px] min-w-[280px] max-w-[340px] shrink-0 flex-col rounded-2xl p-2 ${
                ready ? "bg-[var(--cy-navy)]/6 ring-1 ring-[var(--cy-orange)]/35" : "bg-[var(--cy-gray)]/70"
              }`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const recordId = event.dataTransfer.getData("text/waiting-record");
                const card = allCards.find((row) => row.id === recordId);
                if (!card || card.columnId === column.id) return;
                setPending({ card, to: column });
              }}
            >
              <header className="flex items-start justify-between gap-2 px-2 py-2">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--cy-navy)]">{column.name}</h2>
                  {ready ? (
                    <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                      These can go back on the schedule.
                    </p>
                  ) : null}
                </div>
                <span className={`text-xs font-semibold ${ready ? "text-[var(--cy-orange)]" : "text-[var(--muted-foreground)]"}`}>
                  {column.cards.length}
                </span>
              </header>
              <div className="flex min-h-28 flex-1 flex-col gap-2">
                {column.cards.map((card) => (
                  <WaitingJobCard
                    key={card.id}
                    card={card}
                    timezone={timezone}
                    onOpen={setOpenId}
                    draggable
                    readyColumnId={readyColumn?.id}
                  />
                ))}
                {column.cards.length === 0 ? <EmptyColumn name={column.name} kind={column.kind} /> : null}
              </div>
            </section>
          );
        })}
      </div>

      <AddWaitingJobDrawer
        open={adding}
        onOpenChange={setAdding}
        columns={columns}
        owners={owners}
        jobs={jobs}
      />
      <WaitingTransitionDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        card={pending?.card ?? null}
        toColumn={pending?.to ?? null}
      />
      <WaitingDetailDrawer
        open={Boolean(openId)}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        detail={openId ? detailMap.get(openId) ?? null : null}
        columns={columns}
        owners={owners}
        timezone={timezone}
      />
    </div>
  );
}

function EmptyColumn({ name, kind }: { name: string; kind: string }) {
  const ready = kind === "READY";
  return (
    <p className="rounded-xl border border-dashed border-[var(--border)] bg-white/70 px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">
      {ready ? "No jobs ready to schedule." : `No jobs ${name.toLowerCase()}.`}
    </p>
  );
}
