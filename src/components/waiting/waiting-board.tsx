"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WaitingCard } from "@/lib/waiting/types";
import { WaitingJobCard } from "@/components/waiting/waiting-card";
import { WaitingTransitionDialog } from "@/components/waiting/transition-dialog";
import { WaitingDetailDrawer, type WaitingDetailPayload } from "@/components/waiting/detail-drawer";
import { PutInWaitingForm, type WaitingColumnOption, type WaitingJobOption, type WaitingOwnerOption } from "@/components/waiting/put-in-waiting-form";
import { Button } from "@/components/ui/button";

type Column = WaitingColumnOption & { cards: WaitingCard[] };

export function WaitingBoard({
  columns,
  timezone,
  owners,
  jobs,
  details,
  initialRecordId,
}: {
  columns: Column[];
  timezone: string;
  owners: WaitingOwnerOption[];
  jobs: WaitingJobOption[];
  details: WaitingDetailPayload[];
  initialRecordId?: string | null;
}) {
  const router = useRouter();
  const [mobileColumn, setMobileColumn] = useState(columns[0]?.id ?? "");
  const [openId, setOpenId] = useState<string | null>(initialRecordId ?? null);
  const [pending, setPending] = useState<{ card: WaitingCard; to: Column } | null>(null);
  const [adding, setAdding] = useState(false);

  const detailMap = useMemo(() => new Map(details.map((row) => [row.id, row])), [details]);
  const allCards = columns.flatMap((column) => column.cards);
  const openCard = allCards.find((card) => card.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" className="h-10" onClick={() => setAdding((value) => !value)}>
          {adding ? "Close" : "Put a job in waiting"}
        </Button>
        <button type="button" className="text-sm text-[var(--muted-foreground)] underline" onClick={() => router.refresh()}>
          Refresh
        </button>
      </div>

      {adding ? (
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <PutInWaitingForm columns={columns} owners={owners} jobs={jobs} />
        </div>
      ) : null}

      <div className="md:hidden">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {columns.map((column) => (
            <button
              key={column.id}
              type="button"
              onClick={() => setMobileColumn(column.id)}
              className={`h-10 shrink-0 rounded-full px-3 text-sm font-medium ${
                mobileColumn === column.id
                  ? "bg-[var(--cy-navy)] text-white"
                  : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
              }`}
            >
              {column.name}
              <span className="ml-2 text-xs opacity-70">{column.cards.length}</span>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {(columns.find((column) => column.id === mobileColumn)?.cards ?? []).map((card) => (
            <WaitingJobCard key={card.id} card={card} timezone={timezone} onOpen={setOpenId} />
          ))}
          {(columns.find((column) => column.id === mobileColumn)?.cards ?? []).length === 0 ? (
            <EmptyColumn />
          ) : null}
        </div>
        <label className="mt-4 block rounded-2xl border border-[var(--border)] bg-white p-3">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Change status</span>
          <select
            className="mt-2 h-12 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-base"
            defaultValue=""
            onChange={(event) => {
              const card = columns.find((column) => column.id === mobileColumn)?.cards[0];
              const to = columns.find((column) => column.id === event.target.value);
              if (card && to) setPending({ card, to });
              event.currentTarget.value = "";
            }}
          >
            <option value="">Move the selected job…</option>
            {openCard
              ? columns
                  .filter((column) => column.id !== openCard.columnId)
                  .map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))
              : null}
          </select>
          {openCard ? (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Selected: {openCard.customerName}. Open a card first, then change status.
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">Open a card, then use this control to change status.</p>
          )}
        </label>
      </div>

      <div className="hidden min-h-[60vh] gap-3 overflow-x-auto pb-4 md:flex">
        {columns.map((column) => (
          <section
            key={column.id}
            className="flex w-72 shrink-0 flex-col rounded-2xl bg-[var(--cy-gray)]/70 p-2"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const recordId = event.dataTransfer.getData("text/waiting-record");
              const card = allCards.find((row) => row.id === recordId);
              if (!card || card.columnId === column.id) return;
              setPending({ card, to: column });
            }}
          >
            <header className="flex items-center justify-between px-2 py-2">
              <h2 className="text-sm font-semibold text-[var(--cy-navy)]">{column.name}</h2>
              <span className="text-xs text-[var(--muted-foreground)]">{column.cards.length}</span>
            </header>
            <div className="flex min-h-32 flex-1 flex-col gap-2">
              {column.cards.map((card) => (
                <WaitingJobCard key={card.id} card={card} timezone={timezone} onOpen={setOpenId} draggable />
              ))}
              {column.cards.length === 0 ? <EmptyColumn /> : null}
            </div>
          </section>
        ))}
      </div>

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

function EmptyColumn() {
  return (
    <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
      Nobody is waiting here.
    </p>
  );
}
