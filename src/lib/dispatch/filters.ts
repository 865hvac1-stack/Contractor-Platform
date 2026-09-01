import { isRunningLate } from "@/lib/dispatch/validate";
import type { DispatchCard } from "@/lib/dispatch/types";

export type DispatchPulse =
  | "all"
  | "completed"
  | "inProgress"
  | "runningLate"
  | "unassigned"
  | "emergency";

export type DispatchFilters = {
  query: string;
  jobType: string;
  status: string;
  city: string;
  pulse: DispatchPulse;
  priority?: string;
};

export function matchesDispatchFilters(
  job: DispatchCard,
  filters: DispatchFilters,
  now = new Date()
) {
  if (filters.query) {
    const hay = `${job.customer} ${job.jobNumber} ${job.jobType || ""} ${job.city} ${job.address} ${job.description || ""} ${job.assignees.join(" ")}`.toLowerCase();
    if (!hay.includes(filters.query.toLowerCase())) return false;
  }
  if (filters.jobType !== "all" && job.jobType !== filters.jobType) return false;
  if (filters.status !== "all" && job.status !== filters.status) return false;
  if (filters.city !== "all" && job.city !== filters.city) return false;
  if (filters.priority && filters.priority !== "all" && job.priority !== filters.priority) return false;
  if (filters.pulse === "completed" && job.status !== "COMPLETED") return false;
  if (filters.pulse === "inProgress" && job.status !== "IN_PROGRESS") return false;
  if (filters.pulse === "unassigned" && job.assigneeIds.length > 0) return false;
  if (filters.pulse === "emergency" && job.priority !== "URGENT" && job.kind !== "emergency") return false;
  if (filters.pulse === "runningLate" && !isRunningLate(job, now)) return false;
  return true;
}

export function uniqueCities(jobs: DispatchCard[]) {
  return [...new Set(jobs.map((job) => job.city).filter(Boolean))].sort();
}

export function countActiveDispatchFilters(input: {
  techId: string;
  jobType: string;
  status: string;
  city: string;
  priority?: string;
}) {
  return [
    input.techId !== "all",
    input.jobType !== "all",
    input.status !== "all",
    input.city !== "all",
    Boolean(input.priority && input.priority !== "all"),
  ].filter(Boolean).length;
}
