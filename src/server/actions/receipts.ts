"use server";

import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { isNextRedirect } from "@/lib/action-errors";
import type { ActionResult } from "@/server/actions/auth";
import { findPossibleDuplicate } from "@/lib/receipts/duplicates";
import { suggestReceiptFields } from "@/lib/receipts/extract";
import { expenseToJobCostCategory } from "@/lib/costing/categories";
import { recordJobCost } from "@/lib/costing/record";
import type { ExpenseCategory, PaymentMethod, ReceiptAssignment } from "@prisma/client";

function uploadRoot() {
  return process.env.UPLOAD_DIR || "./uploads";
}

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function uploadReceiptAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("receipts:manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Take a photo or choose a file." };
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: "Keep receipts under 10 MB." };
    if (!ALLOWED.includes(file.type)) return { ok: false, error: "Use a photo or PDF." };
    const requestedAssignment = String(formData.get("assignment") || "");
    const vehicleId = String(formData.get("vehicleId") || "") || null;
    const rawJobId = String(formData.get("jobId") || "") || null;
    const assignment: ReceiptAssignment =
      requestedAssignment === "VEHICLE"
        ? "VEHICLE"
        : requestedAssignment === "OVERHEAD"
          ? "OVERHEAD"
          : rawJobId
            ? "JOB"
            : "UNASSIGNED";
    const jobId = assignment === "JOB" ? rawJobId : null;
    if (jobId) {
      const job = await prisma.job.findFirst({ where: { id: jobId, companyId: ctx.company.id } });
      if (!job) return { ok: false, error: "That job is not in your company." };
    }
    if (vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId: ctx.company.id } });
      if (!vehicle) return { ok: false, error: "That vehicle is not in your company." };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const companyDir = path.join(uploadRoot(), ctx.company.id, "receipts");
    await mkdir(companyDir, { recursive: true });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "receipt.jpg";
    const storedName = `${Date.now()}-${safeName}`;
    await writeFile(path.join(companyDir, storedName), buffer);

    const suggestion = await suggestReceiptFields({
      fileName: file.name,
      mimeType: file.type,
      imageBase64: file.type.startsWith("image/") ? buffer.toString("base64") : undefined,
    });
    const duplicate = await findPossibleDuplicate(prisma, {
      companyId: ctx.company.id,
      fileHash,
      vendor: suggestion.vendor,
      totalCents: suggestion.totalCents,
      receiptDate: suggestion.date ? new Date(suggestion.date) : null,
    });

    const receipt = await prisma.receipt.create({
      data: {
        companyId: ctx.company.id,
        uploadedById: ctx.user.id,
        fileName: file.name,
        filePath: path.join(ctx.company.id, "receipts", storedName),
        mimeType: file.type,
        fileSizeBytes: file.size,
        fileHash,
        processingStatus: "REVIEW_REQUIRED",
        assignment,
        jobId,
        vehicleId,
        vendor: suggestion.vendor,
        receiptDate: suggestion.date ? new Date(suggestion.date) : null,
        subtotalCents: suggestion.subtotalCents,
        extractedTaxCents: suggestion.taxCents,
        totalCents: suggestion.totalCents,
        extractedMerchant: suggestion.vendor,
        extractedDate: suggestion.date ? new Date(suggestion.date) : null,
        extractedTotalCents: suggestion.totalCents,
        suggestedCategory: (suggestion.category as ExpenseCategory | null) ?? null,
        category: (suggestion.category as ExpenseCategory | null) ?? null,
        lastFour: suggestion.lastFour,
        confidence: suggestion.confidence,
        duplicateStatus: duplicate ? "POSSIBLE" : "NONE",
        duplicateOfId: duplicate?.id ?? null,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receipt.uploaded",
      entityType: "Receipt",
      entityId: receipt.id,
      metadata: { fileName: file.name, duplicate: Boolean(duplicate) },
    });
    revalidatePath("/receipts");
    const returnTo = String(formData.get("returnTo") || "");
    if (returnTo.startsWith("/tech")) {
      revalidatePath(returnTo);
      redirect(returnTo);
    }
    redirect(`/receipts/${receipt.id}`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not save that receipt." };
  }
}

