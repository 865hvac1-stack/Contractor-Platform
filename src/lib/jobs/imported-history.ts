import type { PrismaClient } from "@prisma/client";
import { SOURCE_LABELS, TARGET_FIELD_LABELS, type ImportSourceTypeId } from "@/lib/imports/types";
import { parseCurrencyToCents, parseDate } from "@/lib/imports/normalize";
import { isHistoricalImport } from "@/lib/imports/safety";
import { isWorkFieldKey } from "@/lib/jobs/work-summary";

const HIDDEN_KEYS = new Set([
  "companyid",
  "customerid",
  "propertyid",
  "jobid",
  "invoiceid",
  "estimateid",
  "technicianuserid",
  "sessionid",
  "importsessionid",
  "password",
  "token",
  "secret",
  "apikey",
  "authorization",
]);

const ALREADY_NORMALIZED = new Set([
  "description",
  "notes",
  "status",
  "jobnumber",
  "firstname",
  "lastname",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip",
]);

export type ImportedField = { key: string; label: string; value: string };

export type JobImportSupplement = {
  historical: boolean;
  sourceLabel: string;
  sourceSystem: string | null;
  externalId: string | null;
  importedAt: Date | null;
  occurredAt: Date | null;
  totalCents: number | null;
  description: string | null;
  notes: string | null;
  technicianName: string | null;
  fields: ImportedField[];
  workFields: ImportedField[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isHiddenKey(key: string) {
  const compact = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return HIDDEN_KEYS.has(compact) || compact.includes("secret") || compact.includes("token") || compact.includes("password");
}

function labelFor(key: string) {
  const known = TARGET_FIELD_LABELS[key as keyof typeof TARGET_FIELD_LABELS];
  if (known) return known;
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function sourceSystemLabel(sourceSystem?: string | null) {
  if (!sourceSystem) return "Unknown source";
  return SOURCE_LABELS[sourceSystem as ImportSourceTypeId] ?? sourceSystem.replaceAll("_", " ");
}

export function buildImportedJobSnapshot(values: Record<string, string>): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const text = textOf(value);
    if (!text || isHiddenKey(key)) continue;
    snapshot[key] = text.slice(0, 2000);
  }
  return snapshot;
}

function pushField(fields: ImportedField[], seen: Set<string>, key: string, value: unknown) {
  if (isHiddenKey(key)) return;
  const text = textOf(value);
  if (!text) return;
  const label = labelFor(key);
  const dedupe = `${label.toLowerCase()}:${text}`;
  if (seen.has(dedupe)) return;
  seen.add(dedupe);
  fields.push({ key, label, value: text.slice(0, 2000) });
}

export function publicImportedFields(values: Record<string, unknown>): ImportedField[] {
  const fields: ImportedField[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    if (ALREADY_NORMALIZED.has(key.replace(/[^a-z]/gi, "").toLowerCase())) continue;
    pushField(fields, seen, key, value);
  }
  return fields.slice(0, 40);
}

/** Work-like leftover columns, including notes/description that the job page shows up front. */
export function importedWorkFields(values: Record<string, unknown>): ImportedField[] {
  const fields: ImportedField[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    if (!isWorkFieldKey(key)) continue;
    pushField(fields, seen, key, value);
  }
  return fields.slice(0, 40);
}

function collectImportedNotes(merged: Record<string, unknown>) {
  const parts: string[] = [];
  const seen = new Set<string>();
  const preferred = ["notes", "invoice notes", "job notes", "work performed", "comments"];
  const entries = Object.entries(merged);
  const ordered = [
    ...preferred.flatMap((want) => entries.filter(([key]) => key.replace(/[_-]+/g, " ").toLowerCase() === want)),
    ...entries.filter(([key]) => isWorkFieldKey(key)),
  ];
  for (const [key, value] of ordered) {
    if (!isWorkFieldKey(key)) continue;
    const text = textOf(value);
    const fingerprint = text.replace(/\s+/g, " ").toLowerCase();
    if (!text || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    parts.push(text);
  }
  return parts.join("\n\n") || null;
}

function valuesFromMapped(mapped: unknown): Record<string, unknown> {
  const root = asRecord(mapped);
  const nested = asRecord(root.values);
  return Object.keys(nested).length ? nested : root;
}

export async function loadJobImportSupplement(
  prisma: PrismaClient,
  input: {
    companyId: string;
    jobId: string;
    importMode?: string | null;
    importSessionId?: string | null;
    sourceSystem?: string | null;
    externalId?: string | null;
    importedSnapshot?: unknown;
    importedOccurredAt?: Date | null;
    importedTotalCents?: number | null;
    importedTechnicianName?: string | null;
    description?: string | null;
    internalNotes?: string | null;
    createdAt: Date;
  }
): Promise<JobImportSupplement> {
  const historical = isHistoricalImport(input.importMode);
  let session: { sourceType: string; createdAt: Date; fileName: string } | null = null;
  let rowValues: Record<string, unknown> = {};
  let rawValues: Record<string, unknown> = {};

  if (input.importSessionId) {
    session = await prisma.importSession.findFirst({
      where: { id: input.importSessionId, companyId: input.companyId },
      select: { sourceType: true, createdAt: true, fileName: true },
    });
    const row = await prisma.importRow.findFirst({
      where: {
        companyId: input.companyId,
        targetRecordId: input.jobId,
        ...(input.importSessionId ? { importSessionId: input.importSessionId } : {}),
      },
      select: { mappedData: true, rawData: true },
    });
    if (row) {
      rowValues = valuesFromMapped(row.mappedData);
      rawValues = asRecord(row.rawData);
    }
  }

  const snapshot = asRecord(input.importedSnapshot);
  const merged = { ...rawValues, ...rowValues, ...snapshot };
  const occurredAt =
    input.importedOccurredAt ?? parseDate(textOf(merged.createdDate) || textOf(merged.issueDate));
  const totalCents =
    input.importedTotalCents ?? parseCurrencyToCents(textOf(merged.total) || textOf(merged.jobAmount));

  return {
    historical,
    sourceLabel: sourceSystemLabel(session?.sourceType || input.sourceSystem),
    sourceSystem: session?.sourceType || input.sourceSystem || null,
    externalId: input.externalId || textOf(merged.externalId) || textOf(merged.jobNumber) || null,
    importedAt: session?.createdAt ?? (historical ? input.createdAt : null),
    occurredAt,
    totalCents: totalCents && totalCents > 0 ? totalCents : null,
    description: input.description || textOf(merged.description) || null,
    notes: collectImportedNotes(merged) || textOf(merged.notes) || null,
    technicianName: input.importedTechnicianName || textOf(merged.technicianName) || null,
    fields: publicImportedFields(merged),
    workFields: importedWorkFields(merged),
  };
}
