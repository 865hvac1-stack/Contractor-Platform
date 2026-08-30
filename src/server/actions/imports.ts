"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { isNextRedirect } from "@/lib/action-errors";
import type { ActionResult } from "@/server/actions/auth";
import {
  IMPORT_SOURCE_TYPES,
  LIVE_IMPORT_RECORD_TYPES,
  type DuplicatePolicy,
  type FileAnalysis,
  type ImportMapping,
  type ImportRecordTypeId,
  type ImportSourceTypeId,
} from "@/lib/imports/types";
import { analysisFromParsed, parseImportFile } from "@/lib/imports/parse";
import { analyzeColumns, autoMapColumns } from "@/lib/imports/detect";
import { describeDetection } from "@/lib/imports/presets";
import { hasIdentityMapping, incompatibleMappings, mappingFromForm } from "@/lib/imports/map";
import { evaluateRows, loadExistingCustomers, persistPreview } from "@/lib/imports/preview";
import { executeImportBatch, summarizeImportedCustomers } from "@/lib/imports/execute";
import { rollbackImportSession } from "@/lib/imports/rollback";
import { suggestUnmappedColumns } from "@/lib/imports/suggest";
import type { ImportRowAction, ImportSourceType } from "@prisma/client";

export type ImportActionResult = ActionResult & { sessionId?: string; remaining?: number; done?: boolean };

function asRecordType(value: FormDataEntryValue | null): ImportRecordTypeId | null {
  const text = String(value || "");
  return LIVE_IMPORT_RECORD_TYPES.includes(text as ImportRecordTypeId)
    ? (text as ImportRecordTypeId)
    : (text as ImportRecordTypeId) || null;
}

function asSourceType(value: FormDataEntryValue | null): ImportSourceTypeId {
  const text = String(value || "UNKNOWN");
  return (IMPORT_SOURCE_TYPES as readonly string[]).includes(text)
    ? (text as ImportSourceTypeId)
    : "UNKNOWN";
}

async function loadOwnedSession(companyId: string, sessionId: string) {
  const session = await prisma.importSession.findFirst({
    where: { id: sessionId, companyId },
  });
  if (!session) throw new Error("We could not find that import.");
  return session;
}

export async function uploadImportFileAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const recordType = asRecordType(formData.get("recordType"));
    if (!recordType) return { ok: false, error: "Choose what you want to import." };
    if (!LIVE_IMPORT_RECORD_TYPES.includes(recordType)) {
      return {
        ok: false,
        error: "That record type is not open yet. Customer import is ready — other types are coming next.",
      };
    }
    const sourceType = asSourceType(formData.get("sourceType"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a CSV or Excel file to upload." };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseImportFile({
      fileName: file.name,
      mimeType: file.type,
      buffer,
    });
    const columns = analyzeColumns(parsed.headers, parsed.rows);
    const detection = describeDetection(sourceType, parsed.headers);
    let mapping = autoMapColumns(columns, detection.presetMapping);
    mapping = await suggestUnmappedColumns({ columns, mapping });
    const analysis: FileAnalysis = analysisFromParsed(parsed, {
      columns,
      detectedSource: detection.detectedSource,
      detectedSourceLabel: detection.detectedSourceLabel,
      detectedSourceConfidence: detection.detectedSourceConfidence,
      presetName: detection.presetName,
      message: detection.message,
    });

    const session = await prisma.importSession.create({
      data: {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        recordType: "CUSTOMERS",
        sourceType: sourceType as ImportSourceType,
        fileName: file.name.slice(0, 255),
        fileHash: parsed.fileHash,
        mimeType: file.type || null,
        encoding: parsed.encoding,
        status: "MAPPING_REQUIRED",
        rowCount: parsed.rows.length,
        analysis: analysis as object,
        mapping: mapping as object,
      },
    });

    await prisma.importRow.createMany({
      data: parsed.rows.map((row, index) => ({
        companyId: ctx.company.id,
        importSessionId: session.id,
        rowNumber: index + 1,
        rawData: row,
      })),
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "import.uploaded",
      entityType: "ImportSession",
      entityId: session.id,
      metadata: { fileName: file.name, rowCount: parsed.rows.length, sourceType },
    });

    revalidatePath("/settings/import");
    redirect(`/settings/import/${session.id}`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "We could not read that file." };
  }
}

