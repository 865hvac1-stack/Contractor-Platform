"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { applyTechnicianRoute, previewTechnicianRoute } from "@/lib/routing/optimize";
import { googleRoutingProvider, RoutingNotConfiguredError, RoutingProviderError } from "@/lib/routing/provider";
import type { ActionResult } from "@/server/actions/auth";

function revalidateDispatch(jobId?: string) {
  revalidatePath("/dispatch");
  revalidatePath("/office");
  revalidatePath("/schedule");
  revalidatePath("/jobs");
  revalidatePath("/tech");
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/tech/jobs/${jobId}`);
  }
}

export async function assignJobToTechnicianAction(input: {
  jobId: string;
  technicianUserId: string | null;
  scheduledStart?: string | null;
}): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    const job = await prisma.job.findFirst({ where: { id: input.jobId, companyId: ctx.company.id } });
    if (!job) return { ok: false, error: "Job not found." };
    if (job.scheduleLocked && input.scheduledStart) {
      return { ok: false, error: "This job is locked. Unlock it before changing the time." };
    }

    if (input.technicianUserId) {
      const member = await prisma.membership.findFirst({
        where: {
          companyId: ctx.company.id,
          userId: input.technicianUserId,
          status: "ACTIVE",
          role: { in: ["TECHNICIAN", "INSTALLER"] },
        },
      });
      if (!member) return { ok: false, error: "That technician is not on this company." };
    }

    const previous = await prisma.jobAssignment.findMany({
      where: { jobId: job.id },
      select: { userId: true },
    });
    await prisma.jobAssignment.deleteMany({ where: { jobId: job.id } });
    if (input.technicianUserId) {
      await prisma.jobAssignment.create({ data: { jobId: job.id, userId: input.technicianUserId } });
    }

    const data: { scheduledStart?: Date; status?: typeof job.status } = {};
    if (input.scheduledStart) data.scheduledStart = new Date(input.scheduledStart);
    if (input.technicianUserId && (job.status === "NEW" || job.status === "UNSCHEDULED") && (job.scheduledStart || data.scheduledStart)) {
      data.status = "SCHEDULED";
    }
    if (Object.keys(data).length) {
      await prisma.job.update({ where: { id: job.id }, data });
    }

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.assigned",
      entityType: "Job",
      entityId: job.id,
      metadata: {
        from: previous.map((row) => row.userId),
        to: input.technicianUserId,
      },
    });
    revalidateDispatch(job.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function toggleJobLockAction(jobId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:lock");
    const job = await prisma.job.findFirst({ where: { id: jobId, companyId: ctx.company.id } });
    if (!job) return { ok: false, error: "Job not found." };
    await prisma.job.update({
      where: { id: job.id },
      data: { scheduleLocked: !job.scheduleLocked },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: job.scheduleLocked ? "job.unlocked" : "job.locked",
      entityType: "Job",
      entityId: job.id,
    });
    revalidateDispatch(job.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function previewRouteAction(technicianUserId: string, dayIso?: string) {
  try {
    const ctx = await requirePermission("routing:optimize");
    const day = dayIso ? new Date(dayIso) : new Date();
    const preview = await previewTechnicianRoute(prisma, {
      companyId: ctx.company.id,
      technicianUserId,
      day,
      provider: googleRoutingProvider(),
    });
    await prisma.routeOptimizationRun.create({
      data: {
        companyId: ctx.company.id,
        technicianUserId,
        day,
        actorId: ctx.user.id,
        provider: preview.suggested.provider,
        status: preview.reason === "ok" ? "PREVIEW" : "FAILED",
        currentSeconds: preview.current.durationSeconds,
        suggestedSeconds: preview.suggested.durationSeconds,
        currentMeters: preview.current.distanceMeters,
        suggestedMeters: preview.suggested.distanceMeters,
        currentJobIds: JSON.stringify(preview.current.orderedIds),
        suggestedJobIds: JSON.stringify(preview.suggested.orderedIds),
        error: preview.reason === "ok" ? null : preview.reason,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "route.previewed",
      entityType: "Membership",
      entityId: technicianUserId,
      metadata: {
        provider: preview.suggested.provider,
        savedSeconds: preview.current.durationSeconds - preview.suggested.durationSeconds,
      },
    });
    return { ok: true as const, preview };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false as const, error: e.message };
    if (e instanceof RoutingNotConfiguredError || e instanceof RoutingProviderError) {
      return { ok: false as const, error: e.message };
    }
    throw e;
  }
}

export async function applyRouteAction(input: {
  technicianUserId: string;
  orderedIds: string[];
  dayIso?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("routing:optimize");
    const day = input.dayIso ? new Date(input.dayIso) : new Date();
    const previous = await prisma.job.findMany({
      where: {
        companyId: ctx.company.id,
        assignments: { some: { userId: input.technicianUserId } },
      },
      select: { id: true, routeOrder: true, scheduledStart: true },
      orderBy: [{ routeOrder: "asc" }, { scheduledStart: "asc" }],
    });
    await applyTechnicianRoute(prisma, {
      companyId: ctx.company.id,
      technicianUserId: input.technicianUserId,
      orderedIds: input.orderedIds,
      day,
    });
    await prisma.routeOptimizationRun.create({
      data: {
        companyId: ctx.company.id,
        technicianUserId: input.technicianUserId,
        day,
        actorId: ctx.user.id,
        provider: "google_directions",
        status: "APPLIED",
        currentJobIds: JSON.stringify(input.orderedIds),
        suggestedJobIds: JSON.stringify(input.orderedIds),
        appliedAt: new Date(),
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "route.applied",
      entityType: "Membership",
      entityId: input.technicianUserId,
      metadata: {
        previous: previous.map((row) => row.id),
        jobIds: input.orderedIds,
        provider: "google_directions",
      },
    });
    revalidateDispatch();
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Could not apply route." };
  }
}
