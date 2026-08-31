import type { ImportRecordType, ImportRowAction, ImportRowStatus, ImportSourceType, Prisma, PrismaClient } from "@prisma/client";
import type { ImportMapping, ImportRecordTypeId, RowIssue } from "@/lib/imports/types";
import { IMPORT_BATCH_SIZE } from "@/lib/imports/types";
import { normalizeEmail, normalizePhone, normalizeText, parseCombinedPersonAddress, parseCurrencyToCents, parseDate, splitFullName, splitTags, unwrapSpreadsheetValue } from "@/lib/imports/normalize";
import {
  loadCompanyLinkIndex,
  matchCustomerFromIndex,
  matchNumberedRecordFromIndex,
  matchPropertyFromIndex,
  matchTeamMemberFromIndex,
  type CompanyLinkIndex,
} from "@/lib/imports/resolve";
import { mapEstimateStatus, mapExpenseCategory, mapInvoiceStatus, mapJobStatus, mapPaymentMethod } from "@/lib/imports/status";
import { nextNumber } from "@/lib/sequences";
import { finalizeAccounting } from "@/lib/imports/quality";
import { historicalProvenanceNote } from "@/lib/imports/safety";
import { buildImportedJobSnapshot } from "@/lib/jobs/imported-history";

export type RowAccounting = {
  sourceRows: number;
  created: number;
  updated: number;
  merged: number;
  duplicates: number;
  skipped: number;
  warningImported: number;
  errors: number;
  other: number;
};

export type EntityPreviewSummary = {
  totalRows: number;
  ready: number;
  warnings: number;
  errors: number;
  duplicates: number;
  unmatchedCustomers: number;
  unmatchedProperties: number;
  unmatchedRelations: number;
  unknownTechnicians: number;
  newRecords: number;
  accounting: RowAccounting;
};

export type MappedEntity = {
  values: Record<string, string>;
  issues: RowIssue[];
  customerId: string | null;
  propertyId: string | null;
  jobId: string | null;
  invoiceId: string | null;
  technicianUserId: string | null;
  technicianName: string | null;
};

function pick(row: Record<string, string>, mapping: ImportMapping, target: string): string {
  const column = mapping.columns.find((entry) => entry.target === target);
  return column ? normalizeText(row[column.sourceColumn] ?? "") : "";
}

export function emptyAccounting(): RowAccounting {
  return {
    sourceRows: 0,
    created: 0,
    updated: 0,
    merged: 0,
    duplicates: 0,
    skipped: 0,
    warningImported: 0,
    errors: 0,
    other: 0,
  };
}

export function accountingTotals(a: RowAccounting): number {
  return a.created + a.updated + a.merged + a.duplicates + a.skipped + a.warningImported + a.errors + a.other;
}

export function applyEntityMapping(row: Record<string, string>, mapping: ImportMapping): Record<string, string> {
  const values: Record<string, string> = {};
  for (const column of mapping.columns) {
    if (column.target === "ignore") continue;
    const text = unwrapSpreadsheetValue(row[column.sourceColumn] ?? "");
    if (text) values[column.target] = text;
  }
  if (values.address && !values.city && !values.zip) {
    const parsed = parseCombinedPersonAddress(values.address);
    if (parsed) {
      if (parsed.name && !values.customerName && !values.firstName) {
        values.customerName = parsed.name;
        values.firstName = parsed.firstName;
        values.lastName = parsed.lastName;
      }
      values.address = parsed.address;
      if (parsed.city) values.city = parsed.city;
      if (parsed.state) values.state = parsed.state;
      if (parsed.zip) values.zip = parsed.zip;
    }
  }
  if (!values.customerName && (values.firstName || values.lastName)) {
    values.customerName = `${values.firstName ?? ""} ${values.lastName ?? ""}`.trim();
  }
  if (!values.firstName && values.customerName) {
    const split = splitFullName(values.customerName);
    values.firstName = split.firstName;
    values.lastName = split.lastName;
  }
  if (!values.externalId && values.propertyExternalId) values.externalId = values.propertyExternalId;
  if (!values.customerEmail && values.email) values.customerEmail = values.email;
  return values;
}

