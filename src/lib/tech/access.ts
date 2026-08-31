import type { JobStatus } from "@prisma/client";
import { AuthError } from "@/lib/auth";
import { isFieldRole } from "@/lib/permissions";
import { jobAccessFilter, requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";

export async function requireAssignedJob(jobId: string) {
  const ctx = await requirePermission("jobs:view");
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: ctx.company.id, ...access },
  });
  if (!job) throw new AuthError("Job not found.", 404);
  return { ctx, job };
}

export function mapsUrl(address: string) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

export function propertyAddress(property: {
  address: string;
  city: string;
  state: string;
  zip: string;
}) {
  return `${property.address}, ${property.city}, ${property.state} ${property.zip}`;
}

export function fieldStatusLabel(status: JobStatus) {
  if (status === "DISPATCHED") return "On my way";
  if (status === "IN_PROGRESS") return "On site";
  if (status === "ON_HOLD") return "On hold";
  return status.replaceAll("_", " ");
}

export { isFieldRole };
