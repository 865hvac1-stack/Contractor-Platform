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
  page?: number;
};

export function parseJobsListQuery(input: { q?: string; status?: string; page?: string }): JobsListQuery {
  const page = Number(input.page || "1");
  return {
    q: input.q?.trim() || undefined,
    status: input.status?.trim() || undefined,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

export function jobsWhere(input: {
  companyId: string;
  access: Record<string, unknown>;
  q?: string;
  status?: string;
}): Prisma.JobWhereInput {
  const query = input.q?.trim();
  const status =
    input.status && input.status !== "ALL" && JOB_STATUSES.has(input.status)
      ? (input.status as JobStatus)
      : undefined;
  return {
    companyId: input.companyId,
    ...input.access,
    ...(status ? { status } : {}),
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
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/jobs?${text}` : "/jobs";
}
