"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import type { ActionResult } from "@/server/actions/auth";
import { getActiveQuickBooksScope } from "@/lib/quickbooks/ownership";
import { runQuickBooksImportAnalysis } from "@/lib/quickbooks/analysis";
import { importApprovedQuickBooksRecords } from "@/lib/quickbooks/inbound-import";
import { applyQuickBooksReviewDecision, type ReviewDecision } from "@/lib/quickbooks/inbound-review";
import { IMPORT_CONFIRMATION } from "@/lib/quickbooks/inbound-types";
import { QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE } from "@/lib/quickbooks/writeback";
import { requestQuickBooksPreviewRefresh } from "@/lib/quickbooks/production-preview";

function paths() {
  revalidatePath("/settings/quickbooks/manage");
  revalidatePath("/settings/quickbooks/preview");
  revalidatePath("/customers");
  revalidatePath("/money");
}

export async function analyzeQuickBooksImportAction(
  _prev?: ActionResult | null,
  formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const resumeRunId = String(formData?.get("resumeRunId") || "") || null;
    const result = await runQuickBooksImportAnalysis({
      prisma,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      resumeRunId,
    });
    if (!result.ok) return result;
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.analysis",
      entityType: "QuickBooksSyncRun",
      entityId: result.runId,
      metadata: { paused: result.paused, finished: result.finished },
    });
    paths();
    return {
      ok: true,
      message: result.finished
        ? "Import analysis finished. Nothing was written to QuickBooks or created as live ContractorYou work."
        : "Analysis paused to respect QuickBooks rate limits. Continue analysis to resume from the checkpoint.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Analysis failed." };
  }
}

export async function importApprovedQuickBooksAction(
  _prev?: ActionResult | null,
  formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const confirmation = String(formData?.get("confirm") || "");
    const stage = Number(formData?.get("stage") || "0");
    const resumeRunId = String(formData?.get("resumeRunId") || "") || null;
    const result = await importApprovedQuickBooksRecords({
      prisma,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      stage,
      confirmation,
      resumeRunId,
    });
    if (!result.ok) return result;
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "quickbooks.import_approved",
      entityType: "QuickBooksSyncRun",
      entityId: result.runId,
      metadata: { stage, created: result.created, updated: result.updated, linked: result.linked, failed: result.failed },
    });
    paths();
    return {
      ok: true,
      message: result.paused
        ? `Imported a batch (created ${result.created}, linked ${result.linked}, failed ${result.failed}). Resume to continue from the checkpoint. ${result.writeBack}`
        : `Stage ${stage} finished. Created ${result.created}, updated ${result.updated}, linked ${result.linked}. ${result.writeBack}`,
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Import failed." };
  }
}

export async function applyQuickBooksReviewAction(
  _prev?: ActionResult | null,
  formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const active = await getActiveQuickBooksScope(prisma, ctx.company.id);
    if (!active.ok) return active;
    const action = String(formData?.get("decision") || "") as ReviewDecision;
    const result = await applyQuickBooksReviewDecision({
      prisma,
      companyId: ctx.company.id,
      scope: active.scope,
      reviewId: String(formData?.get("reviewId") || ""),
      action,
      targetCustomerId: String(formData?.get("targetCustomerId") || "") || null,
    });
    paths();
    return result;
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save that review decision." };
  }
}

export async function syncChangesDisabledAction(): Promise<ActionResult> {
  await requirePermission("accounting:view");
  return { ok: false, error: QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE };
}

export async function refreshPreviewFromSyncCenterAction(
  prev?: ActionResult | null,
  formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("accounting:view");
    const active = await getActiveQuickBooksScope(prisma, ctx.company.id);
    if (!active.ok) return active;
    const refresh = requestQuickBooksPreviewRefresh(active.scope);
    if (!refresh.ok) {
      return {
        ok: false,
        error: `Please wait ${refresh.retryAfterSeconds} seconds before refreshing the QuickBooks preview again.`,
      };
    }
    paths();
    return { ok: true, message: "Read-only preview refresh requested." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not refresh preview." };
  }
}

export { IMPORT_CONFIRMATION };