export async function saveImportMappingAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const sessionId = String(formData.get("sessionId") || "");
    const session = await loadOwnedSession(ctx.company.id, sessionId);
    if (["IMPORTING", "COMPLETED", "CANCELLED"].includes(session.status)) {
      return { ok: false, error: "This import can no longer be mapped." };
    }
    const analysis = session.analysis as FileAnalysis | null;
    const headers = analysis?.headers ?? [];
    const selected: Record<string, string> = {};
    for (const header of headers) {
      selected[header] = String(formData.get(`map:${header}`) || "ignore");
    }
    const mapping = mappingFromForm(headers, selected, session.mapping as ImportMapping | null);
    if (!hasIdentityMapping(mapping)) {
      return { ok: false, error: "Match at least a customer name, full name, or company name." };
    }
    const kinds = Object.fromEntries((analysis?.columns ?? []).map((column) => [column.header, column.inferredKind]));
    const conflicts = incompatibleMappings(mapping, kinds);
    if (conflicts.length) {
      return { ok: false, error: conflicts[0] ?? "One of those column matches does not make sense." };
    }

    await prisma.importSession.update({
      where: { id: session.id, companyId: ctx.company.id },
      data: { mapping: mapping as object, status: "READY_FOR_PREVIEW" },
    });
    revalidatePath(`/settings/import/${session.id}`);
    redirect(`/settings/import/${session.id}`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not save those matches." };
  }
}

export async function buildImportPreviewAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const sessionId = String(formData.get("sessionId") || "");
    const policy = (String(formData.get("duplicatePolicy") || "SKIP") as DuplicatePolicy) || "SKIP";
    const session = await loadOwnedSession(ctx.company.id, sessionId);
    const mapping = session.mapping as ImportMapping | null;
    if (!mapping) return { ok: false, error: "Match your columns before previewing." };
    const rows = await prisma.importRow.findMany({
      where: { companyId: ctx.company.id, importSessionId: session.id },
      orderBy: { rowNumber: "asc" },
    });
    const existing = await loadExistingCustomers(prisma, ctx.company.id);
    const { evaluated, summary } = evaluateRows({
      rows: rows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        rawData: row.rawData as Record<string, string>,
      })),
      mapping,
      existing,
      policy,
    });
    await persistPreview({
      prisma,
      companyId: ctx.company.id,
      sessionId: session.id,
      evaluated,
      summary,
    });
    await prisma.importSession.update({
      where: { id: session.id, companyId: ctx.company.id },
      data: { duplicatePolicy: policy },
    });
    revalidatePath(`/settings/import/${session.id}`);
    return { ok: true, sessionId: session.id };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not preview this file." };
  }
}

export async function confirmImportAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const sessionId = String(formData.get("sessionId") || "");
    const confirm = String(formData.get("confirm") || "");
    if (confirm !== "yes") {
      return { ok: false, error: "Check the box to confirm you want to import these records." };
    }
    const session = await loadOwnedSession(ctx.company.id, sessionId);
    if (!["READY_TO_IMPORT", "PARTIAL", "IMPORTING"].includes(session.status)) {
      return { ok: false, error: "Preview the file and resolve what you can before importing." };
    }
    await prisma.importSession.update({
      where: { id: session.id, companyId: ctx.company.id },
      data: { confirmedAt: new Date(), status: "IMPORTING", startedAt: session.startedAt ?? new Date() },
    });
    const result = await executeImportBatch({
      prisma,
      companyId: ctx.company.id,
      sessionId: session.id,
    });
    if (result.done) {
      const intelligence = await summarizeImportedCustomers({
        prisma,
        companyId: ctx.company.id,
        sessionId: session.id,
      });
      await prisma.importSession.update({
        where: { id: session.id, companyId: ctx.company.id },
        data: { intelligence },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: result.done ? "import.completed" : "import.batch",
      entityType: "ImportSession",
      entityId: session.id,
      metadata: { ...result.summary, remaining: result.remaining },
    });
    revalidatePath("/customers");
    revalidatePath("/settings/import");
    revalidatePath(`/settings/import/${session.id}`);
    return { ok: true, sessionId: session.id, remaining: result.remaining, done: result.done };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Import could not start." };
  }
}

