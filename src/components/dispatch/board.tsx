"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { assignJobToTechnicianAction } from "@/server/actions/dispatch";
import { DispatchJobCard } from "@/components/dispatch/job-card";
import { DispatchJobDrawer } from "@/components/dispatch/job-drawer";
import { DispatchIssuesPanel } from "@/components/dispatch/issues-panel";
import { DispatchAskBar } from "@/components/dispatch/ai-bar";
import { RouteOptimizePanel } from "@/components/dispatch/route-optimize";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { matchesDispatchFilters, uniqueCities, type DispatchPulse } from "@/lib/dispatch/filters";
import { TECH_STATE_LABEL } from "@/lib/dispatch/validate";
import type { DispatchBoardData, DispatchCard, DispatchLane } from "@/lib/dispatch/types";

function hoursLabel(minutes: number) {
  if (!minutes) return "0 scheduled hrs";
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} scheduled hrs`;
}

function nextLabel(value: Date | string | null) {
  if (!value) return null;
  return `Available ${new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function DispatchBoard({
  date,
  isToday,
  board,
  canAssign,
  canLock,
  canOptimize,
  canChangeStatus,
  routingConfigured,
  canAsk,
  suggestions,
}: {
  date: string;
  isToday: boolean;
  board: DispatchBoardData;
  canAssign: boolean;
  canLock: boolean;
  canOptimize: boolean;
  canChangeStatus: boolean;
  routingConfigured: boolean;
  canAsk: boolean;
  suggestions: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<DispatchCard | null>(null);
  const [query, setQuery] = useState("");
  const [techId, setTechId] = useState("all");
  const [jobType, setJobType] = useState("all");
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState("all");
  const [pulse, setPulse] = useState<DispatchPulse>("all");
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [routeHint, setRouteHint] = useState(false);
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    jobId: string;
    techId: string | null;
    kind: "conflict" | "locked";
    message: string;
  } | null>(null);
  const [pending, start] = useTransition();

  const filters = useMemo(
    () => ({ query, jobType, status, city, pulse }),
    [query, jobType, status, city, pulse]
  );

  const technicians = useMemo(
    () =>
      board.technicians
        .filter((lane) => techId === "all" || lane.userId === techId)
        .map((lane) => ({ ...lane, jobs: lane.jobs.filter((job) => matchesDispatchFilters(job, filters)) })),
    [board.technicians, techId, filters]
  );
  const unassigned = useMemo(
    () => board.unassigned.filter((job) => matchesDispatchFilters(job, filters)),
    [board.unassigned, filters]
  );

  const allJobs = useMemo(
    () => [...board.unassigned, ...board.technicians.flatMap((lane) => lane.jobs)],
    [board.unassigned, board.technicians]
  );
  const statuses = useMemo(() => [...new Set(allJobs.map((job) => job.status))], [allJobs]);
  const cities = useMemo(() => uniqueCities(allJobs), [allJobs]);
  const filteredEmpty =
    unassigned.length === 0 && technicians.every((lane) => lane.jobs.length === 0) && allJobs.length > 0;

  function assign(
    jobId: string,
    technicianUserId: string | null,
    flags?: { confirmConflict?: boolean; confirmLocked?: boolean }
  ) {
    if (!canAssign) return;
    start(async () => {
      setError(null);
      const result = await assignJobToTechnicianAction({ jobId, technicianUserId, ...flags });
      if (!result.ok && (result.conflict || result.locked)) {
        setConfirm({
          jobId,
          techId: technicianUserId,
          kind: result.conflict ? "conflict" : "locked",
          message: result.error || "This assignment needs confirmation.",
        });
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Daily pulse">
        <PulseChip label="Jobs" value={board.metrics.jobs} active={pulse === "all"} onClick={() => setPulse("all")} />
        <PulseChip label="Completed" value={board.metrics.completed} active={pulse === "completed"} onClick={() => setPulse("completed")} />
        <PulseChip label="In progress" value={board.metrics.inProgress} active={pulse === "inProgress"} onClick={() => setPulse("inProgress")} />
        <PulseChip
          label="Running late"
          value={board.metrics.runningLate}
          active={pulse === "runningLate"}
          onClick={() => setPulse("runningLate")}
          tone={board.metrics.runningLate ? "late" : undefined}
        />
        <PulseChip label="Unassigned" value={board.metrics.unassigned} active={pulse === "unassigned"} onClick={() => setPulse("unassigned")} />
        <PulseChip
          label="Emergency"
          value={board.metrics.emergency}
          active={pulse === "emergency"}
          onClick={() => setPulse("emergency")}
          tone={board.metrics.emergency ? "emergency" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search jobs or customers"
          aria-label="Search jobs or customers"
          className="h-9 min-w-[160px] flex-1 rounded-lg border border-[var(--border)] bg-white px-3 text-sm md:max-w-xs"
        />
        <select
          aria-label="All technicians"
          value={techId}
          onChange={(event) => setTechId(event.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
        >
          <option value="all">All technicians</option>
          {board.technicians.map((lane) => (
            <option key={lane.userId} value={lane.userId}>
              {lane.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Job type"
          value={jobType}
          onChange={(event) => setJobType(event.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
        >
          <option value="all">Job type</option>
          {board.jobTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
        >
          <option value="all">Status</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        {cities.length > 0 ? (
          <select
            aria-label="Service area"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
          >
            <option value="all">Service area</option>
            {cities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${
            issuesOpen ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-950"
          }`}
          onClick={() => setIssuesOpen(true)}
          aria-label={`Dispatch issues ${board.issues.length}`}
        >
          <AlertTriangle className="size-3.5" />
          Issues {board.issues.length}
        </button>
        {canOptimize ? (
          routingConfigured ? (
            <span className="text-xs text-[var(--muted-foreground)]">Optimize is on each lane</span>
          ) : (
            <button
              type="button"
              onClick={() => setRouteHint((value) => !value)}
              className="h-9 rounded-lg border border-dashed border-[var(--border)] px-3 text-xs text-[var(--muted-foreground)]"
              aria-label="Optimize routes, provider required"
            >
              Optimize routes · provider required
            </button>
          )
        ) : null}
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          onClick={() => router.refresh()}
          aria-label="Refresh dispatch board"
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </button>
        <select
          aria-label="Board density"
          value={density}
          onChange={(event) => setDensity(event.target.value as "compact" | "comfortable")}
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </div>

      {routeHint ? (
        <p className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--cy-navy)]">
          Connect Google Maps in Settings to enable drive-time optimization. ContractorYou will not invent savings.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      {pending ? <p className="sr-only">Updating the board</p> : null}
      {confirm ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <p className="font-semibold text-amber-950">
            {confirm.kind === "conflict" ? "Schedule conflict" : "Locked appointment"}
          </p>
          <p className="text-amber-900">{confirm.message}</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                assign(confirm.jobId, confirm.techId, {
                  confirmConflict: confirm.kind === "conflict",
                  confirmLocked: confirm.kind === "locked",
                })
              }
            >
              Assign anyway
            </Button>
          </div>
        </div>
      ) : null}

      <div className="hidden min-h-[28rem] flex-1 md:block">
        <div className="flex h-[calc(100dvh-15.5rem)] min-h-[28rem] gap-3 overflow-x-auto pb-2">
          <Lane
            title="Unassigned"
            count={unassigned.length}
            subtitle={
              unassigned.length
                ? `${unassigned.filter((job) => job.priority === "URGENT" || job.kind === "emergency").length} emergency`
                : "Clear"
            }
            dashed
            onDrop={(jobId) => assign(jobId, null)}
          >
            {unassigned.length === 0 ? (
              <p className="px-1 text-sm text-[var(--muted-foreground)]">No unassigned jobs.</p>
            ) : (
              <ul className="space-y-2">
                {unassigned.map((job) => (
                  <DispatchJobCard
                    key={job.id}
                    job={job}
                    density={density}
                    selected={selected?.id === job.id}
                    onSelect={setSelected}
                  />
                ))}
              </ul>
            )}
          </Lane>
          {technicians.length === 0 ? (
            <p className="self-center text-sm text-[var(--muted-foreground)]">No active technicians.</p>
          ) : (
            technicians.map((lane) => (
              <TechnicianColumn
                key={lane.userId}
                lane={lane}
                date={date}
                isToday={isToday}
                density={density}
                selectedId={selected?.id}
                onSelect={setSelected}
                onDrop={(techId, jobId) => assign(jobId, techId)}
                canOptimize={canOptimize && routingConfigured}
              />
            ))
          )}
        </div>
        {filteredEmpty ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No jobs match these filters.</p>
        ) : null}
      </div>

      <div className="space-y-3 md:hidden">
        <section className="rounded-2xl border border-[var(--border)] bg-white p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Dispatch issues · {board.issues.length}</h2>
            <button type="button" className="text-xs font-medium text-[var(--cy-orange)]" onClick={() => setIssuesOpen(true)}>
              Open
            </button>
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--border)] bg-white p-3">
          <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Unassigned · {unassigned.length}</h2>
          {unassigned.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No unassigned jobs.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {unassigned.map((job) => (
                <DispatchJobCard key={job.id} job={job} density={density} onSelect={setSelected} />
              ))}
            </ul>
          )}
        </section>
        {technicians.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No active technicians.</p>
        ) : (
          technicians.map((lane) => (
            <MobileTechCard key={lane.userId} lane={lane} density={density} onSelect={setSelected} />
          ))
        )}
        {filteredEmpty ? <p className="text-sm text-[var(--muted-foreground)]">No jobs match these filters.</p> : null}
      </div>

      {issuesOpen ? (
        <Sheet open onOpenChange={setIssuesOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Dispatch issues</SheetTitle>
              <SheetDescription>Real exceptions from today&apos;s board. Nothing invented.</SheetDescription>
            </SheetHeader>
            <DispatchIssuesPanel
              issues={board.issues}
              jobs={allJobs}
              onSelectJob={(jobId) => {
                const job = allJobs.find((row) => row.id === jobId) ?? null;
                setSelected(job);
                setIssuesOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
      ) : null}

      <DispatchJobDrawer
        job={selected}
        technicians={board.technicians}
        canAssign={canAssign}
        canLock={canLock}
        canChangeStatus={canChangeStatus}
        onClose={() => setSelected(null)}
        onAssigned={() => {
          router.refresh();
        }}
      />

      {canAsk ? <DispatchAskBar suggestions={suggestions} /> : null}
    </div>
  );
}

function PulseChip({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: "late" | "emergency";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? "bg-[var(--cy-navy)] text-white"
          : tone === "emergency"
            ? "bg-rose-50 text-rose-800"
            : tone === "late"
              ? "bg-amber-50 text-amber-950"
              : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
      }`}
    >
      {value} {label}
    </button>
  );
}

function Lane({
  title,
  count,
  subtitle,
  dashed,
  children,
  onDrop,
  leading,
}: {
  title: string;
  count: number;
  subtitle?: string;
  dashed?: boolean;
  children: React.ReactNode;
  onDrop: (jobId: string) => void;
  leading?: React.ReactNode;
}) {
  return (
    <section
      className={`flex w-[300px] shrink-0 flex-col overflow-y-auto rounded-2xl border bg-white ${
        dashed ? "border-dashed border-[var(--cy-navy)]/25" : "border-[var(--border)]"
      }`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const id = event.dataTransfer.getData("text/job-id");
        if (id) onDrop(id);
      }}
    >
      <header className="sticky top-0 z-10 rounded-t-2xl border-b border-[var(--border)] bg-white px-3 py-2.5">
        {leading}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--cy-navy)]">{title}</h2>
          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{count}</span>
        </div>
        {subtitle ? <p className="text-[11px] text-[var(--muted-foreground)]">{subtitle}</p> : null}
      </header>
      <div className="flex-1 space-y-2 p-2">{children}</div>
    </section>
  );
}

function TechnicianColumn({
  lane,
  date,
  isToday,
  density,
  selectedId,
  onSelect,
  onDrop,
  canOptimize,
}: {
  lane: DispatchLane;
  date: string;
  isToday: boolean;
  density: "compact" | "comfortable";
  selectedId?: string;
  onSelect: (job: DispatchCard) => void;
  onDrop: (techId: string | null, jobId: string) => void;
  canOptimize: boolean;
}) {
  return (
    <Lane
      title={lane.name}
      count={lane.jobCount}
      subtitle={`${lane.jobCount} jobs · ${hoursLabel(lane.scheduledMinutes)}${nextLabel(lane.nextAvailable) ? ` · ${nextLabel(lane.nextAvailable)}` : ""}`}
      onDrop={(jobId) => onDrop(lane.userId, jobId)}
      leading={
        <div className="mb-1.5 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cy-navy)] text-[10px] font-semibold text-white">
            {lane.initials}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--cy-orange)]">
            {TECH_STATE_LABEL[lane.state]}
          </span>
        </div>
      }
    >
      {canOptimize ? <RouteOptimizePanel technicianUserId={lane.userId} technicianName={lane.name} dayIso={date} /> : null}
      {lane.jobs.length === 0 ? (
        <p className="px-1 text-sm text-[var(--muted-foreground)]">No jobs on this technician.</p>
      ) : (
        <JobList jobs={lane.jobs} density={density} selectedId={selectedId} isToday={isToday} onSelect={onSelect} />
      )}
    </Lane>
  );
}

function JobList({
  jobs,
  density,
  selectedId,
  isToday,
  onSelect,
}: {
  jobs: DispatchCard[];
  density: "compact" | "comfortable";
  selectedId?: string;
  isToday: boolean;
  onSelect: (job: DispatchCard) => void;
}) {
  const now = Date.now();
  let marker = false;
  const lastStart = jobs[jobs.length - 1]?.scheduledStart;
  const nowAfterAll = isToday && lastStart && new Date(lastStart).getTime() <= now;
  return (
    <ul className="space-y-2">
      {jobs.map((job) => {
        const showNow = isToday && !marker && job.scheduledStart && new Date(job.scheduledStart).getTime() > now;
        if (showNow) marker = true;
        return (
          <li key={job.id}>
            {showNow ? (
              <p className="my-1 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
                ──── Now {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ────
              </p>
            ) : null}
            <DispatchJobCard job={job} density={density} selected={selectedId === job.id} onSelect={onSelect} asItem={false} />
          </li>
        );
      })}
      {nowAfterAll && !marker ? (
        <li className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          ──── Now {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ────
        </li>
      ) : null}
    </ul>
  );
}

function MobileTechCard({
  lane,
  density,
  onSelect,
}: {
  lane: DispatchLane;
  density: "compact" | "comfortable";
  onSelect: (job: DispatchCard) => void;
}) {
  const [open, setOpen] = useState(lane.state === "ON_JOB" || lane.state === "EN_ROUTE");
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--cy-navy)] text-[10px] font-semibold text-white">
            {lane.initials}
          </span>
          <div>
            <p className="font-semibold text-[var(--cy-navy)]">{lane.name}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {lane.jobCount} jobs · {TECH_STATE_LABEL[lane.state]}
            </p>
          </div>
        </div>
        <span className="text-sm text-[var(--cy-orange)]">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <ul className="space-y-2 border-t border-[var(--border)] px-3 py-3">
          {lane.jobs.length === 0 ? (
            <li className="text-sm text-[var(--muted-foreground)]">No jobs on this technician.</li>
          ) : (
            lane.jobs.map((job) => <DispatchJobCard key={job.id} job={job} density={density} onSelect={onSelect} />)
          )}
        </ul>
      ) : null}
    </section>
  );
}