function attachLinksFromIndex(index: CompanyLinkIndex, values: Record<string, string>): MappedEntity {
  const issues: RowIssue[] = [];
  const customer = matchCustomerFromIndex(index, {
    externalId: values.customerExternalId,
    email: values.customerEmail || values.email,
    phone: values.customerPhone || values.phone,
    firstName: values.firstName,
    lastName: values.lastName,
    businessName: values.businessName,
    name: values.customerName,
  });
  if (customer.verdict === "NEEDS_REVIEW") {
    issues.push({ level: "ERROR", code: "customer_ambiguous", message: customer.reason });
  } else if (customer.verdict === "MISSING") {
    issues.push({ level: "ERROR", code: "customer_unmatched", message: customer.reason });
  }
  const property = matchPropertyFromIndex(index, customer.id, {
    externalId: values.propertyExternalId,
    address: values.address,
    city: values.city,
    zip: values.zip,
  });
  const job = matchNumberedRecordFromIndex(index, "JOBS", values.jobExternalId || values.jobNumber);
  const invoice = matchNumberedRecordFromIndex(index, "INVOICES", values.invoiceExternalId || values.documentNumber);
  const tech = matchTeamMemberFromIndex(index, values.technicianName);
  return {
    values,
    issues,
    customerId: customer.id,
    propertyId: property.id,
    jobId: job.id,
    invoiceId: invoice.id,
    technicianUserId: tech.userId,
    technicianName: tech.display,
  };
}

function needsCustomer(type: ImportRecordTypeId) {
  return ["PROPERTIES", "JOBS", "ESTIMATES", "INVOICES", "NOTES", "TAGS", "LEAD_SOURCES"].includes(type);
}

function needsInvoice(type: ImportRecordTypeId) {
  return type === "PAYMENTS";
}

