import { addDays, endOfDay, startOfDay } from "date-fns";
import type { JobStatus, Prisma } from "@prisma/client";

const JOB_STATUSES = new Set<string>([
  "NEW",
  "UNSCHEDULED",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "CANCELED",
]);

export const JOBS_PAGE_SIZE = 40;

export type JobsListQuery = {
  q?: string;
  status?: string;
  customerId?: string;
  when?: string;
  page?: number;
};

export function parseJobsListQuery(input: {
  q?: string;
  status?: string;
  customerId?: string;
  when?: string;
  page?: string;
}): JobsListQuery {
  const page = Number(input.page || "1");
  return {
    q: input.q?.trim() || undefined,
    status: input.status?.trim() || undefined,
    customerId: input.customerId?.trim() || undefined,
    when: input.when?.trim() || undefined,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

export function jobsWhere(input: {
  companyId: string;
  access: Record<string, unknown>;
  q?: string;
  status?: string;
  customerId?: string;
  when?: string;
  now?: Date;
}): Prisma.JobWhereInput {
  const query = input.q?.trim();
  const status =
    input.status && input.status !== "ALL" && JOB_STATUSES.has(input.status)
      ? (input.status as JobStatus)
      : undefined;
  const now = input.now ?? new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const whenFilter =
    input.when === "today"
      ? {
          scheduledStart: { gte: dayStart, lte: dayEnd },
          status: { not: "CANCELED" as const },
        }
      : input.when === "upcoming"
        ? {
            status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"] as JobStatus[] },
            OR: [
              { scheduledStart: { gte: now, lte: addDays(dayEnd, 7) } },
              { scheduledStart: null, status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED"] as JobStatus[] } },
            ],
          }
        : {};
  return {
    companyId: input.companyId,
    ...input.access,
    ...(status && input.when !== "today" && input.when !== "upcoming" ? { status } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...whenFilter,
    ...(query
      ? {
          OR: [
            { jobNumber: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { jobType: { contains: query, mode: "insensitive" } },
            { importedTechnicianName: { contains: query, mode: "insensitive" } },
            { serviceType: { name: { contains: query, mode: "insensitive" } } },
            { customer: { firstName: { contains: query, mode: "insensitive" } } },
            { customer: { lastName: { contains: query, mode: "insensitive" } } },
            { customer: { businessName: { contains: query, mode: "insensitive" } } },
            { customer: { phone: { contains: query, mode: "insensitive" } } },
            { property: { address: { contains: query, mode: "insensitive" } } },
            { property: { city: { contains: query, mode: "insensitive" } } },
            { assignments: { some: { user: { firstName: { contains: query, mode: "insensitive" } } } } },
            { assignments: { some: { user: { lastName: { contains: query, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
}

export function jobsListHref(query: JobsListQuery, page = query.page ?? 1) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== "ALL") params.set("status", query.status);
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.when) params.set("when", query.when);
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/jobs?${text}` : "/jobs";
}