export async function continueImportAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const sessionId = String(formData.get("sessionId") || "");
    const session = await loadOwnedSession(ctx.company.id, sessionId);
    if (!session.confirmedAt) return { ok: false, error: "Confirm this import before continuing." };
    const result = await executeImportBatch({
      prisma,
      companyId: ctx.company.id,
      sessionId: session.id,
    });
    if (result.done) {
      const intelligence = await summarizeImportedCustomers({
        prisma,
        companyId: ctx.company.id,
        sessionId: session.id,
      });
      await prisma.importSession.update({
        where: { id: session.id, companyId: ctx.company.id },
        data: { intelligence },
      });
    }
    revalidatePath("/customers");
    revalidatePath(`/settings/import/${session.id}`);
    return { ok: true, sessionId: session.id, remaining: result.remaining, done: result.done };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not continue this import." };
  }
}

export async function cancelImportAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const sessionId = String(formData.get("sessionId") || "");
    const session = await loadOwnedSession(ctx.company.id, sessionId);
    if (["COMPLETED", "IMPORTING"].includes(session.status) && session.processedRows > 0) {
      return { ok: false, error: "This import already wrote records. Use rollback if you need to undo it." };
    }
    await prisma.importSession.update({
      where: { id: session.id, companyId: ctx.company.id },
      data: { status: "CANCELLED" },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "import.cancelled",
      entityType: "ImportSession",
      entityId: session.id,
    });
    revalidatePath("/settings/import");
    redirect("/settings/import");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not cancel that import." };
  }
}

export async function rollbackImportAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    if (ctx.role !== "COMPANY_OWNER") {
      return { ok: false, error: "Only a company owner can undo an import." };
    }
    if (String(formData.get("confirmText") || "") !== "ROLLBACK") {
      return { ok: false, error: "Type ROLLBACK to confirm. This only removes customers created by this import." };
    }
    const sessionId = String(formData.get("sessionId") || "");
    const session = await loadOwnedSession(ctx.company.id, sessionId);
    const result = await rollbackImportSession({
      prisma,
      companyId: ctx.company.id,
      sessionId: session.id,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "import.rolled_back",
      entityType: "ImportSession",
      entityId: session.id,
      metadata: result,
    });
    revalidatePath("/customers");
    revalidatePath(`/settings/import/${session.id}`);
    return { ok: true, sessionId: session.id };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not undo that import." };
  }
}

export async function updateRowActionAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const sessionId = String(formData.get("sessionId") || "");
    const rowId = String(formData.get("rowId") || "");
    const action = String(formData.get("action") || "") as ImportRowAction;
    if (!["CREATE", "UPDATE", "SKIP"].includes(action)) {
      return { ok: false, error: "Choose skip, import as new, or update existing." };
    }
    await loadOwnedSession(ctx.company.id, sessionId);
    const row = await prisma.importRow.findFirst({
      where: { id: rowId, companyId: ctx.company.id, importSessionId: sessionId },
    });
    if (!row) return { ok: false, error: "That row is not in this import." };
    if (row.status === "ERROR" && action !== "SKIP") {
      return { ok: false, error: "Fix or skip rows with errors. They cannot be imported as-is." };
    }
    await prisma.importRow.update({
      where: { id: row.id },
      data: { action },
    });
    revalidatePath(`/settings/import/${sessionId}`);
    return { ok: true, sessionId };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not update that row." };
  }
}

