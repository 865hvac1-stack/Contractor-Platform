"use server";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { expenseSchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

function uploadRoot() {
  return process.env.UPLOAD_DIR || "./uploads";
}

export async function createExpenseAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("expenses:manage");
    const amountDollars = parseFloat(String(formData.get("amount") || "0"));
    const taxDollars = parseFloat(String(formData.get("tax") || "0"));
    const parsed = expenseSchema.safeParse({
      vendor: formData.get("vendor") || "",
      date: formData.get("date"),
      amountCents: Math.round(amountDollars * 100),
      taxCents: Math.round(taxDollars * 100),
      category: formData.get("category") || "OTHER",
      description: formData.get("description") || "",
      paymentMethod: formData.get("paymentMethod") || undefined,
      jobId: formData.get("jobId") || "",
      customerId: formData.get("customerId") || "",
      receiptId: formData.get("receiptId") || "",
      status: formData.get("status") || "SUBMITTED",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid expense." };
    }

    const d = parsed.data;

    if (d.jobId) {
      const job = await prisma.job.findFirst({
        where: { id: d.jobId, companyId: ctx.company.id },
      });
      if (!job) return { ok: false, error: "Job not found." };
    }

    let receiptId = emptyToNull(d.receiptId);
    const file = formData.get("receipt");
    if (file && file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) {
        return { ok: false, error: "Receipt must be under 10MB." };
      }
      const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(file.type)) {
        return { ok: false, error: "Receipt must be JPEG, PNG, WebP, or PDF." };
      }

      const companyDir = path.join(uploadRoot(), ctx.company.id, "receipts");
      await mkdir(companyDir, { recursive: true });
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
      const storedName = `${Date.now()}-${safeName}`;
      const filePath = path.join(companyDir, storedName);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);

      const receipt = await prisma.receipt.create({
        data: {
          companyId: ctx.company.id,
          fileName: file.name,
          filePath: path.join(ctx.company.id, "receipts", storedName),
          mimeType: file.type,
          fileSizeBytes: file.size,
          // No AI extraction in Phase 1 — stay UPLOADED
          processingStatus: "UPLOADED",
        },
      });
      receiptId = receipt.id;

      await writeAudit({
        companyId: ctx.company.id,
        actorId: ctx.user.id,
        action: "receipt.uploaded",
        entityType: "Receipt",
        entityId: receipt.id,
        metadata: { fileName: file.name, size: file.size },
      });
    } else if (receiptId) {
      const receipt = await prisma.receipt.findFirst({
        where: { id: receiptId, companyId: ctx.company.id },
      });
      if (!receipt) return { ok: false, error: "Receipt not found." };
    }

    const expense = await prisma.expense.create({
      data: {
        companyId: ctx.company.id,
        vendor: emptyToNull(d.vendor),
        date: new Date(d.date),
        amountCents: d.amountCents,
        taxCents: d.taxCents,
        category: d.category,
        description: emptyToNull(d.description),
        paymentMethod: d.paymentMethod ?? null,
        jobId: emptyToNull(d.jobId),
        customerId: emptyToNull(d.customerId),
        receiptId,
        status: d.status ?? "SUBMITTED",
        createdById: ctx.user.id,
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "expense.created",
      entityType: "Expense",
      entityId: expense.id,
      metadata: { amountCents: expense.amountCents, category: expense.category },
    });

    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    redirect(`/expenses/${expense.id}`);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
