"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { jobAccessFilter, requirePermission } from "@/lib/tenant";
import type { ActionResult } from "@/server/actions/auth";
import { writeAudit } from "@/lib/audit";

function positiveInt(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function accessibleJob(companyId: string, userId: string, role: Parameters<typeof jobAccessFilter>[0], jobId: string) {
  return prisma.job.findFirst({
    where: { id: jobId, companyId, ...jobAccessFilter(role, userId) },
    select: { id: true },
  });
}

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/tech/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/jobs");
  revalidatePath("/pricebook");
  revalidatePath("/projects/[id]", "page");
}

export async function addJobPartAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:view");
    if (!can(ctx.role, "inventory:use")) return { ok: false, error: "You do not have permission to use inventory." };
    const jobId = String(formData.get("jobId") || "");
    const partId = String(formData.get("partId") || "");
    const quantity = positiveInt(formData.get("quantity"));
    if (!quantity) return { ok: false, error: "Enter a quantity greater than zero." };
    const [job, part] = await Promise.all([
      accessibleJob(ctx.company.id, ctx.user.id, ctx.role, jobId),
      prisma.pricebookItem.findFirst({
        where: {
          id: partId,
          companyId: ctx.company.id,
          active: true,
          type: { in: ["MATERIAL", "PRODUCT"] },
        },
      }),
    ]);
    if (!job) return { ok: false, error: "Job not found or unavailable." };
    if (!part) return { ok: false, error: "Choose an active material or product from Parts Bank." };
    const row = await prisma.jobPart.create({
      data: {
        companyId: ctx.company.id,
        jobId,
        partId,
        quantity,
        status: "NEEDED",
        unitCostCents: part.internalCostCents ?? 0,
        unitPriceCents: part.standardPriceCents,
        notes: String(formData.get("notes") || "") || null,
        createdById: ctx.user.id,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.part_needed",
      entityType: "JobPart",
      entityId: row.id,
      metadata: { jobId, partId, quantity },
    });
    revalidateJob(jobId);
    return { ok: true, message: "Part added as needed. Inventory has not been deducted." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not add that part." };
  }
}

export async function reserveJobPartAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:view");
    if (!can(ctx.role, "inventory:use") || (!can(ctx.role, "jobs:manage") && !can(ctx.role, "schedule:manage"))) {
      return { ok: false, error: "You do not have permission to reserve inventory." };
    }
    const jobPartId = String(formData.get("jobPartId") || "");
    const locationId = String(formData.get("locationId") || "");
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.jobPart.findFirst({
        where: { id: jobPartId, companyId: ctx.company.id, status: "NEEDED" },
      });
      if (!row) return { ok: false as const, error: "This part is no longer waiting for reservation." };
      const stock = await tx.inventoryStock.findUnique({
        where: {
          companyId_partId_locationId: {
            companyId: ctx.company.id,
            partId: row.partId,
            locationId,
          },
        },
      });
      if (!stock || stock.onHand - stock.reserved < row.quantity) {
        return { ok: false as const, error: "Not enough available inventory at that location." };
      }
      await tx.inventoryStock.update({
        where: { id: stock.id },
        data: { reserved: { increment: row.quantity } },
      });
      await tx.jobPart.update({
        where: { id: row.id },
        data: { status: "RESERVED", locationId, reservedAt: new Date() },
      });
      await tx.projectMaterial.updateMany({
        where: { companyId: ctx.company.id, linkedJobPartId: row.id },
        data: { status: "ALLOCATED" },
      });
      await tx.inventoryMovement.create({
        data: {
          companyId: ctx.company.id,
          partId: row.partId,
          quantity: row.quantity,
          type: "RESERVE",
          fromLocationId: locationId,
          jobId: row.jobId,
          jobPartId: row.id,
          actorId: ctx.user.id,
          source: "JOB_PART",
          reference: row.id,
        },
      });
      return { ok: true as const, jobId: row.jobId };
    });
    if (!result.ok) return result;
    revalidateJob(result.jobId);
    return { ok: true, message: "Part reserved. On-hand inventory was not deducted." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not reserve that part." };
  }
}

