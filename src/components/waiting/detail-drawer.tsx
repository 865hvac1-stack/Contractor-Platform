"use client";

import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CADENCE_LABELS } from "@/lib/waiting/defaults";
import { formatWaitingDate, relativeWaitingDay, waitingSinceLabel } from "@/lib/waiting/format";
import { parseWaitingMetadata } from "@/lib/waiting/types";
import {
  addWaitingNoteAction,
  resolveWaitingAction,
  transitionWaitingAction,
  updateWaitingDetailsAction,
} from "@/server/actions/waiting";
import { PartArrivedDialog } from "@/components/waiting/part-arrived-dialog";
import { SendUpdateDialog } from "@/components/waiting/send-update-dialog";
import { UpdateFailedDialog } from "@/components/waiting/update-failed-dialog";
import { sanitizeWaitingFailureReason } from "@/lib/waiting/safety";
import type { WaitingCadence } from "@prisma/client";
import { useState } from "react";

export type WaitingDetailPayload = {
  id: string;
  jobId: string;
  customerId: string;
  reason: string;
  notes: string | null;
  enteredAt: string;
  expectedResolutionAt: string | null;
  lastCustomerUpdateAt: string | null;
  nextCustomerUpdateAt: string | null;
  actualArrivalAt: string | null;
  customerRepliedAt: string | null;
  communicationEnabled: boolean;
  automationEnabled: boolean;
  cadence: WaitingCadence;
  customCadenceDays: number | null;
  lastCommunicationStatus: string | null;
  lastCommunicationError: string | null;
  assignedOwnerUserId: string | null;
  metadata: unknown;
  column: { id: string; key: string; name: string; kind: string };
  customer: { firstName: string; lastName: string; businessName: string | null; phone: string | null };
  job: { jobNumber: string; status: string };
  property: { address: string; city: string; state: string; zip: string } | null;
  assignedOwner: { firstName: string; lastName: string } | null;
  transitions: Array<{
    id: string;
    createdAt: string;
    note: string | null;
    fromColumn: { name: string } | null;
    toColumn: { name: string };
    actor: { firstName: string; lastName: string } | null;
  }>;
  communications: Array<{
    id: string;
    kind: string;
    sentAt: string | null;
    failedAt: string | null;
    attemptedAt?: string | null;
    failureReason: string | null;
    provider: string | null;
    body: string;
  }>;
};

