"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { publicActionError } from "@/lib/action-errors";
import type { ActionResult } from "@/server/actions/auth";
import {
  canManageImportReset,
  dryRunHousecallProReset,
  executeHousecallProReset,
  HCP_RESET_CONFIRMATION,
} from "@/lib/imports/reset";
import { previewQuickBooksHistorical, importQuickBooksHistorical, type QboHistoricalCategory } from "@/lib/quickbooks/historical-import";

export type ImportResetActionResult = ActionResult & {
  operationId?: string;
  dryRun?: boolean;
};

function requireResetAccess(role: string, isPlatformAdmin: boolean) {
  if (!canManageImportReset(role, isPlatformAdmin)) {
    throw new AuthError("Only an owner or platform admin can run an import reset.", 403);
  }
}

export async function dryRunHousecallResetAction(
  _prev: ImportResetActionResult | null,
  _formData: FormData
): Promise<ImportResetActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    requireResetAccess(ctx.role, ctx.user.isPlatformAdmin);
    const result = await dryRunHousecallProReset({
      prisma,
      companyId: ctx.company.id,
      actorId: ctx.user.id,
    });
    revalidatePath("/settings/import");
    return {
      ok: true,
      operationId: result.operationId,
      dryRun: true,
      message: `Dry run complete. ${result.counts.jobs.toLocaleString()} historical Housecall Pro jobs would be removed. Nothing was deleted.`,
    };
  } catch (error) {
    return { ok: false, error: publicActionError(error) };
  }
}

export async function executeHousecallResetAction(
  _prev: ImportResetActionResult | null,
  formData: FormData
): Promise<ImportResetActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    requireResetAccess(ctx.role, ctx.user.isPlatformAdmin);
    const confirmation = String(formData.get("confirmation") || "");
    const acknowledged = String(formData.get("finalConfirm") || "") === "yes";
    if (!acknowledged) {
      return { ok: false, error: "Check the final confirmation box. Nothing was deleted." };
    }
    if (confirmation.trim() !== HCP_RESET_CONFIRMATION) {
      return { ok: false, error: `Type ${HCP_RESET_CONFIRMATION} exactly. Nothing was deleted.` };
    }
    const result = await executeHousecallProReset({
      prisma,
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      confirmation,
    });
    revalidatePath("/settings/import");
    revalidatePath("/jobs");
    revalidatePath("/customers");
    revalidatePath("/dashboard");
    return {
      ok: true,
      operationId: result.operationId,
      dryRun: false,
      message: result.executed
        ? `Housecall Pro import reset completed. Operation ${result.operationId}.`
        : `Nothing left to remove. Operation ${result.operationId} was idempotent.`,
    };
  } catch (error) {
    return { ok: false, error: publicActionError(error) };
  }
}

export async function previewQuickBooksHistoricalAction(
  _prev: ActionResult | null,
  _formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:view");
    const preview = await previewQuickBooksHistorical(prisma, ctx.company.id);
    if (!preview.connected) {
      return { ok: false, error: preview.error || "Connect QuickBooks before previewing historical data." };
    }
    revalidatePath("/settings/import");
    return {
      ok: true,
      message: `QuickBooks preview: ${preview.customers.toLocaleString()} customers, ${preview.invoices.toLocaleString()} invoices, ${preview.payments.toLocaleString()} payments. Nothing was imported.`,
    };
  } catch (error) {
    return { ok: false, error: publicActionError(error) };
  }
}

export async function importQuickBooksHistoricalAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const categories = (["customers", "invoices", "payments", "items", "expenses"] as QboHistoricalCategory[]).filter(
      (category) => formData.get(category) === "on"
    );
    if (!categories.length) {
      return { ok: false, error: "Choose at least one QuickBooks category to import." };
    }
    if (String(formData.get("confirm") || "") !== "IMPORT QUICKBOOKS HISTORY") {
      return { ok: false, error: "Type IMPORT QUICKBOOKS HISTORY to confirm. Nothing was imported." };
    }
    const result = await importQuickBooksHistorical({
      prisma,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      categories,
    });
    revalidatePath("/settings/import");
    revalidatePath("/customers");
    return {
      ok: true,
      message: `Imported ${result.created.invoices} historical invoices and ${result.created.payments} payments. ${result.created.review} records need review. Historical records will not sync back to QuickBooks.`,
    };
  } catch (error) {
    return { ok: false, error: publicActionError(error) };
  }
}
