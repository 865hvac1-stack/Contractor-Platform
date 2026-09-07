import Link from "next/link";
import { formatWaitingDate, waitingSinceLabel } from "@/lib/waiting/format";
import { PutInWaitingForm, type WaitingColumnOption, type WaitingOwnerOption } from "@/components/waiting/put-in-waiting-form";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markPartArrivedAction, sendWaitingUpdateNowAction } from "@/server/actions/waiting";

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
  } | null;
  columns: WaitingColumnOption[];
  owners: WaitingOwnerOption[];
  readyColumnId?: string | null;
  timezone: string;
  canPlace: boolean;
}) {
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
            <ActionForm action={sendWaitingUpdateNowAction}>
              <input type="hidden" name="recordId" value={waiting.id} />
              <Button type="submit" variant="outline" className="h-10">
                Send customer update
              </Button>
            </ActionForm>
            {waiting.columnKey === "WAITING_ON_PART" && readyColumnId ? (
              <ActionForm action={markPartArrivedAction}>
                <input type="hidden" name="recordId" value={waiting.id} />
                <input type="hidden" name="toColumnId" value={readyColumnId} />
                <Button type="submit" className="h-10 bg-[var(--cy-orange)] text-white hover:bg-[var(--cy-orange)]/90">
                  Part arrived
                </Button>
              </ActionForm>
            ) : null}
          </div>
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