export function WaitingDetailDrawer({
  open,
  onOpenChange,
  detail,
  columns,
  owners,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: WaitingDetailPayload | null;
  columns: Array<{ id: string; key: string; name: string; kind: string }>;
  owners: Array<{ id: string; name: string }>;
  timezone: string;
}) {
  const [partOpen, setPartOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  if (!detail) return null;
  const meta = parseWaitingMetadata(detail.metadata);
  const name = detail.customer.businessName?.trim() || `${detail.customer.firstName} ${detail.customer.lastName}`.trim();
  const readyColumn = columns.find((column) => column.kind === "READY" || column.key === "READY_TO_SCHEDULE");
  const itemName = meta.waitingFor || meta.part?.name || detail.reason;
  const lastFailed = detail.communications.find((row) => row.failedAt);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{name}</SheetTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            {detail.job.jobNumber} · {detail.column.name}
          </p>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-8">
          <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
              Waiting overview
            </p>
            <p className="mt-2 text-sm font-medium">{meta.waitingFor || meta.part?.name || detail.reason}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-[var(--muted-foreground)]">Customer</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Job</dt>
                <dd>{detail.job.jobNumber}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[var(--muted-foreground)]">Property</dt>
                <dd>
                  {detail.property
                    ? `${detail.property.address}, ${detail.property.city}, ${detail.property.state}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Waiting since</dt>
                <dd>{waitingSinceLabel(new Date(detail.enteredAt))}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Expected</dt>
                <dd>
                  {detail.expectedResolutionAt
                    ? formatWaitingDate(new Date(detail.expectedResolutionAt), timezone)
                    : "Not entered"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Last update</dt>
                <dd>{relativeWaitingDay(detail.lastCustomerUpdateAt ? new Date(detail.lastCustomerUpdateAt) : null)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Next update</dt>
                <dd>{relativeWaitingDay(detail.nextCustomerUpdateAt ? new Date(detail.nextCustomerUpdateAt) : null)}</dd>
              </div>
            </dl>
            {detail.customerRepliedAt ? (
              <p className="mt-3 rounded-lg bg-[var(--cy-navy)] px-3 py-2 text-xs text-white">
                Customer replied. The wait is not automatically resolved.
              </p>
            ) : null}
            {detail.lastCommunicationStatus === "FAILED" ? (
              <button
                type="button"
                onClick={() => setFailedOpen(true)}
                className="mt-3 w-full rounded-lg bg-rose-50 px-3 py-2 text-left text-xs text-rose-800"
              >
                UPDATE FAILED · {sanitizeWaitingFailureReason(detail.lastCommunicationError)}
              </button>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2">
            <Link href={`/jobs/${detail.jobId}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
              Open Job
            </Link>
            <Link href={`/customers/${detail.customerId}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
              Open Customer
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setSendOpen(true)}>
              Send update now
            </Button>
            {detail.column.key === "WAITING_ON_PART" && readyColumn ? (
              <Button
                type="button"
                className="h-11 w-full bg-[var(--cy-orange)] text-white hover:bg-[var(--cy-orange)]/90"
                onClick={() => setPartOpen(true)}
              >
                Part arrived
              </Button>
            ) : null}
          </div>

          <section className="space-y-3">
            <h3 className="font-medium">Update status</h3>
            <ActionForm action={transitionWaitingAction} className="space-y-2">
              <input type="hidden" name="recordId" value={detail.id} />
              <select
                name="toColumnId"
                defaultValue={detail.column.id}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
              >
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select name="notifyCustomer" defaultValue="no" className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm">
                <option value="no">Don&apos;t text on this move</option>
                <option value="yes">Notify customer</option>
              </select>
              <input type="hidden" name="stopUpdates" value="yes" />
              <Button type="submit" variant="outline" className="h-10 w-full">
                Change status
              </Button>
            </ActionForm>
          </section>

          <section className="space-y-3">
            <h3 className="font-medium">Waiting details</h3>
            <ActionForm action={updateWaitingDetailsAction} className="space-y-3">
              <input type="hidden" name="recordId" value={detail.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Expected date</Label>
                  <Input
                    name="expectedResolutionAt"
                    type="date"
                    defaultValue={detail.expectedResolutionAt?.slice(0, 10) ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Cadence</Label>
                  <select
                    name="cadence"
                    defaultValue={detail.cadence}
                    className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
                  >
                    {(Object.keys(CADENCE_LABELS) as WaitingCadence[]).map((value) => (
                      <option key={value} value={value}>
                        {CADENCE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Owner</Label>
                  <select
                    name="assignedOwnerUserId"
                    defaultValue={detail.assignedOwnerUserId ?? ""}
                    className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Customer texts</Label>
                  <select
                    name="communicationEnabled"
                    defaultValue={detail.communicationEnabled ? "yes" : "no"}
                    className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
                  >
                    <option value="yes">Enabled</option>
                    <option value="no">Off</option>
                  </select>
                </div>
              </div>
              {detail.column.key === "WAITING_ON_PART" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input name="partName" defaultValue={meta.part?.name ?? ""} placeholder="Part name" />
                  <Input name="partNumber" defaultValue={meta.part?.partNumber ?? ""} placeholder="Part number" />
                  <Input name="vendor" defaultValue={meta.part?.vendor ?? meta.vendor ?? ""} placeholder="Vendor" />
                  <Input name="poNumber" defaultValue={meta.part?.poNumber ?? meta.poNumber ?? ""} placeholder="PO #" />
                </div>
              ) : null}
              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/40 px-3 py-2 text-sm">
                <span>Notify customer of this expected-date change</span>
                <select
                  name="notifyExpectedDate"
                  defaultValue="no"
                  className="h-8 rounded-md border border-[var(--border)] bg-white px-2 text-xs"
                >
                  <option value="no">No</option>
                  <option value="yes">Yes, send update</option>
                </select>
              </label>
              <Button type="submit" variant="outline" className="h-10">
                Save details
              </Button>
            </ActionForm>
          </section>

          <section className="space-y-3">
            <h3 className="font-medium">Internal notes</h3>
            {detail.notes ? (
              <pre className="whitespace-pre-wrap rounded-xl bg-[var(--cy-gray)] p-3 text-xs">{detail.notes}</pre>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No internal notes yet.</p>
            )}
            <ActionForm action={addWaitingNoteAction} className="space-y-2">
              <input type="hidden" name="recordId" value={detail.id} />
              <Textarea name="note" rows={2} placeholder="Add a note" />
              <Button type="submit" variant="outline" className="h-10">
                Add note
              </Button>
            </ActionForm>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Communication timeline</h3>
            {detail.communications.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No waiting messages yet.</p>
            ) : (
              <ul className="space-y-2">
                {detail.communications.map((row) => (
                  <li key={row.id} className="rounded-xl border border-[var(--border)] p-3 text-xs">
                    <p className="font-medium">
                      {row.kind} · {row.sentAt ? "Sent" : row.failedAt ? "Failed" : "Attempted"}
                      {row.provider ? ` · ${row.provider}` : ""}
                      {row.attemptedAt
                        ? ` · ${new Date(row.attemptedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                        : ""}
                    </p>
                    {row.failureReason ? <p className="mt-1 text-rose-700">{row.failureReason}</p> : null}
                    {row.body ? <p className="mt-1 text-[var(--muted-foreground)]">{row.body}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">History</h3>
            <ul className="space-y-2 text-xs">
              {detail.transitions.map((row) => (
                <li key={row.id}>
                  {row.fromColumn ? `${row.fromColumn.name} → ` : ""}
                  {row.toColumn.name}
                  {row.actor ? ` · ${row.actor.firstName} ${row.actor.lastName}` : ""}
                  {row.note ? ` · ${row.note}` : ""}
                </li>
              ))}
            </ul>
          </section>

          <ActionForm action={resolveWaitingAction}>
            <input type="hidden" name="recordId" value={detail.id} />
            <Button type="submit" variant="outline" className="h-10 w-full">
              Mark resolved
            </Button>
          </ActionForm>
          <PartArrivedDialog
            open={partOpen}
            onOpenChange={setPartOpen}
            recordId={detail.id}
            customerName={name}
            itemName={itemName}
            communicationEnabled={detail.communicationEnabled}
          />
          <SendUpdateDialog
            open={sendOpen}
            onOpenChange={setSendOpen}
            recordId={detail.id}
            customerName={name}
          />
          <UpdateFailedDialog
            open={failedOpen}
            onOpenChange={setFailedOpen}
            customerName={name}
            attemptedAt={lastFailed?.attemptedAt ?? lastFailed?.failedAt ?? null}
            provider={lastFailed?.provider ?? null}
            reason={lastFailed?.failureReason ?? detail.lastCommunicationError}
            timezone={timezone}
            onRetry={() => setSendOpen(true)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