export async function reviewReceiptAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("receipts:manage");
    const receiptId = String(formData.get("receiptId") || "");
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, companyId: ctx.company.id },
    });
    if (!receipt) return { ok: false, error: "Receipt not found." };
    const assignment = (String(formData.get("assignment") || "UNASSIGNED") as ReceiptAssignment) || "UNASSIGNED";
    const jobId = String(formData.get("jobId") || "") || null;
    const vehicleId = String(formData.get("vehicleId") || "") || null;
    if (assignment === "JOB" && jobId) {
      const job = await prisma.job.findFirst({ where: { id: jobId, companyId: ctx.company.id } });
      if (!job) return { ok: false, error: "Choose a job from your company." };
    }
    if (assignment === "VEHICLE" && vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId: ctx.company.id } });
      if (!vehicle) return { ok: false, error: "Choose a truck from your company." };
    }
    const amount = Math.round(parseFloat(String(formData.get("total") || "0")) * 100);
    if (!amount) return { ok: false, error: "Enter the receipt total." };
    const vendor = String(formData.get("vendor") || "").trim() || null;
    const dateRaw = String(formData.get("date") || "");
    const category = (String(formData.get("category") || "OTHER") as ExpenseCategory) || "OTHER";
    const description = String(formData.get("description") || "").trim() || null;
    const confirm = String(formData.get("confirm") || "") === "yes";

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        vendor,
        receiptDate: dateRaw ? new Date(dateRaw) : null,
        totalCents: amount,
        extractedTaxCents: Math.round(parseFloat(String(formData.get("tax") || "0")) * 100) || receipt.extractedTaxCents,
        subtotalCents: Math.round(parseFloat(String(formData.get("subtotal") || "0")) * 100) || null,
        category,
        description,
        paymentMethod: (String(formData.get("paymentMethod") || "") as PaymentMethod) || null,
        assignment,
        jobId: assignment === "JOB" ? jobId : null,
        vehicleId: assignment === "VEHICLE" ? vehicleId : null,
        notes: String(formData.get("notes") || "").trim() || null,
        processingStatus: confirm ? "CONFIRMED" : "REVIEW_REQUIRED",
        confirmedAt: confirm ? new Date() : null,
        duplicateStatus: String(formData.get("ignoreDuplicate") || "") === "yes" ? "NONE" : receipt.duplicateStatus,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: confirm ? "receipt.confirmed" : "receipt.edited",
      entityType: "Receipt",
      entityId: receipt.id,
    });

    if (confirm) {
      const existingExpense = await prisma.expense.findFirst({
        where: { companyId: ctx.company.id, receiptId: receipt.id },
      });
      const expense =
        existingExpense ??
        (await prisma.expense.create({
          data: {
            companyId: ctx.company.id,
            vendor,
            date: dateRaw ? new Date(dateRaw) : new Date(),
            amountCents: amount,
            taxCents: Math.round(parseFloat(String(formData.get("tax") || "0")) * 100) || 0,
            category,
            description,
            paymentMethod: (String(formData.get("paymentMethod") || "") as PaymentMethod) || null,
            jobId: assignment === "JOB" ? jobId : null,
            receiptId: receipt.id,
            status: "POSTED",
            createdById: ctx.user.id,
          },
        }));
      if (assignment === "JOB" && jobId) {
        await recordJobCost(prisma, {
          companyId: ctx.company.id,
          jobId,
          createdById: ctx.user.id,
          category: expenseToJobCostCategory(category),
          description: vendor || description,
          amountCents: amount,
          sourceType: "RECEIPT",
          sourceId: receipt.id,
          receiptId: receipt.id,
          expenseId: expense.id,
          confirmed: true,
        });
      }
    }
    revalidatePath("/receipts");
    revalidatePath(`/receipts/${receipt.id}`);
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save that receipt." };
  }
}

export async function createVehicleAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("receipts:manage");
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Give the truck a name." };
    await prisma.vehicle.create({
      data: {
        companyId: ctx.company.id,
        name,
        unitNumber: String(formData.get("unitNumber") || "").trim() || null,
        make: String(formData.get("make") || "").trim() || null,
        model: String(formData.get("model") || "").trim() || null,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "vehicle.created",
      entityType: "Vehicle",
    });
    revalidatePath("/receipts");
    revalidatePath("/settings/quickbooks");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not add that truck." };
  }
}
