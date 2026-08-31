"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { customerSchema, propertySchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

export async function createCustomerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("customers:manage");
    const tagsRaw = String(formData.get("tags") || "");
    const parsed = customerSchema.safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      businessName: formData.get("businessName") || "",
      email: formData.get("email") || "",
      phone: formData.get("phone") || "",
      secondaryPhone: formData.get("secondaryPhone") || "",
      preferredContactMethod: formData.get("preferredContactMethod") || "ANY",
      notes: formData.get("notes") || "",
      status: formData.get("status") || "ACTIVE",
      source: formData.get("source") || "",
      tags: tagsRaw
        ? tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid customer." };
    }

    const d = parsed.data;
    const customer = await prisma.customer.create({
      data: {
        companyId: ctx.company.id,
        firstName: d.firstName,
        lastName: d.lastName,
        businessName: emptyToNull(d.businessName),
        email: emptyToNull(d.email),
        phone: emptyToNull(d.phone),
        secondaryPhone: emptyToNull(d.secondaryPhone),
        preferredContactMethod: d.preferredContactMethod,
        notes: emptyToNull(d.notes),
        status: d.status,
        source: emptyToNull(d.source),
        tags: d.tags ?? [],
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "customer.created",
      entityType: "Customer",
      entityId: customer.id,
    });

    const address = emptyToNull(String(formData.get("address") || ""));
    const city = emptyToNull(String(formData.get("city") || ""));
    const state = emptyToNull(String(formData.get("state") || ""));
    const zip = emptyToNull(String(formData.get("zip") || ""));
    if (address && city && state && zip) {
      await prisma.property.create({
        data: {
          companyId: ctx.company.id,
          customerId: customer.id,
          address,
          city,
          state,
          zip,
          isPrimary: true,
        },
      });
    }

    revalidatePath("/customers");
    revalidatePath("/office");
    const returnTo = String(formData.get("returnTo") || "");
    if (returnTo === "office") redirect(`/office/customers/${customer.id}`);
    redirect(`/customers/${customer.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createPropertyAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("customers:manage");
    const parsed = propertySchema.safeParse({
      customerId: formData.get("customerId"),
      name: formData.get("name") || "",
      address: formData.get("address"),
      city: formData.get("city"),
      state: formData.get("state"),
      zip: formData.get("zip"),
      propertyType: formData.get("propertyType") || "RESIDENTIAL",
      accessNotes: formData.get("accessNotes") || "",
      gateCodeNotes: formData.get("gateCodeNotes") || "",
      isPrimary: formData.get("isPrimary") === "on" || formData.get("isPrimary") === "true",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid property." };
    }

    const customer = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, companyId: ctx.company.id },
    });
    if (!customer) return { ok: false, error: "Customer not found." };

    if (parsed.data.isPrimary) {
      await prisma.property.updateMany({
        where: { companyId: ctx.company.id, customerId: customer.id },
        data: { isPrimary: false },
      });
    }

    const property = await prisma.property.create({
      data: {
        companyId: ctx.company.id,
        customerId: customer.id,
        name: emptyToNull(parsed.data.name),
        address: parsed.data.address,
        city: parsed.data.city,
        state: parsed.data.state,
        zip: parsed.data.zip,
        propertyType: parsed.data.propertyType,
        accessNotes: emptyToNull(parsed.data.accessNotes),
        gateCodeNotes: emptyToNull(parsed.data.gateCodeNotes),
        isPrimary: parsed.data.isPrimary ?? false,
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "property.created",
      entityType: "Property",
      entityId: property.id,
      metadata: { customerId: customer.id },
    });

    revalidatePath(`/customers/${customer.id}`);
    redirect(`/customers/${customer.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
