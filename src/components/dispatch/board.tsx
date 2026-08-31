"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { assignJobToTechnicianAction, toggleJobLockAction } from "@/server/actions/dispatch";
import { StatusBadge } from "@/components/status-badge";
import { RouteOptimizePanel } from "@/components/dispatch/route-optimize";

export type DispatchCard = {
  id: string;
  customerId: string;
  jobNumber: string;
  jobType: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  description: string | null;
  scheduledStart: Date | string | null;
  scheduledEnd: Date | string | null;
  scheduleLocked: boolean;
  customer: string;
  phone: string | null;
  address: string;
  city: string;
  accessNotes: string | null;
  membership: string | null;
  assigneeIds: string[];
  assignees: string[];
};

export function DispatchBoard({
  date,
  technicians,
  unassigned,
  exceptions,
  openings,
  canAssign,
  canLock,
  canOptimize,
  routingConfigured,
}: {
  date: string;
  technicians: { userId: string; name: string; jobs: DispatchCard[] }[];
  unassigned: DispatchCard[];
  exceptions: { kind: string; title: string; href: string }[];
  openings: { userId: string; name: string; jobCount: number; gaps: string[] }[];
  canAssign: boolean;
  canLock: boolean;
  canOptimize: boolean;
  routingConfigured: boolean;
}) {
  const [selected, setSelected] = useState<DispatchCard | null>(unassigned[0] ?? technicians[0]?.jobs[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onDrop(technicianUserId: string | null, jobId: string) {
    if (!canAssign) return;
    start(async () => {
      setError(null);
      const result = await assignJobToTechnicianAction({ jobId, technicianUserId });
      if (!result.ok) setError(result.error);
    });
  }

  const emergencies = unassigned.filter((job) => job.priority === "URGENT" || job.priority === "HIGH");

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {pending ? <p className="text-sm text-[var(--muted-foreground)]">Updating the board…</p> : null}
      {exceptions.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-950">Exceptions</p>
          <ul className="mt-1 space-y-1">
            {exceptions.map((item) => (
              <li key={`${item.kind}-${item.title}`}>
                <Link href={item.href} className="text-amber-950 underline">
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No dispatch exceptions right now.</p>
      )}

      {emergencies.length > 0 ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm">
          <p className="font-semibold text-rose-950">Emergency / high priority waiting</p>
          <p className="mt-1 text-rose-900">
            Live GPS is not used. Openings below come from scheduled gaps only.
          </p>
          <ul className="mt-2 space-y-1">
            {emergencies.map((job) => (
              <li key={job.id}>
                <button type="button" className="underline" onClick={() => setSelected(job)}>
                  {job.priority} · {job.customer} · {job.city || "No city"}
                </button>
              </li>
            ))}
          </ul>
          {openings.some((row) => row.gaps.length > 0 || row.jobCount < 4) ? (
            <ul className="mt-2 text-rose-900">
              {openings
                .filter((row) => row.gaps.length > 0 || row.jobCount < 4)
                .map((row) => (
                  <li key={row.userId}>
                    {row.name}: {row.jobCount} jobs
                    {row.gaps.length ? ` · ${row.gaps.join("; ")}` : " · room on the day"}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-2 text-rose-900">No obvious schedule openings from recorded times.</p>
          )}
        </div>
      ) : null}

      {!routingConfigured && canOptimize ? (
        <p className="rounded-xl border border-dashed px-3 py-2 text-sm text-[var(--muted-foreground)]">
          Route optimization is not configured. Set GOOGLE_MAPS_API_KEY on the server. Savings are
          never invented.
        </p>
      ) : null}

      <div className="hidden gap-4 xl:grid xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <UnassignedColumn jobs={unassigned} onSelect={setSelected} onDrop={onDrop} />
        <div className="flex gap-3 overflow-x-auto pb-2">
          {technicians.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No active technicians.</p>
          ) : (
            technicians.map((lane) => (
              <TechnicianLane
                key={lane.userId}
                lane={lane}
                date={date}
                onSelect={setSelected}
                onDrop={onDrop}
                canOptimize={canOptimize}
              />
            ))
          )}
        </div>
        <JobDetail card={selected} canLock={canLock} />
      </div>

      <div className="space-y-4 xl:hidden">
        <p className="text-xs text-[var(--muted-foreground)]">
          Mobile uses a simplified day list. The column board is built for desktop and tablet.
        </p>
        <UnassignedColumn jobs={unassigned} onSelect={setSelected} onDrop={onDrop} />
        {technicians.map((lane) => (
          <TechnicianLane
            key={lane.userId}
            lane={lane}
            date={date}
            onSelect={setSelected}
            onDrop={onDrop}
            canOptimize={canOptimize}
          />
        ))}
        <JobDetail card={selected} canLock={canLock} />
      </div>
    </div>
  );
}

function UnassignedColumn({
  jobs,
  onSelect,
  onDrop,
}: {
  jobs: DispatchCard[];
  onSelect: (job: DispatchCard) => void;
  onDrop: (techId: string | null, jobId: string) => void;
}) {
  return (
    <section
      className="min-h-64 rounded-2xl border border-dashed border-[var(--border)] bg-white p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const id = event.dataTransfer.getData("text/job-id");
        if (id) onDrop(null, id);
      }}
    >
      <h2 className="text-sm font-semibold">Unassigned</h2>
      {jobs.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted-foreground)]">No unassigned jobs.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {jobs.map((job) => (
            <JobChip key={job.id} job={job} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TechnicianLane({
  lane,
  date,
  onSelect,
  onDrop,
  canOptimize,
}: {
  lane: { userId: string; name: string; jobs: DispatchCard[] };
  date: string;
  onSelect: (job: DispatchCard) => void;
  onDrop: (techId: string | null, jobId: string) => void;
  canOptimize: boolean;
}) {
  return (
    <section
      className="min-w-[220px] flex-1 rounded-2xl border border-[var(--border)] bg-white p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const id = event.dataTransfer.getData("text/job-id");
        if (id) onDrop(lane.userId, id);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{lane.name}</h2>
        <span className="text-xs text-[var(--muted-foreground)]">{lane.jobs.length}</span>
      </div>
      {canOptimize ? (
        <RouteOptimizePanel technicianUserId={lane.userId} technicianName={lane.name} dayIso={date} />
      ) : null}
      {lane.jobs.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted-foreground)]">No jobs on this technician.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {lane.jobs.map((job) => (
            <JobChip key={job.id} job={job} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobChip({ job, onSelect }: { job: DispatchCard; onSelect: (job: DispatchCard) => void }) {
  const time = job.scheduledStart
    ? new Date(job.scheduledStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Unscheduled";
  return (
    <li
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/job-id", job.id)}
      onClick={() => onSelect(job)}
      className="cursor-pointer rounded-xl border border-[var(--border)] p-3"
    >
      <p className="text-xs text-[var(--muted-foreground)]">
        {time}
        {job.scheduleLocked ? " · LOCKED" : ""}
        {job.priority === "URGENT" || job.priority === "HIGH" ? ` · ${job.priority}` : ""}
      </p>
      <p className="font-medium">{job.customer}</p>
      <p className="text-xs text-[var(--muted-foreground)]">
        {job.jobType || "Job"} · {job.city}
      </p>
      <StatusBadge status={job.status} className="mt-1" />
    </li>
  );
}

function JobDetail({ card, canLock }: { card: DispatchCard | null; canLock: boolean }) {
  if (!card) {
    return (
      <aside className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-4 text-sm text-[var(--muted-foreground)]">
        Select a job to see customer, routing, and actions.
      </aside>
    );
  }
  return (
    <aside className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.jobNumber}</p>
      <h2 className="mt-1 font-display text-xl">{card.customer}</h2>
      <p className="text-sm text-[var(--muted-foreground)]">{card.address}</p>
      <p className="mt-2 text-sm">{card.jobType || "Job"}</p>
      {card.description ? <p className="mt-1 text-sm">{card.description}</p> : null}
      {card.accessNotes ? (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">Access: {card.accessNotes}</p>
      ) : null}
      {card.membership ? <p className="mt-2 text-xs font-medium text-emerald-800">{card.membership}</p> : null}
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        {card.assignees.join(", ") || "Unassigned"} · {card.statusLabel}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {card.phone ? (
          <a href={`tel:${card.phone}`} className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--muted)] text-sm">
            Call
          </a>
        ) : null}
        {card.phone ? (
          <a href={`sms:${card.phone}`} className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--muted)] text-sm">
            Text
          </a>
        ) : null}
        <Link
          href={`/office/customers/${card.customerId}`}
          className="inline-flex h-10 items-center justify-center rounded-xl border text-sm"
        >
          Open customer
        </Link>
        <Link
          href={`/jobs/${card.id}`}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--cy-navy)] text-sm font-medium text-white"
        >
          Open job
        </Link>
        {canLock ? (
          <form
            action={async () => {
              await toggleJobLockAction(card.id);
            }}
          >
            <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-xl border text-sm">
              {card.scheduleLocked ? "Unlock" : "Lock time"}
            </button>
          </form>
        ) : null}
      </div>
    </aside>
  );
}
