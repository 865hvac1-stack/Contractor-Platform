"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import type { ActionResult } from "@/server/actions/auth";
import { writeAudit } from "@/lib/audit";

function integer(value: FormDataEntryValue | null, minimum = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
}

export async function createInventoryLocationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("inventory:manage");
    const name = String(formData.get("name") || "").trim();
    const type = String(formData.get("type") || "WAREHOUSE");
    if (!name) return { ok: false, error: "Enter a location name." };
    if (!["WAREHOUSE", "TRUCK", "OTHER"].includes(type)) return { ok: false, error: "Choose a valid location type." };
    const row = await prisma.inventoryLocation.create({
      data: { companyId: ctx.company.id, name, type: type as "WAREHOUSE" | "TRUCK" | "OTHER" },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "inventory.location_created",
      entityType: "InventoryLocation",
      entityId: row.id,
      metadata: { name, type },
    });
    revalidatePath("/pricebook");
    return { ok: true, message: "Inventory location added." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not create that inventory location. Location names must be unique." };
  }
}

export async function receiveInventoryAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("inventory:manage");
    const partId = String(formData.get("partId") || "");
    const locationId = String(formData.get("locationId") || "");
    const quantity = integer(formData.get("quantity"), 1);
    const minimumStock = integer(formData.get("minimumStock"), 0);
    if (!quantity || minimumStock == null) return { ok: false, error: "Enter valid quantity and minimum stock values." };
    const [part, location] = await Promise.all([
      prisma.pricebookItem.findFirst({
        where: { id: partId, companyId: ctx.company.id, type: { in: ["MATERIAL", "PRODUCT"] } },
        select: { id: true },
      }),
      prisma.inventoryLocation.findFirst({
        where: { id: locationId, companyId: ctx.company.id, active: true },
        select: { id: true },
      }),
    ]);
    if (!part || !location) return { ok: false, error: "Choose a valid part and inventory location." };
    await prisma.$transaction(async (tx) => {
      await tx.inventoryStock.upsert({
        where: {
          companyId_partId_locationId: {
            companyId: ctx.company.id,
            partId,
            locationId,
          },
        },
        create: {
          companyId: ctx.company.id,
          partId,
          locationId,
          onHand: quantity,
          minimumStock,
        },
        update: { onHand: { increment: quantity }, minimumStock },
      });
      await tx.inventoryMovement.create({
        data: {
          companyId: ctx.company.id,
          partId,
          quantity,
          type: "RECEIVE",
          toLocationId: locationId,
          actorId: ctx.user.id,
          notes: String(formData.get("notes") || "") || null,
          source: "MANUAL_RECEIPT",
        },
      });
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "inventory.received",
      entityType: "PricebookItem",
      entityId: partId,
      metadata: { locationId, quantity, minimumStock },
    });
    revalidatePath("/pricebook");
    return { ok: true, message: "Inventory received and recorded in the movement ledger." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not receive inventory." };
  }
}

export async function transferInventoryAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("inventory:manage");
    const partId = String(formData.get("partId") || "");
    const fromLocationId = String(formData.get("fromLocationId") || "");
    const toLocationId = String(formData.get("toLocationId") || "");
    const quantity = integer(formData.get("quantity"), 1);
    if (!quantity || !fromLocationId || !toLocationId || fromLocationId === toLocationId) {
      return { ok: false, error: "Choose two different locations and a positive quantity." };
    }
    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.inventoryStock.findUnique({
        where: {
          companyId_partId_locationId: {
            companyId: ctx.company.id,
            partId,
            locationId: fromLocationId,
          },
        },
      });
      if (!source || source.onHand - source.reserved < quantity) {
        return { ok: false as const, error: "Not enough available stock to transfer." };
      }
      const destination = await tx.inventoryLocation.findFirst({
        where: { id: toLocationId, companyId: ctx.company.id, active: true },
      });
      if (!destination) return { ok: false as const, error: "Destination location is unavailable." };
      await tx.inventoryStock.update({
        where: { id: source.id },
        data: { onHand: { decrement: quantity } },
      });
      await tx.inventoryStock.upsert({
        where: {
          companyId_partId_locationId: {
            companyId: ctx.company.id,
            partId,
            locationId: toLocationId,
          },
        },
        create: { companyId: ctx.company.id, partId, locationId: toLocationId, onHand: quantity },
        update: { onHand: { increment: quantity } },
      });
      await tx.inventoryMovement.create({
        data: {
          companyId: ctx.company.id,
          partId,
          quantity,
          type: "TRANSFER",
          fromLocationId,
          toLocationId,
          actorId: ctx.user.id,
          source: "MANUAL_TRANSFER",
          notes: String(formData.get("notes") || "") || null,
        },
      });
      return { ok: true as const };
    });
    if (!result.ok) return result;
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "inventory.transferred",
      entityType: "PricebookItem",
      entityId: partId,
      metadata: { fromLocationId, toLocationId, quantity },
    });
    revalidatePath("/pricebook");
    revalidatePath("/dispatch");
    return { ok: true, message: "Inventory transferred and recorded in the movement ledger." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not transfer inventory." };
  }
}
