"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { JobStatus } from "@prisma/client";
import { Lock, X } from "lucide-react";
import { assignJobToTechnicianAction, toggleJobLockAction } from "@/server/actions/dispatch";
import { prepareDispatchMessageAction } from "@/server/actions/action-engine";
import { updateJobStatusAction } from "@/server/actions/jobs";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { isRunningLate, TECH_STATE_LABEL } from "@/lib/dispatch/validate";
import type { DispatchCard, DispatchLane } from "@/lib/dispatch/types";
import { formatDateTime, formatTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";
import { CompanySmsForm } from "@/components/highlevel/company-sms-form";

function formatWhen(value: Date | string | null) {
  if (!value) return "Not scheduled";
  return formatDateTime(value) || "Not scheduled";
}

function mapsUrl(address: string) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

const STATUS_OPTIONS: JobStatus[] = ["SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELED"];

type PanelContext = {
  customer: { name: string; phone: string | null; email: string | null; membership: string | null; lastService: string | null };
  property: { line: string; accessNotes: string | null };
  job: { jobNumber: string; jobType: string | null; status: string; priority: string; scheduledStart: string | null; scheduledEnd: string | null; source: string | null };
  technicians: { assigned: Array<{ id: string; name: string }>; importedName: string | null };
  equipment: Array<{ id: string; name: string; manufacturer: string | null; model: string | null; serialNumber: string | null; installDate: string | null; warrantyExpiresAt: string | null }>;
  history: { lastService: string | null; recentJobs: Array<{ id: string; jobNumber: string; label: string; status: string; when: string | null }> };
  financials: { estimateCents: number | null; invoiceCents: number; paidCents: number; balanceCents: number };
  billing: { label: string; state: string; reason: string } | null;
  costing: { directCostCents: number; grossProfitCents: number; grossMarginPercent: number | null } | null;
  parts: Array<{ id: string; name: string; sku: string | null; quantity: number; status: string; location: string | null }>;
  communications: {
    lastMessage: { body: string | null; direction: string; channel: string; occurredAt: string; status: string | null } | null;
    lastCall: { direction: string; startedAt: string; durationSeconds: number | null; answered: boolean | null; missed: boolean | null } | null;
  };
};

export function DispatchJobDrawer({
  job,
  technicians,
  canAssign,
  canLock,
  canChangeStatus,
  onClose,
  onAssigned,
}: {
  job: DispatchCard | null;
  technicians: DispatchLane[];
  canAssign: boolean;
  canLock: boolean;
  canChangeStatus: boolean;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "conflict" | "locked"; techId: string } | null>(null);
  const [draftHref, setDraftHref] = useState<string | null>(null);
  const [context, setContext] = useState<PanelContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  useEffect(() => {
    setError(null);
    setConfirm(null);
    setDraftHref(null);
    setContext(null);
    setContextError(null);
    if (!job?.id) return;
    const controller = new AbortController();
    setContextLoading(true);
    fetch(`/api/dispatch/jobs/${job.id}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load job context.");
        setContext(body);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name !== "AbortError") setContextError(loadError.message);
      })
      .finally(() => setContextLoading(false));
    return () => controller.abort();
  }, [job?.id]);

  function close() {
    setError(null);
    setConfirm(null);
    setDraftHref(null);
    onClose();
  }

  function assign(technicianUserId: string | null, flags?: { confirmConflict?: boolean; confirmLocked?: boolean }) {
    if (!job || !canAssign) return;
    start(async () => {
      setError(null);
      const result = await assignJobToTechnicianAction({
        jobId: job.id,
        technicianUserId,
        confirmConflict: flags?.confirmConflict,
        confirmLocked: flags?.confirmLocked,
      });
      if (!result.ok && result.conflict && technicianUserId) {
        setConfirm({ kind: "conflict", techId: technicianUserId });
        setError(result.error);
        return;
      }
      if (!result.ok && result.locked && technicianUserId) {
        setConfirm({ kind: "locked", techId: technicianUserId });
        setError(result.error);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      onAssigned();
    });
  }

  if (!job) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/25"
        aria-label="Close job details"
        onClick={close}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-job-title"
        className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">{job.jobNumber}</p>
            <h2 id="dispatch-job-title" className="text-xl font-semibold text-[var(--cy-navy)]">
              {job.customer}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{job.address}</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex size-9 items-center justify-center rounded-lg text-[var(--cy-navy)] hover:bg-[var(--cy-gray)]"
            aria-label="Close job details"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={job.status} />
            {job.scheduleLocked ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                <Lock className="size-3" />
                Locked
              </span>
            ) : null}
            {job.membership ? (
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{job.membership}</span>
            ) : null}
            {job.bookedByContractorYou ? (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Booked by ContractorYou</span>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Job type</dt>
              <dd className="mt-0.5 font-medium text-[var(--cy-navy)]">{job.jobType || "Job"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Appointment</dt>
              <dd className="mt-0.5 font-medium text-[var(--cy-navy)]">{formatWhen(job.scheduledStart)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Technician</dt>
              <dd className="mt-0.5 font-medium text-[var(--cy-navy)]">{job.assignees.join(", ") || "Unassigned"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Priority</dt>
              <dd className="mt-0.5 font-medium text-[var(--cy-navy)]">{job.priority}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Phone</dt>
              <dd className="mt-0.5 font-medium text-[var(--cy-navy)]">{job.phone || "No phone on file"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Trade</dt>
              <dd className="mt-0.5 font-medium text-[var(--cy-navy)]">{job.trade || "—"}</dd>
            </div>
          </dl>
          {job.description ? <p className="text-sm text-[var(--cy-navy)]">{job.description}</p> : null}
          {job.accessNotes ? <p className="text-xs text-[var(--muted-foreground)]">Access: {job.accessNotes}</p> : null}
          {contextLoading ? (
            <div className="space-y-2" role="status">
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <p className="text-xs text-[var(--muted-foreground)]">Loading Job 360 context…</p>
            </div>
          ) : null}
          {contextError ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              {contextError}
            </p>
          ) : null}
          {context ? (
            <div className="space-y-4">
              <PanelSection title="Customer & property">
                <p className="font-medium">{context.customer.name}</p>
                <p>{context.customer.email || "No email on file"}</p>
                <p>{context.property.line}</p>
                {context.customer.membership ? <p className="text-emerald-700">Membership: {context.customer.membership}</p> : null}
                {context.property.accessNotes ? <p className="text-amber-900">Property note: {context.property.accessNotes}</p> : null}
              </PanelSection>
              <PanelSection title="Equipment">
                {context.equipment.length ? context.equipment.slice(0, 4).map((item) => (
                  <div key={item.id} className="border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                    <p className="font-medium">{item.name}</p>
                    <p>{[item.manufacturer, item.model, item.serialNumber ? `S/N ${item.serialNumber}` : null].filter(Boolean).join(" · ") || "No model details"}</p>
                    {item.warrantyExpiresAt ? <p>Warranty through {formatDateTime(item.warrantyExpiresAt)}</p> : null}
                  </div>
                )) : <p>No equipment recorded at this property.</p>}
              </PanelSection>
              <PanelSection title="Customer history">
                <p>Last service: {context.history.lastService ? formatDateTime(context.history.lastService) : "No prior service"}</p>
                {context.history.recentJobs.map((recent) => (
                  <Link key={recent.id} href={`/jobs/${recent.id}`} className="block font-medium hover:underline">
                    {recent.jobNumber} · {recent.label}
                  </Link>
                ))}
              </PanelSection>
              <PanelSection title="Financial">
                <div className="grid grid-cols-2 gap-2">
                  <PanelMetric label="Estimate" value={context.financials.estimateCents} />
                  <PanelMetric label="Invoiced" value={context.financials.invoiceCents} />
                  <PanelMetric label="Collected" value={context.financials.paidCents} />
                  <PanelMetric label="Balance" value={context.financials.balanceCents} />
                </div>
                {context.billing ? <p className="mt-2 font-medium">{context.billing.label}</p> : null}
              </PanelSection>
              <PanelSection title="Communications">
                {context.communications.lastMessage ? (
                  <p>Last message: {context.communications.lastMessage.body || `${context.communications.lastMessage.channel} message`}</p>
                ) : <p>No customer messages recorded.</p>}
                {context.communications.lastCall ? (
                  <p>Last call: {context.communications.lastCall.direction.toLowerCase()} · {formatDateTime(context.communications.lastCall.startedAt)}</p>
                ) : <p>No calls recorded.</p>}
              </PanelSection>
              <PanelSection title="Parts">
                {context.parts.length ? context.parts.map((part) => (
                  <p key={part.id}>
                    <span className="font-medium text-[var(--cy-navy)]">{part.name} · Qty {part.quantity}</span>
                    {" "}· {part.status.replaceAll("_", " ")}{part.location ? ` · ${part.location}` : ""}
                  </p>
                )) : <p>No parts are attached to this job.</p>}
              </PanelSection>
              {job.phone ? <CompanySmsForm to={job.phone} customerId={job.customerId} /> : null}
            </div>
          ) : null}

          {canChangeStatus ? (
            <label className="block text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cy-text-muted)]">Status</span>
              <select
                aria-label="Change job status"
                key={`${job.id}-${job.status}`}
                className="mt-1 h-10 w-full rounded-lg border border-[var(--border)] bg-white px-2"
                defaultValue={job.status}
                disabled={pending}
                onChange={(event) => {
                  const status = event.target.value as JobStatus;
                  start(async () => {
                    setError(null);
                    const result = await updateJobStatusAction(job.id, status);
                    if (!result.ok) setError(result.error);
                    else onAssigned();
                  });
                }}
              >
                {STATUS_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {canAssign ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cy-text-muted)]">Reassign technician</p>
              <div className="mt-2 space-y-2">
                {technicians.map((lane) => (
                  <button
                    key={lane.userId}
                    type="button"
                    disabled={pending}
                    onClick={() => assign(lane.userId)}
                    className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2 text-left text-sm hover:border-[var(--cy-navy)]/20"
                  >
                    <span className="font-medium text-[var(--cy-navy)]">{lane.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {TECH_STATE_LABEL[lane.state]} · {lane.jobCount} jobs
                      {lane.nextAvailable
                        ? ` · next ${formatTime(lane.nextAvailable)}`
                        : ""}
                    </span>
                  </button>
                ))}
                {job.assigneeIds.length > 0 ? (
                  <button type="button" className="text-xs text-[var(--cy-orange)]" onClick={() => assign(null)}>
                    Move to Unassigned
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {confirm ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-950">
                {confirm.kind === "conflict" ? "Schedule conflict" : "Locked appointment"}
              </p>
              <p className="mt-1 text-amber-900">{error}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setConfirm(null);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    assign(confirm.techId, {
                      confirmConflict: confirm.kind === "conflict",
                      confirmLocked: confirm.kind === "locked",
                    })
                  }
                >
                  Assign anyway
                </Button>
              </div>
            </div>
          ) : error ? (
            <p className="text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}

          {canLock ? (
            <button
              type="button"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border text-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await toggleJobLockAction(job.id);
                  onAssigned();
                })
              }
            >
              {job.scheduleLocked ? "Unlock time" : "Lock time"}
            </button>
          ) : null}
          {canChangeStatus && ["SCHEDULED", "DISPATCHED"].includes(job.status) ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await updateJobStatusAction(job.id, "DISPATCHED");
                  if (!result.ok) setError(result.error);
                  else onAssigned();
                })
              }
            >
              Mark On My Way
            </Button>
          ) : null}
          {job.phone && isRunningLate(job) ? (
            <button
              type="button"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border text-sm"
              onClick={() => {
                start(async () => {
                  const result = await prepareDispatchMessageAction(job.customerId);
                  if (result.ok && result.request) setDraftHref(`/actions/${result.request.id}`);
                  else if (!result.ok) setError(result.error);
                });
              }}
            >
              Prepare customer update
            </button>
          ) : null}
          {draftHref ? (
            <Link href={draftHref} className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--cy-orange)] text-sm font-medium text-white">
              Review drafted message
            </Link>
          ) : null}
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-[var(--border)] bg-white px-4 py-3">
          {job.phone ? (
            <a href={`tel:${job.phone}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--cy-gray)] text-sm font-medium">
              Call
            </a>
          ) : null}
          {job.phone ? (
            <a href={`sms:${job.phone}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--cy-gray)] text-sm font-medium">
              Text
            </a>
          ) : null}
          <Link href={`/office/customers/${job.customerId}`} className="inline-flex h-11 items-center justify-center rounded-xl border text-sm">
            Customer 360
          </Link>
          <a href={mapsUrl(job.address)} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center rounded-xl border text-sm">
            Directions
          </a>
          <Link href={`/jobs/${job.id}#schedule`} className="inline-flex h-11 items-center justify-center rounded-xl border text-sm">
            Change Appointment
          </Link>
          <Link href={`/jobs/${job.id}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--cy-navy)] text-sm font-medium text-white">
            Open Job 360
          </Link>
        </div>
      </aside>
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/40 p-3 text-sm text-[var(--muted-foreground)]">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cy-navy)]">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function PanelMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-xs">{label}</p>
      <p className="font-medium text-[var(--cy-navy)]">{value == null ? "—" : formatMoney(value)}</p>
    </div>
  );
}
