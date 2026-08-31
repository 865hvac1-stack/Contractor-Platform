"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { nanoid } from "nanoid";
import { nextNumber } from "@/lib/sequences";
import { lineTotalCents, sumCents } from "@/lib/money";
import { customerHasActiveMembership, unitPriceForCustomer } from "@/lib/pricebook/pricing";
import { applyCompensation } from "@/lib/compensation/apply";
import { attributionUserIds } from "@/lib/compensation/attribute";
import { isHistoricalImport } from "@/lib/imports/safety";
import { ensureEstimatePublicToken } from "@/lib/estimates/token";
import type { ActionResult } from "@/server/actions/auth";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

async function refreshEstimateTotals(estimateId: string, companyId: string) {
  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, companyId },
    include: { lineItems: true },
  });
  if (!estimate) return;
  const items = estimate.approvedOptionId
    ? estimate.lineItems.filter((item) => item.optionId === estimate.approvedOptionId)
    : estimate.lineItems;
  const subtotalCents = sumCents(
    items.map((item) => lineTotalCents(Number(item.quantity), item.unitPriceCents))
  );
  await prisma.estimate.update({
    where: { id: estimate.id },
    data: { subtotalCents, totalCents: subtotalCents + estimate.taxCents },
  });
}

export async function createDraftEstimateForJobAction(jobId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("estimates:manage");
    const job = await prisma.job.findFirst({
      where: { id: jobId, companyId: ctx.company.id },
    });
    if (!job) return { ok: false, error: "Job not found." };
    const estimateNumber = await nextNumber(ctx.company.id, "ESTIMATE", "EST");
    const estimate = await prisma.estimate.create({
      data: {
        companyId: ctx.company.id,
        customerId: job.customerId,
        propertyId: job.propertyId,
        jobId: job.id,
        estimateNumber,
        status: "DRAFT",
        createdById: ctx.user.id,
        publicToken: nanoid(24),
        options: {
          create: [
            { companyId: ctx.company.id, name: "Option 1", sortOrder: 0 },
            { companyId: ctx.company.id, name: "Option 2", sortOrder: 1 },
            { companyId: ctx.company.id, name: "Option 3", sortOrder: 2 },
          ],
        },
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "estimate.created",
      entityType: "Estimate",
      entityId: estimate.id,
      metadata: { estimateNumber, fromJob: job.jobNumber },
    });
    redirect(`/estimates/${estimate.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createEstimateOptionAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("estimates:manage");
    const estimateId = String(formData.get("estimateId") || "");
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Option name is required." };
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, companyId: ctx.company.id },
    });
    if (!estimate) return { ok: false, error: "Estimate not found." };
    if (estimate.status === "APPROVED") {
      return { ok: false, error: "Approved estimates cannot be changed." };
    }
    const last = await prisma.estimateOption.findFirst({
      where: { estimateId, companyId: ctx.company.id },
      orderBy: { sortOrder: "desc" },
    });
    await prisma.estimateOption.create({
      data: {
        companyId: ctx.company.id,
        estimateId,
        name,
        description: emptyToNull(String(formData.get("description") || "")),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function addPricebookItemToEstimateAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("estimates:manage");
    const estimateId = String(formData.get("estimateId") || "");
    const itemId = String(formData.get("itemId") || "");
    const optionId = emptyToNull(String(formData.get("optionId") || ""));
    const quantity = Number(formData.get("quantity") || 1);
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, companyId: ctx.company.id },
    });
    if (!estimate) return { ok: false, error: "Estimate not found." };
    if (estimate.status === "APPROVED") {
      return { ok: false, error: "Approved estimates cannot be changed." };
    }
    const item = await prisma.pricebookItem.findFirst({
      where: { id: itemId, companyId: ctx.company.id, active: true },
    });
    if (!item) return { ok: false, error: "Pricebook item not found." };
    if (optionId) {
      const option = await prisma.estimateOption.findFirst({
        where: { id: optionId, companyId: ctx.company.id, estimateId },
      });
      if (!option) return { ok: false, error: "Option not found." };
    }
    const membership = await customerHasActiveMembership(prisma, ctx.company.id, estimate.customerId);
    const unitPriceCents = unitPriceForCustomer({
      standardPriceCents: item.standardPriceCents,
      memberPriceCents: item.memberPriceCents,
      eligible: Boolean(membership),
    });
    const last = await prisma.estimateLineItem.findFirst({
      where: { estimateId, optionId: optionId ?? null },
      orderBy: { sortOrder: "desc" },
    });
    await prisma.estimateLineItem.create({
      data: {
        estimateId,
        optionId,
        pricebookItemId: item.id,
        name: item.name,
        description: item.customerDescription,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unitPriceCents,
        costCents: null,
        taxable: item.taxable,
        category: item.type,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await refreshEstimateTotals(estimateId, ctx.company.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "estimate.pricebook_item_added",
      entityType: "Estimate",
      entityId: estimateId,
      metadata: { itemId: item.id, unitPriceCents, memberPriceApplied: unitPriceCents === item.memberPriceCents },
    });
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function presentEstimateAction(estimateId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("estimates:manage");
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, companyId: ctx.company.id },
    });
    if (!estimate) return { ok: false, error: "Estimate not found." };
    await ensureEstimatePublicToken(prisma, estimate.id);
    if (estimate.status === "DRAFT") {
      await prisma.estimate.update({
        where: { id: estimate.id },
        data: { status: "SENT", followUpAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
      });
    }
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function approveEstimateOptionAction(input: {
  estimateId: string;
  optionId?: string | null;
  method: string;
  publicToken?: string;
}): Promise<ActionResult> {
  const estimate = input.publicToken
    ? await prisma.estimate.findFirst({ where: { publicToken: input.publicToken } })
    : await (async () => {
        const ctx = await requirePermission("estimates:manage");
        return prisma.estimate.findFirst({
          where: { id: input.estimateId, companyId: ctx.company.id },
        });
      })();
  if (!estimate) return { ok: false, error: "Estimate not found." };
  if (estimate.status === "APPROVED") {
    return { ok: false, error: "This estimate is already approved and cannot be changed." };
  }
  if (input.optionId) {
    const option = await prisma.estimateOption.findFirst({
      where: { id: input.optionId, estimateId: estimate.id, companyId: estimate.companyId },
    });
    if (!option) return { ok: false, error: "Option not found." };
  }
  await prisma.estimate.update({
    where: { id: estimate.id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedOptionId: input.optionId ?? null,
      approvalMethod: input.method,
      version: estimate.version,
    },
  });
  await refreshEstimateTotals(estimate.id, estimate.companyId);
  if (estimate.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: estimate.jobId, companyId: estimate.companyId },
    });
    if (job && !job.estimateId) {
      await prisma.job.update({ where: { id: job.id }, data: { estimateId: estimate.id } });
    }
  }
  if (!isHistoricalImport(estimate.importMode)) {
    const userIds = await attributionUserIds(prisma, {
      jobId: estimate.jobId,
      createdById: estimate.createdById,
    });
    const items = await prisma.estimateLineItem.findMany({
      where: {
        estimateId: estimate.id,
        ...(input.optionId ? { optionId: input.optionId } : {}),
      },
    });
    const saleCents = sumCents(
      items.map((item) => lineTotalCents(Number(item.quantity), item.unitPriceCents))
    );
    for (const userId of userIds) {
      await applyCompensation({
        prisma,
        companyId: estimate.companyId,
        userId,
        trigger: "ESTIMATE_APPROVED",
        sourceType: "ESTIMATE",
        sourceId: estimate.id,
        saleCents,
        jobId: estimate.jobId,
        customerId: estimate.customerId,
        importMode: estimate.importMode,
      });
      const itemIds = [...new Set(items.map((item) => item.pricebookItemId).filter(Boolean))] as string[];
      for (const pricebookItemId of itemIds) {
        const item = items.find((row) => row.pricebookItemId === pricebookItemId);
        await applyCompensation({
          prisma,
          companyId: estimate.companyId,
          userId,
          trigger: "PRICEBOOK_ITEM_SOLD",
          sourceType: "PRICEBOOK_ITEM",
          sourceId: `${estimate.id}:${pricebookItemId}`,
          saleCents: item ? lineTotalCents(Number(item.quantity), item.unitPriceCents) : saleCents,
          jobId: estimate.jobId,
          customerId: estimate.customerId,
          importMode: estimate.importMode,
          pricebookItemId,
        });
      }
    }
  }
  await writeAudit({
    companyId: estimate.companyId,
    actorId: estimate.createdById,
    action: "estimate.approved",
    entityType: "Estimate",
    entityId: estimate.id,
    metadata: { optionId: input.optionId, method: input.method, version: estimate.version },
  });
  revalidatePath(`/estimates/${estimate.id}`);
  return { ok: true };
}
