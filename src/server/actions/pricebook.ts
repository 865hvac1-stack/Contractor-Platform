"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import type { ActionResult } from "@/server/actions/auth";
import type { PricebookItemType } from "@prisma/client";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

export async function createPricebookCategoryAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("pricebook:manage");
    const name = String(formData.get("name") || "").trim();
    const parentId = emptyToNull(String(formData.get("parentId") || ""));
    if (!name) return { ok: false, error: "Category name is required." };
    if (parentId) {
      const parent = await prisma.pricebookCategory.findFirst({
        where: { id: parentId, companyId: ctx.company.id },
      });
      if (!parent) return { ok: false, error: "Parent category not found." };
    }
    const last = await prisma.pricebookCategory.findFirst({
      where: { companyId: ctx.company.id, parentId: parentId ?? null },
      orderBy: { sortOrder: "desc" },
    });
    const category = await prisma.pricebookCategory.create({
      data: {
        companyId: ctx.company.id,
        parentId,
        name,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "pricebook.category_created",
      entityType: "PricebookCategory",
      entityId: category.id,
      metadata: { name, parentId },
    });
    revalidatePath("/pricebook");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updatePricebookCategoryAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("pricebook:manage");
    const id = String(formData.get("id") || "");
    const name = String(formData.get("name") || "").trim();
    const archived = String(formData.get("archived") || "") === "true";
    const sortOrder = Number(formData.get("sortOrder") || 0);
    const category = await prisma.pricebookCategory.findFirst({
      where: { id, companyId: ctx.company.id },
    });
    if (!category) return { ok: false, error: "Category not found." };
    await prisma.pricebookCategory.update({
      where: { id },
      data: { name: name || category.name, archived, sortOrder: Number.isFinite(sortOrder) ? sortOrder : category.sortOrder },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: archived ? "pricebook.category_archived" : "pricebook.category_updated",
      entityType: "PricebookCategory",
      entityId: id,
    });
    revalidatePath("/pricebook");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createPricebookItemAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("pricebook:manage");
    const name = String(formData.get("name") || "").trim();
    const categoryId = String(formData.get("categoryId") || "");
    const type = String(formData.get("type") || "SERVICE") as PricebookItemType;
    if (!name) return { ok: false, error: "Item name is required." };
    const category = await prisma.pricebookCategory.findFirst({
      where: { id: categoryId, companyId: ctx.company.id },
    });
    if (!category) return { ok: false, error: "Category not found." };
    const { can } = await import("@/lib/permissions");
    const canCost = can(ctx.role, "pricebook:cost");
    const item = await prisma.pricebookItem.create({
      data: {
        companyId: ctx.company.id,
        categoryId,
        name,
        internalName: emptyToNull(String(formData.get("internalName") || "")),
        sku: emptyToNull(String(formData.get("sku") || "")),
        type,
        customerDescription: emptyToNull(String(formData.get("customerDescription") || "")),
        technicianNotes: emptyToNull(String(formData.get("technicianNotes") || "")),
        standardPriceCents: dollarsToCents(String(formData.get("standardPrice") || "0")),
        memberPriceCents: String(formData.get("memberPrice") || "")
          ? dollarsToCents(String(formData.get("memberPrice")))
          : null,
        internalCostCents:
          canCost && String(formData.get("internalCost") || "")
            ? dollarsToCents(String(formData.get("internalCost")))
            : null,
        taxable: String(formData.get("taxable") || "true") !== "false",
        unit: String(formData.get("unit") || "each").trim() || "each",
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "pricebook.item_created",
      entityType: "PricebookItem",
      entityId: item.id,
      metadata: { name, standardPriceCents: item.standardPriceCents },
    });
    revalidatePath("/pricebook");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updatePricebookItemAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("pricebook:manage");
    const id = String(formData.get("id") || "");
    const item = await prisma.pricebookItem.findFirst({
      where: { id, companyId: ctx.company.id },
    });
    if (!item) return { ok: false, error: "Item not found." };
    const nextPrice = dollarsToCents(String(formData.get("standardPrice") || item.standardPriceCents / 100));
    const nextCost = String(formData.get("internalCost") || "")
      ? dollarsToCents(String(formData.get("internalCost")))
      : item.internalCostCents;
    await prisma.pricebookItem.update({
      where: { id },
      data: {
        name: String(formData.get("name") || item.name).trim() || item.name,
        internalName: emptyToNull(String(formData.get("internalName") || "")),
        sku: emptyToNull(String(formData.get("sku") || "")),
        customerDescription: emptyToNull(String(formData.get("customerDescription") || "")),
        technicianNotes: emptyToNull(String(formData.get("technicianNotes") || "")),
        standardPriceCents: nextPrice,
        memberPriceCents: String(formData.get("memberPrice") || "")
          ? dollarsToCents(String(formData.get("memberPrice")))
          : null,
        internalCostCents: nextCost,
        taxable: String(formData.get("taxable") || "true") !== "false",
        unit: String(formData.get("unit") || item.unit),
        active: String(formData.get("active") || "true") !== "false",
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "pricebook.item_updated",
      entityType: "PricebookItem",
      entityId: id,
      metadata: {
        priceChanged: nextPrice !== item.standardPriceCents,
        costChanged: nextCost !== item.internalCostCents,
      },
    });
    revalidatePath("/pricebook");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
