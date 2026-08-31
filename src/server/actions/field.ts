"use server";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import type { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { requireAssignedJob } from "@/lib/tech/access";
import { flattenSteps } from "@/lib/playbooks/types";
import { parseDefinition } from "@/lib/playbooks/engine";
import { nextNumber } from "@/lib/sequences";
import { lineTotalCents, sumCents } from "@/lib/money";
import { nanoid } from "nanoid";
import type { ActionResult } from "@/server/actions/auth";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

function revalidateJob(jobId: string) {
  revalidatePath(`/tech/jobs/${jobId}`);
  revalidatePath("/tech");
  revalidatePath("/tech/jobs");
  revalidatePath(`/jobs/${jobId}`);
}

export async function updateFieldJobStatusAction(
  jobId: string,
  next: Extract<JobStatus, "DISPATCHED" | "IN_PROGRESS" | "ON_HOLD">
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:field_status");
    const { job } = await requireAssignedJob(jobId);
    if (job.status === "COMPLETED" || job.status === "CANCELED") {
      return { ok: false, error: "This job is already closed." };
    }
    const snapshot = await prisma.jobPlaybookSnapshot.findFirst({
      where: { jobId: job.id, companyId: ctx.company.id },
    });
    if (snapshot && (next === "DISPATCHED" || next === "IN_PROGRESS")) {
      const definition = parseDefinition(snapshot.definition);
      const actionKey = next === "DISPATCHED" ? "ON_MY_WAY" : "ARRIVED";
      const step = flattenSteps(definition).find((item) => item.actionKey === actionKey);
      if (step) {
        const already = await prisma.jobWorkflowEvent.findFirst({
          where: { companyId: ctx.company.id, jobId: job.id, stepId: step.id },
        });
        if (!already) {
          await prisma.jobWorkflowEvent.create({
            data: {
              companyId: ctx.company.id,
              jobId: job.id,
              stepId: step.id,
              actorId: ctx.user.id,
              kind: step.kind,
              note: actionKey === "ON_MY_WAY" ? "On my way" : "Arrived / started",
            },
          });
        }
        await prisma.jobPlaybookSnapshot.update({
          where: { id: snapshot.id },
          data: { currentStageKey: actionKey === "ON_MY_WAY" ? "on_my_way" : "arrived" },
        });
      }
    }
    await prisma.job.update({ where: { id: job.id }, data: { status: next } });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: next === "DISPATCHED" ? "job.on_my_way" : next === "IN_PROGRESS" ? "job.started" : "job.held",
      entityType: "Job",
      entityId: job.id,
      metadata: { from: job.status, to: next },
    });
    if (next === "DISPATCHED") {
      const { maybeSendOnMyWayMessage } = await import("@/lib/communications/on-my-way");
      await maybeSendOnMyWayMessage({
        companyId: ctx.company.id,
        jobId: job.id,
        actorId: ctx.user.id,
        actorFirstName: ctx.user.firstName,
        actorLastName: ctx.user.lastName,
      });
    }
    revalidateJob(job.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateJobNotesAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const jobId = String(formData.get("jobId") || "");
    const { ctx, job } = await requireAssignedJob(jobId);
    const audience = String(formData.get("audience") || "internal");
    const note = emptyToNull(String(formData.get("note") || ""));
    await prisma.job.update({
      where: { id: job.id },
      data: audience === "customer" ? { customerNotes: note } : { internalNotes: note },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.notes_updated",
      entityType: "Job",
      entityId: job.id,
      metadata: { audience },
    });
    revalidateJob(job.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function uploadJobPhotoAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const jobId = String(formData.get("jobId") || "");
    const { ctx, job } = await requireAssignedJob(jobId);
    const files = formData
      .getAll("files")
      .concat(formData.getAll("file"))
      .filter((item): item is File => item instanceof File && item.size > 0);
    if (files.length === 0) return { ok: false, error: "Take a photo or choose one from your library." };
    const { isJobPhotoKind, looksLikeImage } = await import("@/lib/tech/photos");
    const kind = String(formData.get("kind") || "OTHER");
    if (!isJobPhotoKind(kind)) return { ok: false, error: "Choose a photo category." };
    const caption = emptyToNull(String(formData.get("caption") || ""));
    const equipmentId = emptyToNull(String(formData.get("equipmentId") || ""));
    const root = process.env.UPLOAD_DIR || "./uploads";
    const dir = path.join(root, ctx.company.id, "job-photos");
    await mkdir(dir, { recursive: true });
    let saved = 0;
    for (const [index, file] of files.entries()) {
      if (!looksLikeImage(file)) return { ok: false, error: "Use a photo." };
      if (file.size > 12 * 1024 * 1024) return { ok: false, error: "Keep photos under 12 MB." };
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "photo.jpg";
      const stored = `${Date.now()}-${index}-${safeName}`;
      await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));
      await prisma.jobPhoto.create({
        data: {
          companyId: ctx.company.id,
          jobId: job.id,
          equipmentId,
          kind,
          caption,
          fileName: file.name,
          filePath: path.join(ctx.company.id, "job-photos", stored),
          mimeType: file.type || "image/jpeg",
          uploadedById: ctx.user.id,
        },
      });
      saved += 1;
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.photo_uploaded",
      entityType: "Job",
      entityId: job.id,
      metadata: {
        kind,
        count: saved,
        customerId: job.customerId,
        propertyId: job.propertyId,
      },
    });
    revalidateJob(job.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function applyEstimateDiscountAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("estimates:discount");
    const estimateId = String(formData.get("estimateId") || "");
    const percent = Number(formData.get("percent") || 0);
    if (!Number.isFinite(percent) || percent < 0) return { ok: false, error: "Enter a valid discount." };
    const limit = ctx.company.techDiscountLimitBps;
    if (can(ctx.role, "jobs:assigned_only") && limit != null && Math.round(percent * 100) > limit) {
      return { ok: false, error: `Discount cannot exceed ${limit / 100}%.` };
    }
    const access = jobAccessFilter(ctx.role, ctx.user.id);
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, companyId: ctx.company.id, ...(access.assignments ? { job: access } : {}) },
      include: { lineItems: true },
    });
    if (!estimate) return { ok: false, error: "Estimate not found." };
    if (estimate.status === "APPROVED") return { ok: false, error: "Approved estimates cannot be changed." };
    const factor = 1 - percent / 100;
    await prisma.$transaction(
      estimate.lineItems.map((item) =>
        prisma.estimateLineItem.update({
          where: { id: item.id },
          data: { unitPriceCents: Math.round(item.unitPriceCents * factor) },
        })
      )
    );
    const items = await prisma.estimateLineItem.findMany({ where: { estimateId: estimate.id } });
    const subtotalCents = sumCents(items.map((item) => lineTotalCents(Number(item.quantity), item.unitPriceCents)));
    await prisma.estimate.update({
      where: { id: estimate.id },
      data: { subtotalCents, totalCents: subtotalCents + estimate.taxCents },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "estimate.discounted",
      entityType: "Estimate",
      entityId: estimate.id,
      metadata: { percent },
    });
    revalidatePath(`/tech/jobs/${estimate.jobId}`);
    revalidatePath(`/estimates/${estimate.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createInvoiceFromJobAction(jobId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:field");
    const { job } = await requireAssignedJob(jobId);
    const estimate = await prisma.estimate.findFirst({
      where: { companyId: ctx.company.id, jobId: job.id, status: "APPROVED" },
      include: { lineItems: true },
      orderBy: { approvedAt: "desc" },
    });
    const sourceItems = estimate
      ? estimate.approvedOptionId
        ? estimate.lineItems.filter((item) => item.optionId === estimate.approvedOptionId)
        : estimate.lineItems
      : [];
    if (sourceItems.length === 0) return { ok: false, error: "Approve an estimate before creating an invoice." };
    const subtotalCents = sumCents(
      sourceItems.map((item) => lineTotalCents(Number(item.quantity), item.unitPriceCents))
    );
    const taxCents = estimate?.taxCents ?? 0;
    const invoiceNumber = await nextNumber(ctx.company.id, "INVOICE", "INV");
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ctx.company.id,
        customerId: job.customerId,
        propertyId: job.propertyId,
        jobId: job.id,
        invoiceNumber,
        publicToken: nanoid(24),
        status: "SENT",
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
        balanceCents: subtotalCents + taxCents,
        lineItems: {
          create: sourceItems.map((item, index) => ({
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            taxable: item.taxable,
            category: item.category,
            sortOrder: index,
          })),
        },
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "invoice.created",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { fromJob: job.jobNumber, fromEstimate: estimate?.id },
    });
    revalidateJob(job.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function recordFieldPaymentAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requirePermission("invoices:field");
  if (!can(ctx.role, "invoices:field") && !can(ctx.role, "invoices:manage")) {
    return { ok: false, error: "You cannot record payments." };
  }
  const { recordPaymentAction } = await import("@/server/actions/billing");
  return recordPaymentAction(_prev, formData);
}

export async function completeFieldJobAction(jobId: string): Promise<ActionResult> {
  const { completeJobWithPlaybookAction } = await import("@/server/actions/playbooks");
  return completeJobWithPlaybookAction(jobId);
}

export async function overrideCompleteJobAction(jobId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:manage");
    const job = await prisma.job.findFirst({ where: { id: jobId, companyId: ctx.company.id } });
    if (!job) return { ok: false, error: "Job not found." };
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.completion_overridden",
      entityType: "Job",
      entityId: job.id,
      metadata: { reason, from: job.status },
    });
    revalidateJob(job.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function saveTechDiscountLimitAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    const raw = String(formData.get("percent") || "");
    const bps = raw.trim() === "" ? null : Math.round(Number(raw) * 100);
    await prisma.company.update({
      where: { id: ctx.company.id },
      data: { techDiscountLimitBps: bps != null && Number.isFinite(bps) ? bps : null },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "company.tech_discount_limit",
      entityType: "Company",
      entityId: ctx.company.id,
      metadata: { techDiscountLimitBps: bps },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
