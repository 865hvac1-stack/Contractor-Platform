import type { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type CustomerJobHit = {
  id: string;
  jobNumber: string;
  serviceType: string | null;
  address: string | null;
  date: string | null;
  status: string;
  current: boolean;
};

function formatJobDate(value: Date | null) {
  if (!value) return null;
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function customerJobsWhere(
  companyId: string,
  customerId: string,
  raw?: string
): Prisma.JobWhereInput {
  const query = raw?.trim() ?? "";
  const where: Prisma.JobWhereInput = {
    companyId,
    customerId,
    status: { not: "CANCELED" },
  };
  if (!query) return where;
  const status = query.toUpperCase().replace(/\s+/g, "_");
  const knownStatus = [
    "NEW",
    "UNSCHEDULED",
    "SCHEDULED",
    "DISPATCHED",
    "IN_PROGRESS",
    "ON_HOLD",
    "COMPLETED",
  ].includes(status);
  return {
    ...where,
    OR: [
      { jobNumber: { contains: query, mode: "insensitive" } },
      { jobType: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
      { serviceType: { name: { contains: query, mode: "insensitive" } } },
      { property: { address: { contains: query, mode: "insensitive" } } },
      { property: { city: { contains: query, mode: "insensitive" } } },
      ...(knownStatus ? [{ status: status as JobStatus }] : []),
    ],
  };
}

export async function searchCustomerJobs(input: {
  companyId: string;
  customerId: string;
  query?: string;
  take?: number;
}) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId },
    select: { id: true },
  });
  if (!customer) return [];

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const rows = await prisma.job.findMany({
    where: customerJobsWhere(input.companyId, input.customerId, input.query),
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      status: true,
      scheduledStart: true,
      completedAt: true,
      createdAt: true,
      serviceType: { select: { name: true } },
      property: { select: { address: true, city: true, state: true } },
    },
    orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
    take: input.take ?? 20,
  });

  return rows.map((job): CustomerJobHit => {
    const date = job.scheduledStart ?? job.completedAt ?? job.createdAt;
    const current =
      job.status === "IN_PROGRESS" ||
      job.status === "DISPATCHED" ||
      (job.status === "SCHEDULED" && job.scheduledStart?.toISOString().slice(0, 10) === today);
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      serviceType: job.serviceType?.name || job.jobType || null,
      address: job.property
        ? `${job.property.address}, ${job.property.city}${job.property.state ? ` ${job.property.state}` : ""}`
        : null,
      date: formatJobDate(date),
      status: job.status.replaceAll("_", " "),
      current,
    };
  });
}
