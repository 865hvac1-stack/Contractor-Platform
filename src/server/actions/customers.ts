"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { customerSchema, propertySchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";
import { normalizeEmailValue } from "@/lib/highlevel/identity";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

function normalizedCustomerPhones(phone?: string | null, secondaryPhone?: string | null) {
  return {
    phone: canonicalizeUsPhone(phone),
    secondaryPhone: canonicalizeUsPhone(secondaryPhone),
  };
}

async function findCustomerByEmailOrPhone(
  companyId: string,
  input: { email?: string | null; phone?: string | null; secondaryPhone?: string | null; excludeId?: string }
) {
  const email = normalizeEmailValue(input.email);
  if (email) {
    const byEmail = await prisma.customer.findFirst({
      where: {
        companyId,
        id: input.excludeId ? { not: input.excludeId } : undefined,
        email: { equals: email, mode: "insensitive" },
      },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true },
    });
    if (byEmail) return { customer: byEmail, matchedOn: "email" as const };
  }
  const phones = [canonicalizeUsPhone(input.phone), canonicalizeUsPhone(input.secondaryPhone)].filter(
    (value): value is string => Boolean(value)
  );
  if (!phones.length) return null;
  const candidates = await prisma.customer.findMany({
    where: {
      companyId,
      id: input.excludeId ? { not: input.excludeId } : undefined,
      status: { not: "ARCHIVED" },
      OR: [{ phone: { not: null } }, { secondaryPhone: { not: null } }],
    },
    select: { id: true, firstName: true, lastName: true, phone: true, secondaryPhone: true, email: true },
    take: 2000,
  });
  const hit = candidates.find((row) =>
    phones.some((phone) => phonesMatch(phone, row.phone) || phonesMatch(phone, row.secondaryPhone))
  );
  return hit ? { customer: hit, matchedOn: "phone" as const } : null;
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
    const phones = normalizedCustomerPhones(d.phone, d.secondaryPhone);
    const email = normalizeEmailValue(d.email);
    const existing = await findCustomerByEmailOrPhone(ctx.company.id, {
      email,
      phone: phones.phone,
      secondaryPhone: phones.secondaryPhone,
    });
    const confirmSharedPhone = String(formData.get("confirmSharedPhone") || "") === "1";
    if (existing?.matchedOn === "email") {
      return {
        ok: false,
        error: `A customer with this email already exists: ${existing.customer.firstName} ${existing.customer.lastName}.`,
      };
    }
    if (existing?.matchedOn === "phone" && !confirmSharedPhone) {
      return {
        ok: false,
        error: `A customer with this phone already exists: ${existing.customer.firstName} ${existing.customer.lastName}. Confirm if this is a shared family or business number.`,
      };
    }
    const customer = await prisma.customer.create({
      data: {
        companyId: ctx.company.id,
        firstName: d.firstName,
        lastName: d.lastName,
        businessName: emptyToNull(d.businessName),
        email: email,
        phone: phones.phone,
        secondaryPhone: phones.secondaryPhone,
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
    if (returnTo === "/invoices/new") redirect(`/invoices/new?customerId=${customer.id}`);
    if (returnTo === "/estimates/new") redirect(`/estimates/new?customerId=${customer.id}`);
    if (returnTo === "/jobs/new") redirect(`/jobs/new?customerId=${customer.id}`);
    if (returnTo === "/memberships") redirect(`/memberships?customerId=${customer.id}`);
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

export async function addCustomerNoteAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("customers:manage");
    const customerId = String(formData.get("customerId") || "");
    const propertyId = String(formData.get("propertyId") || "") || null;
    const body = String(formData.get("body") || "").trim();
    if (!body) return { ok: false, error: "Write a note first." };
    if (body.length > 2000) return { ok: false, error: "Keep the note under 2,000 characters." };
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.company.id },
      select: { id: true },
    });
    if (!customer) return { ok: false, error: "Customer not found." };
    if (propertyId) {
      const property = await prisma.property.findFirst({
        where: { id: propertyId, companyId: ctx.company.id, customerId },
      });
      if (!property) return { ok: false, error: "Property not found." };
    }
    const note = await prisma.customerNote.create({
      data: {
        companyId: ctx.company.id,
        customerId,
        propertyId,
        authorId: ctx.user.id,
        body,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "customer.note_added",
      entityType: "CustomerNote",
      entityId: note.id,
      metadata: { customerId },
    });
    revalidatePath(`/customers/${customerId}`);
    revalidatePath(`/office/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateCustomerProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("customers:manage");
    const customerId = String(formData.get("customerId") || "");
    const parsed = customerSchema.safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      businessName: formData.get("businessName") || "",
      email: formData.get("email") || "",
      phone: formData.get("phone") || "",
      secondaryPhone: formData.get("secondaryPhone") || "",
      preferredContactMethod: formData.get("preferredContactMethod") || "ANY",
      notes: formData.get("notes") || "",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid customer." };
    }
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.company.id },
      select: { id: true },
    });
    if (!customer) return { ok: false, error: "Customer not found." };
    const phones = normalizedCustomerPhones(parsed.data.phone, parsed.data.secondaryPhone);
    const email = normalizeEmailValue(parsed.data.email);
    const existing = await findCustomerByEmailOrPhone(ctx.company.id, {
      email,
      phone: phones.phone,
      secondaryPhone: phones.secondaryPhone,
      excludeId: customer.id,
    });
    if (existing?.matchedOn === "email") {
      return {
        ok: false,
        error: `Another customer already uses this email: ${existing.customer.firstName} ${existing.customer.lastName}.`,
      };
    }
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        businessName: emptyToNull(parsed.data.businessName),
        email,
        phone: phones.phone,
        secondaryPhone: phones.secondaryPhone,
        preferredContactMethod: parsed.data.preferredContactMethod,
        notes: emptyToNull(parsed.data.notes),
      },
    });
    const propertyId = String(formData.get("propertyId") || "");
    const address = emptyToNull(String(formData.get("address") || ""));
    const city = emptyToNull(String(formData.get("city") || ""));
    const state = emptyToNull(String(formData.get("state") || ""));
    const zip = emptyToNull(String(formData.get("zip") || ""));
    if (propertyId && address && city && state && zip) {
      const property = await prisma.property.findFirst({
        where: { id: propertyId, companyId: ctx.company.id, customerId: customer.id },
        select: { id: true },
      });
      if (!property) return { ok: false, error: "Property not found." };
      await prisma.property.update({
        where: { id: property.id },
        data: { address, city, state, zip },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "customer.updated",
      entityType: "Customer",
      entityId: customer.id,
      metadata: { fields: ["profile", "phone", "email", "property"] },
    });
    revalidatePath(`/customers/${customer.id}`);
    revalidatePath(`/office/customers/${customer.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
