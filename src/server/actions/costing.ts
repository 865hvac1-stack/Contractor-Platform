"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import type { ActionResult } from "@/server/actions/auth";
import { recordJobCost } from "@/lib/costing/record";
import type { JobCostCategory } from "@prisma/client";

export async function addManualJobCostAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("job_costs:manage");
    const jobId = String(formData.get("jobId") || "");
    const job = await prisma.job.findFirst({ where: { id: jobId, companyId: ctx.company.id } });
    if (!job) return { ok: false, error: "Job not found." };
    const amount = Math.round(parseFloat(String(formData.get("amount") || "0")) * 100);
    if (!amount) return { ok: false, error: "Enter an amount." };
    const category = (String(formData.get("category") || "OTHER") as JobCostCategory) || "OTHER";
    const cost = await recordJobCost(prisma, {
      companyId: ctx.company.id,
      jobId,
      createdById: ctx.user.id,
      category,
      description: String(formData.get("description") || "").trim() || category,
      amountCents: amount,
      sourceType: "MANUAL",
      confirmed: true,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job_cost.manual",
      entityType: "JobCost",
      entityId: cost.id,
      metadata: { jobId, amount },
    });
    revalidatePath(`/jobs/${jobId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not add that cost." };
  }
}

export async function updateLaborCostAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("job_costs:manage");
    const userId = String(formData.get("userId") || "");
    const membership = await prisma.membership.findFirst({
      where: { companyId: ctx.company.id, userId },
    });
    if (!membership) return { ok: false, error: "That person is not on this team." };
    const dollars = parseFloat(String(formData.get("loadedLaborCost") || ""));
    const loadedLaborCostCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
    await prisma.user.update({
      where: { id: userId },
      data: { loadedLaborCostCents },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "labor_cost.updated",
      entityType: "User",
      entityId: userId,
      metadata: { loadedLaborCostCents },
    });
    revalidatePath("/team");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save that labor cost." };
  }
}
