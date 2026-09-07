"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { transitionWaitingAction } from "@/server/actions/waiting";
import type { WaitingCard } from "@/lib/waiting/types";

export function WaitingTransitionDialog({
  open,
  onOpenChange,
  card,
  toColumn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: WaitingCard | null;
  toColumn: { id: string; name: string; key: string; kind: string } | null;
}) {
  if (!card || !toColumn) return null;
  const ready = toColumn.kind === "READY" || toColumn.key === "READY_TO_SCHEDULE";
  const partArrived = card.columnKey === "WAITING_ON_PART" && ready;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Move {card.customerName} to {toColumn.name}?
          </DialogTitle>
          <DialogDescription>
            This is a real workflow transition, not just a column change.
          </DialogDescription>
        </DialogHeader>
        <ActionForm action={transitionWaitingAction} className="space-y-3">
          <input type="hidden" name="recordId" value={card.id} />
          <input type="hidden" name="toColumnId" value={toColumn.id} />
          {partArrived ? <input type="hidden" name="markPartArrived" value="yes" /> : null}
          {partArrived ? (
            <ul className="space-y-1.5 text-sm">
              {[
                "Mark part as arrived",
                'Stop all future "waiting on part" updates',
                "Move job to Ready to Schedule",
                "Create scheduling action",
                "Notify assigned office user",
                "Add Job 360 and Customer 360 events",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-emerald-700">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Toggle name="stopUpdates" label="Stop waiting updates" defaultOn />
          <Toggle
            name="notifyCustomer"
            label={partArrived ? "Notify customer the part has arrived" : "Notify customer of this change"}
            defaultOn={ready}
          />
          <Toggle name="createSchedulingTask" label="Create scheduling task" defaultOn={ready} />
          <Button type="submit" className="h-11 w-full bg-[var(--cy-navy)] text-white">
            {partArrived ? "Part Arrived — Move to Ready to Schedule" : "Confirm move"}
          </Button>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ name, label, defaultOn }: { name: string; label: string; defaultOn?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/40 px-3 py-2 text-sm">
      <span>{label}</span>
      <select name={name} defaultValue={defaultOn ? "yes" : "no"} className="h-8 rounded-md border border-[var(--border)] bg-white px-2 text-xs">
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}
