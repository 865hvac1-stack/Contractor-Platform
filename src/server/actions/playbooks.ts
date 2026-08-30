"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getStarterTemplate } from "@/lib/playbooks/templates";
import {
  EMPTY_DEFINITION,
  flattenSteps,
  isPlaybookDefinition,
  type PlaybookDefinition,
} from "@/lib/playbooks/types";
import { parseDefinition, remainingRequiredItems } from "@/lib/playbooks/engine";
import type { ActionResult } from "@/server/actions/auth";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

async function nextSortOrder(companyId: string) {
  const last = await prisma.playbook.findFirst({
    where: { companyId, status: { not: "ARCHIVED" } },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? 0) + 1;
}

async function writeVersion(
  companyId: string,
  playbookId: string,
  definition: PlaybookDefinition,
  userId: string
) {
  const last = await prisma.playbookVersion.findFirst({
    where: { companyId, playbookId },
    orderBy: { versionNumber: "desc" },
  });
  const version = await prisma.playbookVersion.create({
    data: {
      companyId,
      playbookId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      definition: definition as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
  });
  await prisma.playbook.update({
    where: { id: playbookId },
    data: { currentVersionId: version.id },
  });
  return version;
}

export async function createPlaybookAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("playbooks:manage");
    const name = String(formData.get("name") || "").trim();
    const description = emptyToNull(String(formData.get("description") || ""));
    const templateKey = String(formData.get("templateKey") || "");
    if (!name) return { ok: false, error: "Give this playbook a name." };

    const template = templateKey ? getStarterTemplate(templateKey) : null;
    const definition = template?.definition ?? EMPTY_DEFINITION;
    const playbook = await prisma.playbook.create({
      data: {
        companyId: ctx.company.id,
        name,
        description,
        status: "ACTIVE",
        sortOrder: await nextSortOrder(ctx.company.id),
      },
    });
    await writeVersion(ctx.company.id, playbook.id, definition, ctx.user.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "playbook.created",
      entityType: "Playbook",
      entityId: playbook.id,
      metadata: { name, templateKey: templateKey || null },
    });
    revalidatePath("/settings/playbooks");
    redirect(`/settings/playbooks/${playbook.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function duplicatePlaybookAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("playbooks:manage");
    const playbookId = String(formData.get("playbookId") || "");
    const name = String(formData.get("name") || "").trim();
    const source = await prisma.playbook.findFirst({
      where: { id: playbookId, companyId: ctx.company.id },
    });
    if (!source) return { ok: false, error: "Playbook not found." };
    const version = source.currentVersionId
      ? await prisma.playbookVersion.findFirst({
          where: { id: source.currentVersionId, companyId: ctx.company.id },
        })
      : await prisma.playbookVersion.findFirst({
          where: { playbookId: source.id, companyId: ctx.company.id },
          orderBy: { versionNumber: "desc" },
        });
    if (!version || !isPlaybookDefinition(version.definition)) {
      return { ok: false, error: "Nothing to duplicate yet." };
    }

    const copy = await prisma.playbook.create({
      data: {
        companyId: ctx.company.id,
        name: name || `${source.name} copy`,
        description: source.description,
        status: "ACTIVE",
        sortOrder: await nextSortOrder(ctx.company.id),
      },
    });
    await writeVersion(ctx.company.id, copy.id, parseDefinition(version.definition), ctx.user.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "playbook.duplicated",
      entityType: "Playbook",
      entityId: copy.id,
      metadata: { from: source.id },
    });
    revalidatePath("/settings/playbooks");
    redirect(`/settings/playbooks/${copy.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updatePlaybookMetaAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("playbooks:manage");
    const playbookId = String(formData.get("playbookId") || "");
    const name = String(formData.get("name") || "").trim();
    const description = emptyToNull(String(formData.get("description") || ""));
    const status = String(formData.get("status") || "ACTIVE");
    if (!name) return { ok: false, error: "Name is required." };
    if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) {
      return { ok: false, error: "Invalid status." };
    }

    const existing = await prisma.playbook.findFirst({
      where: { id: playbookId, companyId: ctx.company.id },
    });
    if (!existing) return { ok: false, error: "Playbook not found." };

    await prisma.playbook.update({
      where: { id: existing.id },
      data: { name, description, status: status as "ACTIVE" | "INACTIVE" | "ARCHIVED" },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: status === existing.status ? "playbook.edited" : `playbook.${status.toLowerCase()}`,
      entityType: "Playbook",
      entityId: existing.id,
    });
    revalidatePath("/settings/playbooks");
    revalidatePath(`/settings/playbooks/${existing.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function savePlaybookDefinitionAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("playbooks:manage");
    const playbookId = String(formData.get("playbookId") || "");
    const raw = String(formData.get("definition") || "");
    const playbook = await prisma.playbook.findFirst({
      where: { id: playbookId, companyId: ctx.company.id },
    });
    if (!playbook) return { ok: false, error: "Playbook not found." };

    let definition: PlaybookDefinition;
    try {
      definition = parseDefinition(JSON.parse(raw) as Prisma.JsonValue);
    } catch {
      return { ok: false, error: "Could not save that change. Try again." };
    }

    await writeVersion(ctx.company.id, playbook.id, definition, ctx.user.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "playbook.edited",
      entityType: "Playbook",
      entityId: playbook.id,
      metadata: { change: "definition" },
    });
    revalidatePath(`/settings/playbooks/${playbook.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function movePlaybookAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("playbooks:manage");
    const playbookId = String(formData.get("playbookId") || "");
    const direction = String(formData.get("direction") || "");
    const current = await prisma.playbook.findFirst({
      where: { id: playbookId, companyId: ctx.company.id },
    });
    if (!current) return { ok: false, error: "Playbook not found." };

    const neighbor = await prisma.playbook.findFirst({
      where: {
        companyId: ctx.company.id,
        status: { not: "ARCHIVED" },
        sortOrder: direction === "up" ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    });
    if (!neighbor) return { ok: true };

    await prisma.$transaction([
      prisma.playbook.update({
        where: { id: current.id },
        data: { sortOrder: neighbor.sortOrder },
      }),
      prisma.playbook.update({
        where: { id: neighbor.id },
        data: { sortOrder: current.sortOrder },
      }),
    ]);
    revalidatePath("/settings/playbooks");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

async function loadJobForWorkflow(jobId: string) {
  const ctx = await requirePermission("jobs:view");
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: ctx.company.id, ...access },
    include: { playbookSnapshot: true },
  });
  if (!job && can(ctx.role, "jobs:manage")) {
    const fallback = await prisma.job.findFirst({
      where: { id: jobId, companyId: ctx.company.id },
      include: { playbookSnapshot: true },
    });
    if (fallback) return { ctx, job: fallback };
  }
  if (!job) throw new AuthError("Job not found.", 404);
  return { ctx, job };
}

export async function advancePlaybookStepAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const jobId = String(formData.get("jobId") || "");
    const stepId = String(formData.get("stepId") || "");
    const note = emptyToNull(String(formData.get("note") || ""));
    const { ctx, job } = await loadJobForWorkflow(jobId);
    if (!job.playbookSnapshot) return { ok: false, error: "This job has no playbook." };

    const definition = parseDefinition(job.playbookSnapshot.definition);
    const step = flattenSteps(definition).find((s) => s.id === stepId);
    if (!step) return { ok: false, error: "That step is not on this job." };

    await prisma.jobWorkflowEvent.create({
      data: {
        companyId: ctx.company.id,
        jobId: job.id,
        stepId: step.id,
        actorId: ctx.user.id,
        kind: step.kind,
        note,
      },
    });

    if (step.actionKey === "ON_MY_WAY" || step.actionKey === "ARRIVED") {
      const stageKey =
        step.actionKey === "ON_MY_WAY" ? "on_my_way" : step.actionKey === "ARRIVED" ? "arrived" : null;
      await prisma.jobPlaybookSnapshot.update({
        where: { id: job.playbookSnapshot.id },
        data: { currentStageKey: stageKey ?? job.playbookSnapshot.currentStageKey },
      });
    }

    if (step.mapsToJobStatus && job.status !== "COMPLETED" && job.status !== "CANCELED") {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: step.mapsToJobStatus },
      });
    }

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "playbook.step_completed",
      entityType: "Job",
      entityId: job.id,
      metadata: { stepId: step.id, title: step.title },
    });

    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function toggleJobChecklistItemAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const jobId = String(formData.get("jobId") || "");
    const itemId = String(formData.get("itemId") || "");
    const section = String(formData.get("section") || "");
    const label = String(formData.get("label") || "");
    const required = String(formData.get("required") || "") === "true";
    const fieldType = String(formData.get("fieldType") || "CHECKBOX");
    const { ctx, job } = await loadJobForWorkflow(jobId);

    const existing = await prisma.jobChecklistItem.findFirst({
      where: { jobId: job.id, itemId, companyId: ctx.company.id },
    });
    if (existing) {
      await prisma.jobChecklistItem.update({
        where: { id: existing.id },
        data: {
          completed: !existing.completed,
          completedAt: existing.completed ? null : new Date(),
        },
      });
    } else {
      await prisma.jobChecklistItem.create({
        data: {
          companyId: ctx.company.id,
          jobId: job.id,
          itemId,
          section,
          label,
          required,
          fieldType,
          completed: true,
          completedAt: new Date(),
        },
      });
    }
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function completeJobWithPlaybookAction(jobId: string): Promise<ActionResult> {
  try {
    const { ctx, job } = await loadJobForWorkflow(jobId);
    if (!can(ctx.role, "jobs:manage") && ctx.role !== "TECHNICIAN" && ctx.role !== "INSTALLER") {
      return { ok: false, error: "You cannot complete this job." };
    }
    if (job.playbookSnapshot) {
      const remaining = await remainingRequiredItems({
        companyId: ctx.company.id,
        jobId: job.id,
        definition: parseDefinition(job.playbookSnapshot.definition),
      });
      if (remaining.length > 0) {
        return {
          ok: false,
          error: `${remaining.length} item${remaining.length === 1 ? "" : "s"} remaining: ${remaining
            .map((r) => r.title)
            .join(", ")}`,
        };
      }
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (job.playbookSnapshot) {
      await prisma.jobPlaybookSnapshot.update({
        where: { id: job.playbookSnapshot.id },
        data: { currentStageKey: "completed" },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.status_changed",
      entityType: "Job",
      entityId: job.id,
      metadata: { from: job.status, to: "COMPLETED" },
    });
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
