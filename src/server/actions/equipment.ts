"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import type { ActionResult } from "@/server/actions/auth";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

export async function upsertEquipmentAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("equipment:manage");
    const id = emptyToNull(String(formData.get("id") || ""));
    const customerId = String(formData.get("customerId") || "");
    const propertyId = emptyToNull(String(formData.get("propertyId") || ""));
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Equipment name is required." };
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.company.id },
    });
    if (!customer) return { ok: false, error: "Customer not found." };
    const data = {
      name,
      equipmentType: emptyToNull(String(formData.get("equipmentType") || "")),
      manufacturer: emptyToNull(String(formData.get("manufacturer") || "")),
      model: emptyToNull(String(formData.get("model") || "")),
      serialNumber: emptyToNull(String(formData.get("serialNumber") || "")),
      installDate: emptyToNull(String(formData.get("installDate") || ""))
        ? new Date(String(formData.get("installDate")))
        : null,
      location: emptyToNull(String(formData.get("location") || "")),
      notes: emptyToNull(String(formData.get("notes") || "")),
      warrantyNotes: emptyToNull(String(formData.get("warrantyNotes") || "")),
    };
    if (id) {
      const existing = await prisma.equipment.findFirst({
        where: { id, companyId: ctx.company.id },
      });
      if (!existing) return { ok: false, error: "Equipment not found." };
      await prisma.equipment.update({ where: { id }, data });
    } else {
      await prisma.equipment.create({
        data: {
          ...data,
          companyId: ctx.company.id,
          customerId,
          propertyId,
        },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: id ? "equipment.updated" : "equipment.created",
      entityType: "Equipment",
      metadata: { name, customerId },
    });
    const jobId = emptyToNull(String(formData.get("jobId") || ""));
    if (jobId) revalidatePath(`/tech/jobs/${jobId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
