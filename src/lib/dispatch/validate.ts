export type TimedJob = {
  id: string;
  scheduledStart: Date | string | null;
  scheduledEnd: Date | string | null;
  status: string;
};

function at(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function jobsOverlap(a: TimedJob, b: TimedJob) {
  const aStart = at(a.scheduledStart);
  const aEnd = at(a.scheduledEnd) ?? (aStart != null ? aStart + 90 * 60 * 1000 : null);
  const bStart = at(b.scheduledStart);
  const bEnd = at(b.scheduledEnd) ?? (bStart != null ? bStart + 90 * 60 * 1000 : null);
  if (aStart == null || bStart == null || aEnd == null || bEnd == null) return false;
  return aStart < bEnd && bStart < aEnd;
}

export function findScheduleConflict(existing: TimedJob[], candidate: TimedJob) {
  return existing.find((job) => {
    if (job.id === candidate.id) return false;
    if (job.status === "CANCELED" || job.status === "COMPLETED") return false;
    return jobsOverlap(job, candidate);
  }) ?? null;
}

export function scheduledMinutes(job: TimedJob) {
  const start = at(job.scheduledStart);
  if (start == null) return 0;
  const end = at(job.scheduledEnd) ?? start + 90 * 60 * 1000;
  return Math.max(0, Math.round((end - start) / 60000));
}

export function technicianBoardState(jobs: { status: string }[]) {
  if (jobs.some((job) => job.status === "IN_PROGRESS")) return "ON_JOB" as const;
  if (jobs.some((job) => job.status === "DISPATCHED")) return "EN_ROUTE" as const;
  const active = jobs.filter((job) => job.status !== "CANCELED");
  if (active.length > 0 && active.every((job) => job.status === "COMPLETED")) return "DONE_FOR_DAY" as const;
  return "AVAILABLE" as const;
}

export function isRunningLate(
  job: { scheduledStart: Date | string | null; status: string },
  now = new Date()
) {
  if (!job.scheduledStart) return false;
  if (!["SCHEDULED", "DISPATCHED"].includes(job.status)) return false;
  return new Date(job.scheduledStart) < now;
}

export const TECH_STATE_LABEL = {
  AVAILABLE: "Available",
  ON_JOB: "On job",
  EN_ROUTE: "En route",
  DONE_FOR_DAY: "Done for day",
} as const;