export async function pickUpJobPartAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:view");
    if (!can(ctx.role, "inventory:use")) return { ok: false, error: "You do not have permission to use inventory." };
    const id = String(formData.get("jobPartId") || "");
    const row = await prisma.jobPart.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!row || row.status !== "RESERVED") return { ok: false, error: "Only a reserved part can be marked picked up." };
    const job = await accessibleJob(ctx.company.id, ctx.user.id, ctx.role, row.jobId);
    if (!job) return { ok: false, error: "Job not found or unavailable." };
    await prisma.$transaction([
      prisma.jobPart.update({ where: { id }, data: { status: "PICKED_UP", pickedUpAt: new Date() } }),
      prisma.projectMaterial.updateMany({ where: { companyId: ctx.company.id, linkedJobPartId: id }, data: { status: "LOADED" } }),
    ]);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "job.part_picked_up",
      entityType: "JobPart",
      entityId: id,
      metadata: { jobId: row.jobId },
    });
    revalidateJob(row.jobId);
    return { ok: true, message: "Part marked picked up. Inventory remains reserved until installation." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not update that part." };
  }
}

export async function installJobPartAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:view");
    if (!can(ctx.role, "inventory:use")) return { ok: false, error: "You do not have permission to use inventory." };
    const id = String(formData.get("jobPartId") || "");
    const initial = await prisma.jobPart.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!initial) return { ok: false, error: "Job part not found." };
    const job = await accessibleJob(ctx.company.id, ctx.user.id, ctx.role, initial.jobId);
    if (!job) return { ok: false, error: "Job not found or unavailable." };
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.jobPart.findUnique({ where: { id } });
      if (!row) return { ok: false as const, error: "Job part not found." };
      if (row.status === "INSTALLED") return { ok: true as const, jobId: row.jobId, alreadyInstalled: true };
      if (!row.locationId || !["RESERVED", "PICKED_UP"].includes(row.status)) {
        return { ok: false as const, error: "Reserve this part from a location before installing it." };
      }
      const stock = await tx.inventoryStock.findUnique({
        where: {
          companyId_partId_locationId: {
            companyId: ctx.company.id,
            partId: row.partId,
            locationId: row.locationId,
          },
        },
      });
      if (!stock || stock.onHand < row.quantity || stock.reserved < row.quantity) {
        return { ok: false as const, error: "Reserved inventory is no longer available. Review the stock ledger." };
      }
      await tx.inventoryStock.update({
        where: { id: stock.id },
        data: {
          onHand: { decrement: row.quantity },
          reserved: { decrement: row.quantity },
        },
      });
      await tx.jobPart.update({
        where: { id: row.id },
        data: { status: "INSTALLED", installedAt: new Date() },
      });
      await tx.projectMaterial.updateMany({
        where: { companyId: ctx.company.id, linkedJobPartId: row.id },
        data: { status: "INSTALLED" },
      });
      await tx.inventoryMovement.create({
        data: {
          companyId: ctx.company.id,
          partId: row.partId,
          quantity: row.quantity,
          type: "CONSUME",
          fromLocationId: row.locationId,
          jobId: row.jobId,
          jobPartId: row.id,
          actorId: ctx.user.id,
          source: "JOB_PART",
          reference: row.id,
        },
      });
      const cost = await tx.jobCost.findFirst({
        where: { companyId: ctx.company.id, sourceType: "INVENTORY", sourceId: row.id },
      });
      if (!cost) {
        await tx.jobCost.create({
          data: {
            companyId: ctx.company.id,
            jobId: row.jobId,
            category: "MATERIALS",
            description: "Installed part from Parts Bank",
            amountCents: row.unitCostCents * row.quantity,
            sourceType: "INVENTORY",
            sourceId: row.id,
            createdById: ctx.user.id,
            confirmed: true,
          },
        });
      }
      return { ok: true as const, jobId: row.jobId, alreadyInstalled: false };
    });
    if (!result.ok) return result;
    revalidateJob(result.jobId);
    return {
      ok: true,
      message: result.alreadyInstalled
        ? "This part was already installed; no inventory or cost was changed."
        : "Part installed. Inventory and job material cost were updated once.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not install that part." };
  }
}

