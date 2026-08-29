"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequences";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { jobSchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";
import type { JobStatus } from "@prisma/client";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

export async function createJobAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:manage");
    const assigneeRaw = formData.getAll("assigneeIds").map(String).filter(Boolean);
    const parsed = jobSchema.safeParse({
      customerId: formData.get("customerId"),
      propertyId: formData.get("propertyId"),
      jobType: formData.get("jobType") || "",
      trade: formData.get("trade") || undefined,
      priority: formData.get("priority") || "NORMAL",
      source: formData.get("source") || "",
      description: formData.get("description") || "",
      internalNotes: formData.get("internalNotes") || "",
      customerNotes: formData.get("customerNotes") || "",
      scheduledStart: formData.get("scheduledStart") || "",
      scheduledEnd: formData.get("scheduledEnd") || "",
      assigneeIds: assigneeRaw,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid job." };
    }

    const d = parsed.data;
    const customer = await prisma.customer.findFirst({
      where: { id: d.customerId, companyId: ctx.company.id },
    });
    const property = await prisma.property.findFirst({
      where: { id: d.propertyId, companyId: ctx.company.id, customerId: d.customerId },
    });
    if (!customer || !property) return { ok: false, error: "Customer or property not found." };

    const scheduledStart = emptyToNull(d.scheduledStart) ? new Date(d.scheduledStart!) : null;
    const scheduledEnd = emptyToNull(d.scheduledEnd) ? new Date(d.scheduledEnd!) : null;
    let status: JobStatus = "NEW";
    if (scheduledStart) status = "SCHEDULED";
    else status = "UNSCHEDULED";

    const jobNumber = await nextNumber(ctx.company.id, "JOB", "JOB");
    const job = await prisma.job.create({
      data: {
        companyId: ctx.company.id,
        customerId: customer.id,
        propertyId: property.id,
        jobNumber,
        jobType: emptyToNull(d.jobType),
        trade: d.trade ?? ctx.company.industry,
        status,
        priority: d.priority,
        source: emptyToNull(d.source),
        description: emptyToNull(d.description),
        internalNotes: emptyToNull(d.internalNotes),
        customerNotes: emptyToNull(d.customerNotes),
        scheduledStart,
        scheduledEnd,
        assignments: d.assigneeIds?.length
          ? {
              create: d.assigneeIds.map((userId) => ({ userId })),
            }
          : undefined,
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.created",
      entityType: "Job",
      entityId: job.id,
      metadata: { jobNumber, status },
    });

    revalidatePath("/jobs");
    revalidatePath("/schedule");
    revalidatePath("/dashboard");
    redirect(`/jobs/${job.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateJobStatusAction(
  jobId: string,
  status: JobStatus
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:manage");
    const access = jobAccessFilter(ctx.role, ctx.user.id);
    // Technicians with assigned_only still need manage for status in some flows —
    // allow view holders with assignment to mark completion-ish statuses if they have jobs:view
    const job = await prisma.job.findFirst({
      where: { id: jobId, companyId: ctx.company.id, ...access },
    });
    if (!job) {
      // Fallback: if they have jobs:manage without assigned filter
      if (!can(ctx.role, "jobs:manage")) return { ok: false, error: "Job not found." };
      const j2 = await prisma.job.findFirst({ where: { id: jobId, companyId: ctx.company.id } });
      if (!j2) return { ok: false, error: "Job not found." };
    }

    const target = job ?? (await prisma.job.findFirst({
      where: { id: jobId, companyId: ctx.company.id },
    }));
    if (!target) return { ok: false, error: "Job not found." };

    const updated = await prisma.job.update({
      where: { id: target.id },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : target.completedAt,
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.status_changed",
      entityType: "Job",
      entityId: updated.id,
      metadata: { from: target.status, to: status },
    });

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    revalidatePath("/schedule");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function scheduleJobAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    const jobId = String(formData.get("jobId") || "");
    const start = String(formData.get("scheduledStart") || "");
    const end = String(formData.get("scheduledEnd") || "");
    if (!jobId || !start) return { ok: false, error: "Schedule start is required." };

    const job = await prisma.job.findFirst({
      where: { id: jobId, companyId: ctx.company.id },
    });
    if (!job) return { ok: false, error: "Job not found." };

    const scheduledStart = new Date(start);
    const scheduledEnd = end ? new Date(end) : null;
    const status: JobStatus =
      job.status === "NEW" || job.status === "UNSCHEDULED" ? "SCHEDULED" : job.status;

    await prisma.job.update({
      where: { id: job.id },
      data: { scheduledStart, scheduledEnd, status },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.scheduled",
      entityType: "Job",
      entityId: job.id,
      metadata: { scheduledStart, scheduledEnd },
    });

    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/schedule");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
