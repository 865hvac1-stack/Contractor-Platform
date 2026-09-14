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
import { QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE } from "@/lib/quickbooks/writeback";
import { requestQuickBooksPreviewRefresh } from "@/lib/quickbooks/production-preview";
import type { AnalysisProgress } from "@/lib/quickbooks/analysis";
import { assertQuickBooksImportStageReady } from "@/lib/quickbooks/import-readiness";

export type AnalyzeQuickBooksState =
  | {
      ok: true;
      message: string;
      runId: string;
      paused: boolean;
      autoContinue: boolean;
      progress: AnalysisProgress;
    }
  | { ok: false; error: string }
  | null;

function logAnalysisFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown analysis failure";
  const safeMessage = message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(access_token|refresh_token|client_secret|password)=\S+/gi, "$1=[REDACTED]")
    .slice(0, 500);
  console.error(
    JSON.stringify({
      source: "quickbooks-analysis",
      event: "failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: safeMessage,
    })
  );
}

function paths() {
  revalidatePath("/settings/quickbooks/manage");
  revalidatePath("/settings/quickbooks/preview");
  revalidatePath("/customers");
  revalidatePath("/money");
}

export async function analyzeQuickBooksImportAction(
  _prev: AnalyzeQuickBooksState,
  formData?: FormData
): Promise<AnalyzeQuickBooksState> {
  try {
    const ctx = await requirePermission("accounting:manage");
    const resumeRunId =
      String(formData?.get("resumeRunId") || "") || (_prev?.ok ? _prev.runId : null);
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
      runId: result.runId,
      paused: result.paused,
      autoContinue: result.autoContinue,
      progress: result.progress,
      message: result.finished
        ? "Import analysis finished. Nothing was written to QuickBooks or created as live ContractorYou work."
        : result.autoContinue
          ? `Analyzing ${result.progress.categoryLabel.toLowerCase()}…`
          : "Analysis paused because QuickBooks did not complete a read request. No records were changed. Continue when ready.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    logAnalysisFailure(error);
    return { ok: false, error: "Import analysis failed. No records were changed." };
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
    const active = await getActiveQuickBooksScope(prisma, ctx.company.id);
    if (!active.ok) return active;
    const readiness = await assertQuickBooksImportStageReady(prisma, active.scope, stage);
    if (!readiness.ok) return readiness;
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
  _prev?: ActionResult | null,
  _formData?: FormData
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