export async function previewEntityRows(input: {
  prisma: PrismaClient;
  companyId: string;
  sourceSystem: ImportSourceType;
  recordType: ImportRecordTypeId;
  mapping: ImportMapping;
  rows: { id: string; rowNumber: number; rawData: Record<string, string> }[];
}) {
  let unmatchedCustomers = 0;
  let unmatchedProperties = 0;
  let unmatchedRelations = 0;
  let unknownTechnicians = 0;
  let warnings = 0;
  let errors = 0;
  let ready = 0;
  const accounting = emptyAccounting();
  accounting.sourceRows = input.rows.length;

  const index = await loadCompanyLinkIndex(input.prisma, input.companyId, input.recordType);
  const evaluated = [];
  for (const row of input.rows) {
    const values = applyEntityMapping(row.rawData, input.mapping);
    const mapped = attachLinksFromIndex(index, values);
    if (input.recordType === "JOBS" && values.status) {
      const status = mapJobStatus(values.status);
      if (!status.recognized) {
        mapped.issues.push({
          level: "WARNING",
          code: "unknown_status",
          message: `We did not recognize status “${values.status}”, so this job will stay New until you change it.`,
        });
      }
    }
    if (needsCustomer(input.recordType) && !mapped.customerId) {
      unmatchedCustomers += 1;
    } else {
      mapped.issues = mapped.issues.filter((issue) => issue.code !== "customer_unmatched");
    }
    if (input.recordType === "JOBS" && mapped.customerId && !mapped.propertyId) {
      unmatchedProperties += 1;
      mapped.issues.push({
        level: "ERROR",
        code: "property_unmatched",
        message: "This job needs a service location. Import properties first, or include an address we can match.",
      });
    }
    if (needsInvoice(input.recordType) && !mapped.invoiceId) {
      unmatchedRelations += 1;
      mapped.issues.push({
        level: "ERROR",
        code: "invoice_unmatched",
        message: "This payment needs an invoice we already have. Import invoices first.",
      });
    }
    if (input.recordType === "EQUIPMENT" && !values.equipmentName && !values.model && !values.serialNumber) {
      mapped.issues.push({ level: "ERROR", code: "missing_equipment", message: "This row needs an equipment name, model, or serial number." });
    }
    if (input.recordType === "EXPENSES" && parseCurrencyToCents(values.expenseAmount) == null) {
      mapped.issues.push({ level: "ERROR", code: "missing_amount", message: "This expense needs an amount." });
    }
    if (input.recordType === "NOTES" && !values.notes) {
      mapped.issues.push({ level: "ERROR", code: "missing_note", message: "This row has no note text." });
    }
    if (values.technicianName && !mapped.technicianUserId) unknownTechnicians += 1;
    const hasError = mapped.issues.some((issue) => issue.level === "ERROR");
    const hasWarning = mapped.issues.some((issue) => issue.level === "WARNING");
    const status: ImportRowStatus = hasError ? "ERROR" : hasWarning ? "WARNING" : "VALID";
    const action: ImportRowAction = hasError ? "ERROR" : "CREATE";
    if (hasError) {
      errors += 1;
      accounting.errors += 1;
    } else if (hasWarning) {
      ready += 1;
      warnings += 1;
      accounting.warningImported += 1;
    } else {
      ready += 1;
      accounting.created += 1;
    }
    evaluated.push({
      id: row.id,
      rowNumber: row.rowNumber,
      status,
      action,
      duplicateVerdict: "NEW" as const,
      mappedData: mapped,
      issues: mapped.issues,
      targetRecordId: mapped.customerId,
    });
  }

  return {
    evaluated,
    summary: {
      totalRows: input.rows.length,
      ready,
      warnings,
      errors,
      duplicates: 0,
      unmatchedCustomers,
      unmatchedProperties,
      unmatchedRelations,
      unknownTechnicians,
      newRecords: ready,
      accounting,
    } satisfies EntityPreviewSummary,
  };
}

async function upsertRef(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    sessionId: string;
    sourceSystem: ImportSourceType;
    recordType: ImportRecordType;
    externalId: string;
    targetRecordId: string;
  }
) {
  await tx.importExternalRef.upsert({
    where: {
      companyId_sourceSystem_recordType_externalId: {
        companyId: input.companyId,
        sourceSystem: input.sourceSystem,
        recordType: input.recordType,
        externalId: input.externalId,
      },
    },
    create: {
      companyId: input.companyId,
      sourceSystem: input.sourceSystem,
      recordType: input.recordType,
      externalId: input.externalId,
      targetRecordId: input.targetRecordId,
      importSessionId: input.sessionId,
    },
    update: { targetRecordId: input.targetRecordId, importSessionId: input.sessionId },
  });
}

function provenanceNote(source: ImportSourceType, extra: string[]) {
  const lines = [historicalProvenanceNote(source), ...extra.filter(Boolean)];
  return lines.join(" ");
}

