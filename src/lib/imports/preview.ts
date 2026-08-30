import type { ImportRowAction, ImportRowStatus, PrismaClient } from "@prisma/client";
import { applyMapping, customerGroupKey } from "@/lib/imports/map";
import { actionForDuplicate, buildCustomerIndex, detectDuplicate, type IndexedCustomer } from "@/lib/imports/duplicates";
import { validateMappedCustomer } from "@/lib/imports/validate";
import type {
  DuplicatePolicy,
  ImportMapping,
  MappedCustomer,
  PreviewSummary,
  RowIssue,
} from "@/lib/imports/types";

type PreviewRow = {
  id: string;
  rowNumber: number;
  status: ImportRowStatus;
  action: ImportRowAction;
  duplicateVerdict: "NEW" | "LIKELY_DUPLICATE" | "EXACT_MATCH" | "NEEDS_REVIEW";
  mappedData: MappedCustomer | null;
  issues: RowIssue[];
  targetRecordId: string | null;
  groupKey: string;
};

export function evaluateRows(input: {
  rows: { id: string; rowNumber: number; rawData: Record<string, string> }[];
  mapping: ImportMapping;
  existing: IndexedCustomer[];
  policy: DuplicatePolicy;
}): { evaluated: PreviewRow[]; summary: PreviewSummary } {
  const index = buildCustomerIndex(input.existing);
  const seenGroups = new Map<string, string>();
  const tagSet = new Set<string>();
  let ready = 0;
  let warnings = 0;
  let errors = 0;
  let duplicates = 0;
  let newCustomers = 0;
  let existingCustomers = 0;
  let properties = 0;
  let skippedByPolicy = 0;

  const evaluated = input.rows.map((row) => {
    const { mapped, issues: mapIssues } = applyMapping(row.rawData, input.mapping);
    const validated = validateMappedCustomer(mapped);
    const issues = [...mapIssues, ...validated.issues];
    const groupKey = customerGroupKey(mapped);
    const priorInFile = seenGroups.get(groupKey);
    let verdict = detectDuplicate(mapped, index);
    if (priorInFile && verdict.verdict === "NEW") {
      verdict = {
        verdict: "LIKELY_DUPLICATE",
        match: { customerId: priorInFile, reason: "Same customer appears more than once in this file" },
      };
    }
    if (!priorInFile) seenGroups.set(groupKey, verdict.match?.customerId ?? `file:${groupKey}`);
    mapped.tags.forEach((tag) => tagSet.add(tag));
    properties += mapped.properties.length;

    let status: ImportRowStatus = validated.status;
    if (verdict.verdict !== "NEW" && status !== "ERROR") {
      status = status === "WARNING" ? "WARNING" : "WARNING";
      issues.push({
        level: "WARNING",
        code: "duplicate",
        message: verdict.match?.reason ?? "This looks like a customer you already have.",
      });
    }
    let action: ImportRowAction = actionForDuplicate(verdict.verdict, input.policy);
    if (status === "ERROR") action = "ERROR";
    if (priorInFile && verdict.match?.reason.includes("more than once") && status !== "ERROR") {
      action = "CREATE";
    }

    if (status === "ERROR") errors += 1;
    else if (status === "WARNING") warnings += 1;
    if (verdict.verdict !== "NEW") duplicates += 1;
    if (action === "SKIP") skippedByPolicy += 1;
    if (action === "CREATE" || action === "UPDATE") ready += 1;
    if (action === "CREATE") newCustomers += 1;
    if (action === "UPDATE") existingCustomers += 1;

    return {
      id: row.id,
      rowNumber: row.rowNumber,
      status,
      action,
      duplicateVerdict: verdict.verdict,
      mappedData: mapped,
      issues,
      targetRecordId: verdict.match?.customerId ?? null,
      groupKey,
    };
  });

  return {
    evaluated,
    summary: {
      totalRows: input.rows.length,
      ready,
      warnings,
      errors,
      duplicates,
      newCustomers,
      existingCustomers,
      properties,
      tags: tagSet.size,
      skippedByPolicy,
    },
  };
}

export async function loadExistingCustomers(
  prisma: PrismaClient,
  companyId: string
): Promise<IndexedCustomer[]> {
  const customers = await prisma.customer.findMany({
    where: { companyId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      email: true,
      phone: true,
      sourceSystem: true,
      externalId: true,
      properties: { select: { address: true, city: true, zip: true } },
    },
  });
  return customers;
}

export async function persistPreview(input: {
  prisma: PrismaClient;
  companyId: string;
  sessionId: string;
  evaluated: PreviewRow[];
  summary: PreviewSummary;
}) {
  for (const row of input.evaluated) {
    await input.prisma.importRow.update({
      where: { id: row.id },
      data: {
        status: row.status,
        action: row.action,
        duplicateVerdict: row.duplicateVerdict,
        mappedData: row.mappedData ?? undefined,
        issues: row.issues,
        targetRecordId: row.targetRecordId,
      },
    });
  }
  await input.prisma.importSession.update({
    where: { id: input.sessionId, companyId: input.companyId },
    data: {
      previewSummary: input.summary,
      status: input.summary.errors === input.summary.totalRows ? "FAILED" : "READY_TO_IMPORT",
    },
  });
}
