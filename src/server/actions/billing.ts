"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequences";
import { lineTotalCents, sumCents } from "@/lib/money";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { estimateSchema, invoiceSchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";
import type { EstimateStatus, InvoiceStatus } from "@prisma/client";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

function parseLineItems(formData: FormData) {
  const names = formData.getAll("itemName").map(String);
  const descriptions = formData.getAll("itemDescription").map(String);
  const quantities = formData.getAll("itemQuantity").map(String);
  const prices = formData.getAll("itemUnitPrice").map(String); // dollars
  const costs = formData.getAll("itemCost").map(String);
  const taxables = formData.getAll("itemTaxable").map(String);
  const categories = formData.getAll("itemCategory").map(String);

  return names.map((name, i) => ({
    name,
    description: descriptions[i] || "",
    quantity: parseFloat(quantities[i] || "1"),
    unitPriceCents: Math.round(parseFloat(prices[i] || "0") * 100),
    costCents: costs[i] ? Math.round(parseFloat(costs[i]) * 100) : null,
    taxable: taxables[i] !== "false",
    category: categories[i] || "",
  }));
}

export async function createEstimateAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("estimates:manage");
    const lineItems = parseLineItems(formData);
    const parsed = estimateSchema.safeParse({
      customerId: formData.get("customerId"),
      propertyId: formData.get("propertyId") || "",
      jobId: formData.get("jobId") || "",
      taxCents: Math.round(parseFloat(String(formData.get("tax") || "0")) * 100),
      notes: formData.get("notes") || "",
      expirationDate: formData.get("expirationDate") || "",
      lineItems,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid estimate." };
    }

    const d = parsed.data;
    const customer = await prisma.customer.findFirst({
      where: { id: d.customerId, companyId: ctx.company.id },
    });
    if (!customer) return { ok: false, error: "Customer not found." };

    if (d.propertyId) {
      const property = await prisma.property.findFirst({
        where: { id: d.propertyId, companyId: ctx.company.id },
      });
      if (!property) return { ok: false, error: "Property not found." };
    }
    if (d.jobId) {
      const job = await prisma.job.findFirst({
        where: { id: d.jobId, companyId: ctx.company.id },
      });
      if (!job) return { ok: false, error: "Job not found." };
    }

    const subtotalCents = sumCents(
      d.lineItems.map((li) => lineTotalCents(li.quantity, li.unitPriceCents))
    );
    const taxCents = d.taxCents;
    const totalCents = subtotalCents + taxCents;
    const estimateNumber = await nextNumber(ctx.company.id, "ESTIMATE", "EST");

    const estimate = await prisma.estimate.create({
      data: {
        companyId: ctx.company.id,
        customerId: d.customerId,
        propertyId: emptyToNull(d.propertyId),
        jobId: emptyToNull(d.jobId),
        estimateNumber,
        status: "DRAFT",
        expirationDate: emptyToNull(d.expirationDate) ? new Date(d.expirationDate!) : null,
        subtotalCents,
        taxCents,
        totalCents,
        notes: emptyToNull(d.notes),
        lineItems: {
          create: d.lineItems.map((li, i) => ({
            name: li.name,
            description: emptyToNull(li.description),
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            costCents: li.costCents ?? null,
            taxable: li.taxable,
            category: emptyToNull(li.category),
            sortOrder: i,
          })),
        },
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "estimate.created",
      entityType: "Estimate",
      entityId: estimate.id,
      metadata: { estimateNumber, totalCents },
    });

    revalidatePath("/estimates");
    revalidatePath("/dashboard");
    redirect(`/estimates/${estimate.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateEstimateStatusAction(
  estimateId: string,
  status: EstimateStatus
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("estimates:manage");
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, companyId: ctx.company.id },
    });
    if (!estimate) return { ok: false, error: "Estimate not found." };

    const data: {
      status: EstimateStatus;
      approvedAt?: Date | null;
      declinedAt?: Date | null;
      followUpAt?: Date | null;
    } = { status };

    if (status === "APPROVED") data.approvedAt = new Date();
    if (status === "DECLINED") data.declinedAt = new Date();
    if (status === "SENT") {
      data.followUpAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    }

    await prisma.estimate.update({ where: { id: estimate.id }, data });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: status === "APPROVED" ? "estimate.approved" : "estimate.status_changed",
      entityType: "Estimate",
      entityId: estimate.id,
      metadata: { from: estimate.status, to: status },
    });

    // If approved and linked to a job that is NEW, move toward unscheduled
    if (status === "APPROVED" && estimate.jobId) {
      const job = await prisma.job.findFirst({
        where: { id: estimate.jobId, companyId: ctx.company.id },
      });
      if (job && (job.status === "NEW" || job.status === "UNSCHEDULED") && !job.scheduledStart) {
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "UNSCHEDULED", estimateId: estimate.id },
        });
      } else if (job && !job.estimateId) {
        await prisma.job.update({
          where: { id: job.id },
          data: { estimateId: estimate.id },
        });
      }
    }

    revalidatePath(`/estimates/${estimateId}`);
    revalidatePath("/estimates");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function createInvoiceAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:manage");
    const lineItems = parseLineItems(formData).map(({ costCents: _c, ...rest }) => rest);
    const parsed = invoiceSchema.safeParse({
      customerId: formData.get("customerId"),
      propertyId: formData.get("propertyId") || "",
      jobId: formData.get("jobId") || "",
      taxCents: Math.round(parseFloat(String(formData.get("tax") || "0")) * 100),
      notes: formData.get("notes") || "",
      dueDate: formData.get("dueDate") || "",
      lineItems,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice." };
    }

    const d = parsed.data;
    const customer = await prisma.customer.findFirst({
      where: { id: d.customerId, companyId: ctx.company.id },
    });
    if (!customer) return { ok: false, error: "Customer not found." };

    if (d.jobId) {
      const job = await prisma.job.findFirst({
        where: { id: d.jobId, companyId: ctx.company.id },
      });
      if (!job) return { ok: false, error: "Job not found." };
    }

    const subtotalCents = sumCents(
      d.lineItems.map((li) => lineTotalCents(li.quantity, li.unitPriceCents))
    );
    const taxCents = d.taxCents;
    const totalCents = subtotalCents + taxCents;
    const invoiceNumber = await nextNumber(ctx.company.id, "INVOICE", "INV");

    const invoice = await prisma.invoice.create({
      data: {
        companyId: ctx.company.id,
        customerId: d.customerId,
        propertyId: emptyToNull(d.propertyId),
        jobId: emptyToNull(d.jobId),
        invoiceNumber,
        status: "DRAFT",
        dueDate: emptyToNull(d.dueDate) ? new Date(d.dueDate!) : null,
        subtotalCents,
        taxCents,
        totalCents,
        amountPaidCents: 0,
        balanceCents: totalCents,
        notes: emptyToNull(d.notes),
        lineItems: {
          create: d.lineItems.map((li, i) => ({
            name: li.name,
            description: emptyToNull(li.description),
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            taxable: li.taxable,
            category: emptyToNull(li.category),
            sortOrder: i,
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
      metadata: { invoiceNumber, totalCents },
    });

    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    redirect(`/invoices/${invoice.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateInvoiceStatusAction(
  invoiceId: string,
  status: InvoiceStatus
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:manage");
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: ctx.company.id },
    });
    if (!invoice) return { ok: false, error: "Invoice not found." };

    const data: {
      status: InvoiceStatus;
      amountPaidCents?: number;
      balanceCents?: number;
    } = { status };

    if (status === "PAID") {
      data.amountPaidCents = invoice.totalCents;
      data.balanceCents = 0;
    }

    await prisma.invoice.update({ where: { id: invoice.id }, data });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "invoice.status_changed",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { from: invoice.status, to: status },
    });

    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function recordPaymentAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("invoices:manage");
    const invoiceId = String(formData.get("invoiceId") || "");
    const amountDollars = parseFloat(String(formData.get("amount") || "0"));
    const method = String(formData.get("method") || "OTHER") as
      | "CASH"
      | "CHECK"
      | "CREDIT_CARD"
      | "ACH"
      | "OTHER";

    if (!invoiceId || !(amountDollars > 0)) {
      return { ok: false, error: "Valid payment amount required." };
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: ctx.company.id },
    });
    if (!invoice) return { ok: false, error: "Invoice not found." };

    const amountCents = Math.round(amountDollars * 100);
    const amountPaidCents = invoice.amountPaidCents + amountCents;
    const balanceCents = Math.max(0, invoice.totalCents - amountPaidCents);
    let status: InvoiceStatus = invoice.status;
    if (balanceCents === 0) status = "PAID";
    else if (amountPaidCents > 0) status = "PARTIALLY_PAID";

    await prisma.$transaction([
      prisma.payment.create({
        data: {
          companyId: ctx.company.id,
          invoiceId: invoice.id,
          amountCents,
          method,
          status: "RECORDED",
        },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { amountPaidCents, balanceCents, status },
      }),
    ]);

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "payment.recorded",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { amountCents, method, status },
    });

    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
