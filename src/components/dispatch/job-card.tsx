"use client";

import { useRef } from "react";
import { StatusBadge } from "@/components/status-badge";
import { JOB_KIND_ACCENT, JOB_KIND_LABEL } from "@/lib/dispatch/job-type";
import { isRunningLate, minutesLate } from "@/lib/dispatch/validate";
import type { DispatchCard } from "@/lib/dispatch/types";

function formatTime(value: Date | string | null) {
  if (!value) return "TBD";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function DispatchJobCard({
  job,
  density,
  selected,
  onSelect,
  asItem = true,
}: {
  job: DispatchCard;
  density: "compact" | "comfortable";
  selected?: boolean;
  onSelect: (job: DispatchCard) => void;
  asItem?: boolean;
}) {
  const late = isRunningLate(job);
  const lateBy = minutesLate(job);
  const dragging = useRef(false);

  function openJob() {
    onSelect(job);
  }

  const card = (
    <article
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        dragging.current = true;
        event.dataTransfer.setData("text/job-id", job.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        dragging.current = false;
      }}
      onPointerDown={() => {
        dragging.current = false;
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragging.current) return;
        openJob();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openJob();
        }
      }}
      aria-label={`Open job ${job.customer} ${job.jobType || "job"} ${formatTime(job.scheduledStart)}`}
      className={`relative z-0 w-full cursor-pointer rounded-xl border border-[var(--border)] border-l-4 bg-white text-left transition hover:border-[var(--cy-navy)]/30 hover:shadow-sm ${
        JOB_KIND_ACCENT[job.kind]
      } ${selected ? "ring-2 ring-[var(--cy-orange)]/40" : ""} ${
        density === "compact" ? "px-2.5 py-2" : "p-3"
      } ${late ? "bg-rose-50/70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold tabular-nums text-[var(--cy-navy)]">{formatTime(job.scheduledStart)}</p>
        <div className="flex flex-wrap justify-end gap-1">
          {job.scheduleLocked ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">Locked</span>
          ) : null}
          {job.priority === "URGENT" ? (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">Emergency</span>
          ) : job.priority === "HIGH" ? (
            <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">High</span>
          ) : null}
          {late ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">
              ⚠ {lateBy ?? 0} min late
            </span>
          ) : null}
        </div>
      </div>
      <p className={`font-medium text-[var(--cy-navy)] ${density === "compact" ? "mt-0.5 text-sm" : "mt-1"}`}>
        {job.customer}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
        {job.jobType || JOB_KIND_LABEL[job.kind]}
        {job.city ? ` · ${job.city}` : ""}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={job.status} className="text-[10px]" />
        {job.membership ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
            {job.membership}
          </span>
        ) : null}
      </div>
    </article>
  );
  return asItem ? <li>{card}</li> : card;
}