export async function executeEntityBatch(input: {
  prisma: PrismaClient;
  companyId: string;
  userId: string;
  sessionId: string;
  batchSize?: number;
}): Promise<{ processed: number; remaining: number; done: boolean; accounting: RowAccounting }> {
  const session = await input.prisma.importSession.findFirst({
    where: { id: input.sessionId, companyId: input.companyId },
  });
  if (!session) throw new Error("Import session not found.");
  const accounting = ((session.rowAccounting as RowAccounting | null) ?? emptyAccounting()) as RowAccounting;
  const pending = await input.prisma.importRow.findMany({
    where: {
      companyId: input.companyId,
      importSessionId: input.sessionId,
      status: { in: ["PENDING", "VALID", "WARNING", "ERROR"] },
    },
    orderBy: { rowNumber: "asc" },
    take: input.batchSize ?? IMPORT_BATCH_SIZE,
  });

  for (const row of pending) {
    const mapped = row.mappedData as MappedEntity | null;
    if (!mapped || row.action === "ERROR" || row.status === "ERROR") {
      await input.prisma.importRow.update({ where: { id: row.id }, data: { status: "FAILED", action: "ERROR" } });
      continue;
    }
    if (row.action === "SKIP") {
      await input.prisma.importRow.update({ where: { id: row.id }, data: { status: "SKIPPED" } });
      continue;
    }
    try {
      const createdId = await input.prisma.$transaction(async (tx) => {
        return writeEntity(tx, {
          companyId: input.companyId,
          userId: input.userId,
          sessionId: input.sessionId,
          sourceSystem: session.sourceType,
          recordType: session.recordType,
          mapped,
        });
      });
      await input.prisma.importRow.update({
        where: { id: row.id },
        data: { status: "IMPORTED", targetRecordId: createdId },
      });
      if (row.status === "WARNING") accounting.warningImported += 1;
    } catch {
      await input.prisma.importRow.update({ where: { id: row.id }, data: { status: "FAILED", action: "ERROR" } });
      accounting.errors += 1;
      accounting.created = Math.max(0, accounting.created - 1);
    }
  }

  const remaining = await input.prisma.importRow.count({
    where: {
      companyId: input.companyId,
      importSessionId: input.sessionId,
      status: { in: ["PENDING", "VALID", "WARNING", "ERROR"] },
    },
  });
  const processed = session.processedRows + pending.length;
  const done = remaining === 0;
  const outcomeRows = await input.prisma.importRow.findMany({
    where: { companyId: input.companyId, importSessionId: input.sessionId },
    select: { status: true, action: true, duplicateVerdict: true },
  });
  const nextAccounting = finalizeAccounting(
    {
      sourceRows: session.rowCount,
      created: outcomeRows.filter((row) => row.status === "IMPORTED" && row.action === "CREATE").length,
      updated: outcomeRows.filter((row) => row.status === "IMPORTED" && row.action === "UPDATE").length,
      merged: outcomeRows.filter((row) => row.status === "IMPORTED" && row.action === "MERGE").length,
      duplicates: outcomeRows.filter((row) => row.status === "SKIPPED" && row.duplicateVerdict !== "NEW").length,
      skipped: outcomeRows.filter((row) => row.status === "SKIPPED" && row.duplicateVerdict === "NEW").length,
      warningImported: accounting.warningImported,
      errors: outcomeRows.filter((row) => row.status === "FAILED" || row.action === "ERROR").length,
      other: 0,
    },
    session.rowCount
  );
  await input.prisma.importSession.update({
    where: { id: input.sessionId, companyId: input.companyId },
    data: {
      processedRows: processed,
      rowAccounting: nextAccounting,
      importSummary: {
        recordsCreated: nextAccounting.created,
        duplicates: nextAccounting.duplicates,
        warnings: nextAccounting.warningImported,
        errors: nextAccounting.errors,
        failed: nextAccounting.errors,
        accounting: nextAccounting,
      },
      status: done ? (nextAccounting.errors > 0 ? "PARTIAL" : "COMPLETED") : "IMPORTING",
      startedAt: session.startedAt ?? new Date(),
      completedAt: done ? new Date() : null,
    },
  });
  return { processed, remaining, done, accounting: nextAccounting };
}