export async function cancelJobPartAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:view");
    if (!can(ctx.role, "inventory:use")) return { ok: false, error: "You do not have permission to use inventory." };
    const id = String(formData.get("jobPartId") || "");
    const initial = await prisma.jobPart.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!initial) return { ok: false, error: "Job part not found." };
    const job = await accessibleJob(ctx.company.id, ctx.user.id, ctx.role, initial.jobId);
    if (!job) return { ok: false, error: "Job not found or unavailable." };
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.jobPart.findUnique({ where: { id } });
      if (!row || row.status === "CANCELED") return { ok: true as const, jobId: initial.jobId, alreadyCanceled: true };
      if (row.locationId && ["RESERVED", "PICKED_UP"].includes(row.status)) {
        const stock = await tx.inventoryStock.findUnique({
          where: {
            companyId_partId_locationId: {
              companyId: ctx.company.id,
              partId: row.partId,
              locationId: row.locationId,
            },
          },
        });
        if (stock) {
          if (stock.reserved < row.quantity) {
            throw new Error("Reserved stock is inconsistent; correction was not applied.");
          }
          await tx.inventoryStock.update({
            where: { id: stock.id },
            data: { reserved: { decrement: row.quantity } },
          });
          await tx.inventoryMovement.create({
            data: {
              companyId: ctx.company.id,
              partId: row.partId,
              quantity: row.quantity,
              type: "RELEASE_RESERVATION",
              fromLocationId: row.locationId,
              jobId: row.jobId,
              jobPartId: row.id,
              actorId: ctx.user.id,
              source: "JOB_PART_CORRECTION",
              reference: row.id,
              notes: String(formData.get("notes") || "") || "Part removed from job.",
            },
          });
        }
      }
      if (row.locationId && row.status === "INSTALLED") {
        await tx.inventoryStock.upsert({
          where: {
            companyId_partId_locationId: {
              companyId: ctx.company.id,
              partId: row.partId,
              locationId: row.locationId,
            },
          },
          create: {
            companyId: ctx.company.id,
            partId: row.partId,
            locationId: row.locationId,
            onHand: row.quantity,
          },
          update: { onHand: { increment: row.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            companyId: ctx.company.id,
            partId: row.partId,
            quantity: row.quantity,
            type: "RETURN",
            toLocationId: row.locationId,
            jobId: row.jobId,
            jobPartId: row.id,
            actorId: ctx.user.id,
            source: "JOB_PART_CORRECTION",
            reference: row.id,
            notes: String(formData.get("notes") || "") || "Installed usage corrected and returned.",
          },
        });
        await tx.jobCost.create({
          data: {
            companyId: ctx.company.id,
            jobId: row.jobId,
            category: "MATERIALS",
            description: "Parts Bank usage correction",
            amountCents: -(row.unitCostCents * row.quantity),
            sourceType: "INVENTORY",
            sourceId: `${row.id}:return:${Date.now()}`,
            createdById: ctx.user.id,
            confirmed: true,
          },
        });
      }
      await tx.jobPart.update({
        where: { id: row.id },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      await tx.projectMaterial.updateMany({
        where: { companyId: ctx.company.id, linkedJobPartId: row.id },
        data: { status: "RETURNED" },
      });
      return { ok: true as const, jobId: row.jobId, alreadyCanceled: false };
    });
    revalidateJob(result.jobId);
    return {
      ok: true,
      message: result.alreadyCanceled
        ? "This part was already removed; no inventory changed."
        : "Part usage corrected. Reservation or installed inventory and job cost were reversed with ledger entries.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not correct that part usage." };
  }
}
