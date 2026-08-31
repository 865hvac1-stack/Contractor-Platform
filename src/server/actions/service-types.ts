"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import type { ActionResult } from "@/server/actions/auth";
import { updateInvoiceSequenceSettings } from "@/lib/sequences";
import { companyOnboardingSchema } from "@/lib/validators";

function emptyToNull(value?: string | null) {
  return value && value.trim() ? value.trim() : null;
}

export async function savePrimaryTradeAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    const parsed = companyOnboardingSchema.pick({ industry: true }).safeParse({
      industry: formData.get("industry"),
    });
    if (!parsed.success) return { ok: false, error: "Choose a valid primary trade." };
    await prisma.company.update({
      where: { id: ctx.company.id },
      data: { industry: parsed.data.industry },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "company.trade_updated",
      entityType: "Company",
      entityId: ctx.company.id,
      metadata: { industry: parsed.data.industry },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveInvoiceSequenceAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    const nextValueRaw = String(formData.get("nextValue") || "").trim();
    const result = await updateInvoiceSequenceSettings({
      companyId: ctx.company.id,
      prefix: String(formData.get("prefix") || "INV"),
      nextValue: nextValueRaw ? Number.parseInt(nextValueRaw, 10) : undefined,
      padding: Number.parseInt(String(formData.get("padding") || "5"), 10),
    });
    if (!result.ok) return result;
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "company.invoice_sequence_updated",
      entityType: "Company",
      entityId: ctx.company.id,
      metadata: { prefix: result.prefix, nextValue: result.nextValue },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function createServiceTypeAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Give this service type a name." };
    const last = await prisma.serviceType.findFirst({
      where: { companyId: ctx.company.id },
      orderBy: { sortOrder: "desc" },
    });
    const key = `custom_${Date.now().toString(36)}`;
    await prisma.serviceType.create({
      data: {
        companyId: ctx.company.id,
        name,
        key,
        description: emptyToNull(String(formData.get("description") || "")) || name,
        playbookId: emptyToNull(String(formData.get("playbookId") || "")),
        sortOrder: (last?.sortOrder ?? -1) + 1,
        active: true,
      },
    });
    revalidatePath("/settings");
    revalidatePath("/invoices/new");
    revalidatePath("/jobs/new");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function updateServiceTypeAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    const id = String(formData.get("serviceTypeId") || "");
    const existing = await prisma.serviceType.findFirst({
      where: { id, companyId: ctx.company.id },
    });
    if (!existing) return { ok: false, error: "Service type not found." };
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Give this service type a name." };
    const archived = String(formData.get("archived") || "") === "1";
    const active = String(formData.get("active") || "") !== "0";
    await prisma.serviceType.update({
      where: { id: existing.id },
      data: {
        name,
        description: emptyToNull(String(formData.get("description") || "")),
        playbookId: emptyToNull(String(formData.get("playbookId") || "")),
        sortOrder: Number.parseInt(String(formData.get("sortOrder") || existing.sortOrder), 10) || existing.sortOrder,
        active: archived ? false : active,
        archivedAt: archived ? existing.archivedAt ?? new Date() : null,
      },
    });
    revalidatePath("/settings");
    revalidatePath("/invoices/new");
    revalidatePath("/jobs/new");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}