async function writeEntity(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    userId: string;
    sessionId: string;
    sourceSystem: ImportSourceType;
    recordType: ImportRecordType;
    mapped: MappedEntity;
  }
): Promise<string> {
  const v = input.mapped.values;
  const common = {
    companyId: input.companyId,
    sourceSystem: input.sourceSystem,
    importSessionId: input.sessionId,
    importMode: "HISTORICAL",
  };

  if (input.recordType === "PROPERTIES") {
    if (!input.mapped.customerId) throw new Error("Customer required");
    const created = await tx.property.create({
      data: {
        ...common,
        customerId: input.mapped.customerId,
        name: v.propertyName || null,
        address: v.address || "Address not provided",
        city: v.city || "Unknown",
        state: v.state || "NA",
        zip: v.zip || "00000",
        accessNotes: v.notes || null,
        externalId: v.externalId || null,
      },
    });
    if (v.externalId) {
      await upsertRef(tx, {
        companyId: input.companyId,
        sessionId: input.sessionId,
        sourceSystem: input.sourceSystem,
        recordType: "PROPERTIES",
        externalId: v.externalId,
        targetRecordId: created.id,
      });
    }
    return created.id;
  }

  if (input.recordType === "JOBS") {
    if (!input.mapped.customerId || !input.mapped.propertyId) throw new Error("Customer and location required");
    const jobNumber = v.jobNumber || (await nextNumber(input.companyId, "JOB", "JOB"));
    const existingNumber = await tx.job.findFirst({
      where: { companyId: input.companyId, jobNumber },
      select: { id: true },
    });
    const uniqueNumber = existingNumber ? `${jobNumber}-IMP` : jobNumber;
    const status = mapJobStatus(v.status);
    const snapshot = buildImportedJobSnapshot(v);
    const created = await tx.job.create({
      data: {
        ...common,
        customerId: input.mapped.customerId,
        propertyId: input.mapped.propertyId,
        jobNumber: uniqueNumber.slice(0, 40),
        jobType: v.jobType || null,
        status: status.status,
        source: v.source || null,
        description: v.description || null,
        customerNotes: v.customerNotes || null,
        internalNotes: provenanceNote(input.sourceSystem, [
          v.notes,
          v.technicianName && !input.mapped.technicianUserId ? `Historical technician: ${v.technicianName}` : "",
        ]),
        scheduledStart: parseDate(v.scheduledStart),
        completedAt: parseDate(v.completedAt),
        externalId: v.externalId || v.jobNumber || null,
        importedTechnicianName: input.mapped.technicianName,
        importedSnapshot: snapshot,
        importedOccurredAt: parseDate(v.createdDate) ?? parseDate(v.issueDate),
        importedTotalCents: parseCurrencyToCents(v.total),
        assignments:
          input.mapped.technicianUserId
            ? { create: { userId: input.mapped.technicianUserId } }
            : undefined,
      },
    });
    if (v.externalId) {
      await upsertRef(tx, {
        companyId: input.companyId,
        sessionId: input.sessionId,
        sourceSystem: input.sourceSystem,
        recordType: "JOBS",
        externalId: v.externalId,
        targetRecordId: created.id,
      });
    }
    return created.id;
  }

  if (input.recordType === "ESTIMATES") {
    if (!input.mapped.customerId) throw new Error("Customer required");
    const estimateNumber = v.documentNumber || (await nextNumber(input.companyId, "ESTIMATE", "EST"));
    const clash = await tx.estimate.findFirst({ where: { companyId: input.companyId, estimateNumber } });
    const total = parseCurrencyToCents(v.total) ?? 0;
    const tax = parseCurrencyToCents(v.tax) ?? 0;
    const subtotal = parseCurrencyToCents(v.subtotal) ?? total - tax;
    const created = await tx.estimate.create({
      data: {
        ...common,
        customerId: input.mapped.customerId,
        propertyId: input.mapped.propertyId,
        jobId: input.mapped.jobId,
        estimateNumber: (clash ? `${estimateNumber}-IMP` : estimateNumber).slice(0, 40),
        status: mapEstimateStatus(v.status).status,
        issueDate: parseDate(v.issueDate) ?? new Date(),
        expirationDate: parseDate(v.dueDate),
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        notes: provenanceNote(input.sourceSystem, [v.notes]),
        externalId: v.externalId || null,
      },
    });
    if (v.externalId) {
      await upsertRef(tx, {
        companyId: input.companyId,
        sessionId: input.sessionId,
        sourceSystem: input.sourceSystem,
        recordType: "ESTIMATES",
        externalId: v.externalId,
        targetRecordId: created.id,
      });
    }
    return created.id;
  }

  if (input.recordType === "INVOICES") {
    if (!input.mapped.customerId) throw new Error("Customer required");
    const invoiceNumber = v.documentNumber || (await nextNumber(input.companyId, "INVOICE", "INV"));
    const clash = await tx.invoice.findFirst({ where: { companyId: input.companyId, invoiceNumber } });
    const total = parseCurrencyToCents(v.total) ?? 0;
    const tax = parseCurrencyToCents(v.tax) ?? 0;
    const paid = parseCurrencyToCents(v.paidAmount) ?? 0;
    const subtotal = parseCurrencyToCents(v.subtotal) ?? total - tax;
    const balance = parseCurrencyToCents(v.balance) ?? Math.max(0, total - paid);
    const created = await tx.invoice.create({
      data: {
        ...common,
        customerId: input.mapped.customerId,
        propertyId: input.mapped.propertyId,
        jobId: input.mapped.jobId,
        invoiceNumber: (clash ? `${invoiceNumber}-IMP` : invoiceNumber).slice(0, 40),
        status: mapInvoiceStatus(v.status).status,
        issueDate: parseDate(v.issueDate) ?? new Date(),
        dueDate: parseDate(v.dueDate),
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        amountPaidCents: paid,
        balanceCents: balance,
        notes: provenanceNote(input.sourceSystem, [v.notes]),
        externalId: v.externalId || null,
      },
    });
    if (v.externalId) {
      await upsertRef(tx, {
        companyId: input.companyId,
        sessionId: input.sessionId,
        sourceSystem: input.sourceSystem,
        recordType: "INVOICES",
        externalId: v.externalId,
        targetRecordId: created.id,
      });
    }
    return created.id;
  }

  if (input.recordType === "PAYMENTS") {
    if (!input.mapped.invoiceId) throw new Error("Invoice required");
    const amount = parseCurrencyToCents(v.paymentAmount);
    if (amount == null) throw new Error("Amount required");
    const created = await tx.payment.create({
      data: {
        companyId: input.companyId,
        invoiceId: input.mapped.invoiceId,
        amountCents: amount,
        method: mapPaymentMethod(v.paymentMethod),
        status: "RECORDED",
        paidAt: parseDate(v.paymentDate) ?? new Date(),
        externalRef: v.paymentReference || null,
        notes: provenanceNote(input.sourceSystem, [v.notes, "Historical record only — no charge was made."]),
        sourceSystem: input.sourceSystem,
        externalId: v.externalId || null,
        importSessionId: input.sessionId,
        importMode: "HISTORICAL",
      },
    });
    await tx.invoice.update({
      where: { id: input.mapped.invoiceId },
      data: {
        amountPaidCents: { increment: amount },
        balanceCents: { decrement: amount },
      },
    });
    if (v.externalId) {
      await upsertRef(tx, {
        companyId: input.companyId,
        sessionId: input.sessionId,
        sourceSystem: input.sourceSystem,
        recordType: "PAYMENTS",
        externalId: v.externalId,
        targetRecordId: created.id,
      });
    }
    return created.id;
  }

  if (input.recordType === "EQUIPMENT") {
    const created = await tx.equipment.create({
      data: {
        ...common,
        customerId: input.mapped.customerId,
        propertyId: input.mapped.propertyId,
        name: v.equipmentName || v.model || v.serialNumber || "Imported equipment",
        equipmentType: v.equipmentType || null,
        manufacturer: v.manufacturer || null,
        model: v.model || null,
        serialNumber: v.serialNumber || null,
        installDate: parseDate(v.installDate),
        warrantyExpiresAt: parseDate(v.warrantyDate),
        notes: provenanceNote(input.sourceSystem, [v.notes]),
        externalId: v.externalId || null,
      },
    });
    if (v.externalId) {
      await upsertRef(tx, {
        companyId: input.companyId,
        sessionId: input.sessionId,
        sourceSystem: input.sourceSystem,
        recordType: "EQUIPMENT",
        externalId: v.externalId,
        targetRecordId: created.id,
      });
    }
    return created.id;
  }

  if (input.recordType === "EXPENSES") {
    const amount = parseCurrencyToCents(v.expenseAmount);
    if (amount == null) throw new Error("Amount required");
    const created = await tx.expense.create({
      data: {
        ...common,
        vendor: v.expenseVendor || null,
        date: parseDate(v.expenseDate) ?? new Date(),
        amountCents: amount,
        category: mapExpenseCategory(v.expenseCategory),
        description: provenanceNote(input.sourceSystem, [v.description || v.notes]),
        paymentMethod: v.paymentMethod ? mapPaymentMethod(v.paymentMethod) : null,
        jobId: input.mapped.jobId,
        customerId: input.mapped.customerId,
        status: "POSTED",
        createdById: input.userId,
        externalId: v.externalId || null,
      },
    });
    if (v.externalId) {
      await upsertRef(tx, {
        companyId: input.companyId,
        sessionId: input.sessionId,
        sourceSystem: input.sourceSystem,
        recordType: "EXPENSES",
        externalId: v.externalId,
        targetRecordId: created.id,
      });
    }
    return created.id;
  }

  if (input.recordType === "NOTES" && input.mapped.customerId) {
    const customer = await tx.customer.findFirst({ where: { id: input.mapped.customerId, companyId: input.companyId } });
    if (!customer) throw new Error("Customer required");
    const stamp = [parseDate(v.createdDate)?.toISOString().slice(0, 10), v.technicianName].filter(Boolean).join(" · ");
    const block = [`[Imported${stamp ? ` · ${stamp}` : ""}]`, v.notes].join("\n");
    await tx.customer.update({
      where: { id: customer.id },
      data: { notes: [customer.notes, block].filter(Boolean).join("\n\n") },
    });
    if (input.mapped.jobId) {
      const job = await tx.job.findFirst({ where: { id: input.mapped.jobId, companyId: input.companyId } });
      if (job) {
        await tx.job.update({
          where: { id: job.id },
          data: { internalNotes: [job.internalNotes, block].filter(Boolean).join("\n\n") },
        });
      }
    }
    return customer.id;
  }

  if (input.recordType === "TAGS" && input.mapped.customerId) {
    const customer = await tx.customer.findFirst({ where: { id: input.mapped.customerId, companyId: input.companyId } });
    if (!customer) throw new Error("Customer required");
    const incoming = splitTags(v.tags);
    const merged = [...customer.tags];
    for (const tag of incoming) {
      if (!merged.some((existing) => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag);
    }
    await tx.customer.update({ where: { id: customer.id }, data: { tags: merged.slice(0, 20) } });
    return customer.id;
  }

  if (input.recordType === "LEAD_SOURCES" && input.mapped.customerId) {
    await tx.customer.update({
      where: { id: input.mapped.customerId },
      data: { source: v.source || undefined },
    });
    return input.mapped.customerId;
  }

  throw new Error("Unsupported import type");
}

export function summarizeEntityImport(recordType: ImportRecordType, accounting: RowAccounting): string {
  const label = recordType.toLowerCase().replaceAll("_", " ");
  return `${accounting.created} ${label} records were imported. ${accounting.errors} rows had errors. ${accounting.skipped + accounting.duplicates} were skipped. This is historical data — ContractorYou did not send messages or take payments.`;
}

export function pickMapped(row: Record<string, string>, mapping: ImportMapping, target: string) {
  return pick(row, mapping, target);
}

export { normalizeEmail, normalizePhone };
