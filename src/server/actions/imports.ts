"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { isNextRedirect, publicActionError } from "@/lib/action-errors";
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
import { emptyAccounting, executeEntityBatch, previewEntityRows, summarizeEntityImport } from "@/lib/imports/engine";
import { catalogAliases, FOUNDATION_ENTITY_TYPES, FOUNDATION_REASON, isLiveImportType } from "@/lib/imports/catalog";
import { detectRecordType } from "@/lib/imports/detect-record";
import { rollbackImportSession } from "@/lib/imports/rollback";
import { suggestUnmappedColumns } from "@/lib/imports/suggest";
import { computeQualityScore } from "@/lib/imports/quality";
import { headerFingerprint } from "@/lib/imports/normalize";
import type { ImportRecordType, ImportRowAction, ImportSourceType } from "@prisma/client";

export type ImportActionResult = ActionResult & { sessionId?: string; remaining?: number; done?: boolean };

function asRecordType(value: FormDataEntryValue | null): ImportRecordTypeId | null {
  const text = String(value || "") as ImportRecordTypeId;
  return LIVE_IMPORT_RECORD_TYPES.includes(text) ? text : null;
}

function foundationMessage(value: FormDataEntryValue | null): string | null {
  const text = String(value || "");
  if (FOUNDATION_ENTITY_TYPES.includes(text as ImportRecordTypeId)) {
    return FOUNDATION_REASON[text] ?? "That record type is not open yet.";
  }
  return null;
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
    const foundation = foundationMessage(formData.get("recordType"));
    if (foundation) return { ok: false, error: foundation };
    const recordType = asRecordType(formData.get("recordType"));
    if (!recordType) return { ok: false, error: "Choose what you want to import." };
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
    const recordGuess = detectRecordType(parsed.headers);
    const fingerprint = headerFingerprint(parsed.headers);
    const saved = await prisma.importMappingProfile.findFirst({
      where: {
        companyId: ctx.company.id,
        recordType: recordType as ImportRecordType,
        headerFingerprint: fingerprint,
      },
    });
    let mapping = saved
      ? (saved.mapping as ImportMapping)
      : autoMapColumns(columns, detection.presetMapping, catalogAliases(recordType));
    if (!saved) mapping = await suggestUnmappedColumns({ columns, mapping });
    const analysis: FileAnalysis = analysisFromParsed(parsed, {
      columns,
      detectedSource: detection.detectedSource,
      detectedSourceLabel: detection.detectedSourceLabel,
      detectedSourceConfidence: detection.detectedSourceConfidence,
      presetName: detection.presetName,
      message: [recordGuess.message, detection.message].filter(Boolean).join(" "),
    });
    let migrationProjectId = String(formData.get("migrationProjectId") || "") || null;
    const newProject = String(formData.get("newMigrationName") || "").trim();
    if (newProject) {
      const project = await prisma.migrationProject.create({
        data: {
          companyId: ctx.company.id,
          name: newProject.slice(0, 120),
          sourceType: sourceType as ImportSourceType,
        },
      });
      migrationProjectId = project.id;
    }

    const session = await prisma.importSession.create({
      data: {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        recordType: recordType as ImportRecordType,
        sourceType: sourceType as ImportSourceType,
        fileName: file.name.slice(0, 255),
        fileHash: parsed.fileHash,
        mimeType: file.type || null,
        encoding: parsed.encoding,
        status: "MAPPING_REQUIRED",
        rowCount: parsed.rows.length,
        analysis: analysis as object,
        mapping: mapping as object,
        importMode: "HISTORICAL",
        detectedRecordType: recordGuess.type,
        migrationProjectId,
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
    if (session.recordType === "CUSTOMERS" && !hasIdentityMapping(mapping)) {
      return { ok: false, error: "Match at least a customer name, full name, or company name." };
    }
    const mappedTargets = new Set(mapping.columns.map((column) => column.target));
    if (session.recordType !== "CUSTOMERS" && mappedTargets.size <= 1) {
      return { ok: false, error: "Match at least one column so we know what this file contains." };
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
    const prepared = rows.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      rawData: row.rawData as Record<string, string>,
    }));
    if (session.recordType === "CUSTOMERS") {
      const existing = await loadExistingCustomers(prisma, ctx.company.id);
      const { evaluated, summary } = evaluateRows({ rows: prepared, mapping, existing, policy });
      await persistPreview({
        prisma,
        companyId: ctx.company.id,
        sessionId: session.id,
        evaluated,
        summary,
      });
    } else if (isLiveImportType(session.recordType)) {
      const { evaluated, summary } = await previewEntityRows({
        prisma,
        companyId: ctx.company.id,
        sourceSystem: session.sourceType,
        recordType: session.recordType,
        mapping,
        rows: prepared,
      });
      await persistPreview({
        prisma,
        companyId: ctx.company.id,
        sessionId: session.id,
        evaluated,
        summary: {
          totalRows: summary.totalRows,
          ready: summary.ready,
          warnings: summary.warnings,
          errors: summary.errors,
          duplicates: summary.duplicates,
          newCustomers: 0,
          existingCustomers: 0,
          properties: 0,
          tags: 0,
          skippedByPolicy: 0,
          unmatchedCustomers: summary.unmatchedCustomers,
          unmatchedProperties: summary.unmatchedProperties,
          unmatchedRelations: summary.unmatchedRelations,
          unknownTechnicians: summary.unknownTechnicians,
          accounting: summary.accounting,
        },
      });
    } else {
      return { ok: false, error: "That record type is not open yet." };
    }
    const refreshed = await prisma.importSession.findFirst({
      where: { id: session.id, companyId: ctx.company.id },
    });
    const qualityScore = computeQualityScore({
      totalRows: session.rowCount,
      preview: refreshed?.previewSummary as never,
      accounting: refreshed?.rowAccounting as never,
    });
    await prisma.importSession.update({
      where: { id: session.id, companyId: ctx.company.id },
      data: { duplicatePolicy: policy, qualityScore },
    });
    revalidatePath(`/settings/import/${session.id}`);
    return { ok: true, sessionId: session.id };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    const message = error instanceof Error ? error.message : "";
    if (
      /too many clients|Too many database connections|remaining connection slots|Can't reach database/i.test(
        message
      )
    ) {
      return { ok: false, error: publicActionError(error) };
    }
    return { ok: false, error: message || "Could not preview this file." };
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
    const result =
      session.recordType === "CUSTOMERS"
        ? await executeImportBatch({
            prisma,
            companyId: ctx.company.id,
            sessionId: session.id,
          })
        : await executeEntityBatch({
            prisma,
            companyId: ctx.company.id,
            userId: ctx.user.id,
            sessionId: session.id,
          });
    if (result.done) {
      const refreshed = await prisma.importSession.findFirst({
        where: { id: session.id, companyId: ctx.company.id },
      });
      const intelligence =
        session.recordType === "CUSTOMERS"
          ? await summarizeImportedCustomers({
              prisma,
              companyId: ctx.company.id,
              sessionId: session.id,
            })
          : summarizeEntityImport(
              session.recordType,
              "accounting" in result ? result.accounting : emptyAccounting()
            );
      const qualityScore = computeQualityScore({
        totalRows: session.rowCount,
        preview: refreshed?.previewSummary as never,
        accounting: (refreshed?.rowAccounting as never) ?? ("accounting" in result ? result.accounting : null),
      });
      await prisma.importSession.update({
        where: { id: session.id, companyId: ctx.company.id },
        data: { intelligence, qualityScore },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: result.done ? "import.completed" : "import.batch",
      entityType: "ImportSession",
      entityId: session.id,
      metadata: { remaining: result.remaining, done: result.done },
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
    const result =
      session.recordType === "CUSTOMERS"
        ? await executeImportBatch({
            prisma,
            companyId: ctx.company.id,
            sessionId: session.id,
          })
        : await executeEntityBatch({
            prisma,
            companyId: ctx.company.id,
            userId: ctx.user.id,
            sessionId: session.id,
          });
    if (result.done) {
      const refreshed = await prisma.importSession.findFirst({
        where: { id: session.id, companyId: ctx.company.id },
      });
      const intelligence =
        session.recordType === "CUSTOMERS"
          ? await summarizeImportedCustomers({
              prisma,
              companyId: ctx.company.id,
              sessionId: session.id,
            })
          : summarizeEntityImport(
              session.recordType,
              "accounting" in result ? result.accounting : emptyAccounting()
            );
      const qualityScore = computeQualityScore({
        totalRows: session.rowCount,
        preview: refreshed?.previewSummary as never,
        accounting: (refreshed?.rowAccounting as never) ?? ("accounting" in result ? result.accounting : null),
      });
      await prisma.importSession.update({
        where: { id: session.id, companyId: ctx.company.id },
        data: { intelligence, qualityScore },
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
      return { ok: false, error: "Type ROLLBACK to confirm. This only removes records created by this import." };
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

export async function saveCompanyMappingAction(
  _prev: ImportActionResult | null,
  formData: FormData
): Promise<ImportActionResult> {
  try {
    const ctx = await requirePermission("imports:manage");
    const sessionId = String(formData.get("sessionId") || "");
    const label = String(formData.get("name") || "Saved mapping").trim().slice(0, 80) || "Saved mapping";
    const session = await loadOwnedSession(ctx.company.id, sessionId);
    const analysis = session.analysis as FileAnalysis | null;
    const fingerprint = headerFingerprint(analysis?.headers ?? []);
    const existing = await prisma.importMappingProfile.findFirst({
      where: {
        companyId: ctx.company.id,
        recordType: session.recordType,
        headerFingerprint: fingerprint,
      },
    });
    if (existing) {
      await prisma.importMappingProfile.update({
        where: { id: existing.id },
        data: { name: label, mapping: session.mapping ?? {}, sourceType: session.sourceType },
      });
    } else {
      await prisma.importMappingProfile.create({
        data: {
          companyId: ctx.company.id,
          name: label,
          sourceType: session.sourceType,
          recordType: session.recordType,
          headerFingerprint: fingerprint,
          mapping: session.mapping ?? {},
          isSystem: false,
        },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "import.mapping_saved",
      entityType: "ImportSession",
      entityId: session.id,
      metadata: { name: label, recordType: session.recordType },
    });
    revalidatePath(`/settings/import/${session.id}`);
    return { ok: true, sessionId };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not save that mapping." };
  }
}

