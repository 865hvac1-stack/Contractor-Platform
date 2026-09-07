"use client";

import { useState } from "react";
import Link from "next/link";
import { formatWaitingDate, waitingSinceLabel } from "@/lib/waiting/format";
import { PutInWaitingForm, type WaitingColumnOption, type WaitingOwnerOption } from "@/components/waiting/put-in-waiting-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PartArrivedDialog } from "@/components/waiting/part-arrived-dialog";
import { SendUpdateDialog } from "@/components/waiting/send-update-dialog";

export function JobWaitingPanel({
  jobId,
  waiting,
  columns,
  owners,
  readyColumnId,
  timezone,
  canPlace,
}: {
  jobId: string;
  waiting: {
    id: string;
    reason: string;
    waitingFor?: string | null;
    enteredAt: Date;
    expectedResolutionAt: Date | null;
    columnKey: string;
    columnName: string;
    columnKind?: string;
  } | null;
  columns: WaitingColumnOption[];
  owners: WaitingOwnerOption[];
  readyColumnId?: string | null;
  timezone: string;
  canPlace: boolean;
}) {
  const [partOpen, setPartOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl tracking-tight">Waiting status</h2>
      {waiting ? (
        <div className="rounded-2xl border border-[var(--cy-orange)]/40 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Job status</p>
          <p className="mt-1 text-lg font-semibold text-[var(--cy-navy)]">{waiting.columnName}</p>
          <p className="text-sm">{waiting.waitingFor || waiting.reason}</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {waitingSinceLabel(waiting.enteredAt)}
            {waiting.expectedResolutionAt
              ? ` · Expected ${formatWaitingDate(waiting.expectedResolutionAt, timezone)}`
              : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/operations/waiting?record=${waiting.id}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
              View waiting record
            </Link>
            <Button type="button" variant="outline" className="h-10" onClick={() => setSendOpen(true)}>
              Send customer update
            </Button>
            {waiting.columnKey === "WAITING_ON_PART" && readyColumnId ? (
              <Button
                type="button"
                className="h-10 bg-[var(--cy-orange)] text-white hover:bg-[var(--cy-orange)]/90"
                onClick={() => setPartOpen(true)}
              >
                Part arrived
              </Button>
            ) : null}
            {waiting.columnKind === "READY" || waiting.columnKey === "READY_TO_SCHEDULE" ? (
              <Link href={`#schedule`} className={cn(buttonVariants(), "min-h-11")}>
                Schedule Now
              </Link>
            ) : null}
          </div>
          <PartArrivedDialog
            open={partOpen}
            onOpenChange={setPartOpen}
            recordId={waiting.id}
            customerName={waiting.waitingFor || waiting.reason}
            itemName={waiting.waitingFor || waiting.reason}
            communicationEnabled
          />
          <SendUpdateDialog
            open={sendOpen}
            onOpenChange={setSendOpen}
            recordId={waiting.id}
            customerName={waiting.waitingFor || waiting.reason}
          />
        </div>
      ) : canPlace ? (
        <details className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <summary className="cursor-pointer font-medium text-[var(--cy-navy)]">Put in waiting</summary>
          <div className="mt-4">
            <PutInWaitingForm columns={columns} owners={owners} defaultJobId={jobId} compact />
          </div>
        </details>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">This job is not on the Waiting Board.</p>
      )}
    </section>
  );
}
