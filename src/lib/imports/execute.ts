import type { ImportSourceType, Prisma, PrismaClient } from "@prisma/client";
import type { ImportSummary, MappedCustomer, RowAccounting } from "@/lib/imports/types";
import { customerGroupKey } from "@/lib/imports/map";
import { IMPORT_BATCH_SIZE } from "@/lib/imports/types";
import { finalizeAccounting } from "@/lib/imports/quality";

function emptySummary(): ImportSummary {
  return {
    customersCreated: 0,
    customersUpdated: 0,
    customersSkipped: 0,
    propertiesCreated: 0,
    duplicates: 0,
    warnings: 0,
    errors: 0,
    failed: 0,
  };
}

function addSummary(target: ImportSummary, add: Partial<ImportSummary>) {
  for (const [key, value] of Object.entries(add)) {
    if (typeof value !== "number") continue;
    const current = target[key as keyof ImportSummary];
    if (typeof current === "number") {
      (target as unknown as Record<string, number>)[key] = current + value;
    }
  }
}

async function upsertExternalRef(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    sessionId: string;
    sourceSystem: ImportSourceType;
    externalId: string;
    customerId: string;
  }
) {
  await tx.importExternalRef.upsert({
    where: {
      companyId_sourceSystem_recordType_externalId: {
        companyId: input.companyId,
        sourceSystem: input.sourceSystem,
        recordType: "CUSTOMERS",
        externalId: input.externalId,
      },
    },
    create: {
      companyId: input.companyId,
      sourceSystem: input.sourceSystem,
      recordType: "CUSTOMERS",
      externalId: input.externalId,
      targetRecordId: input.customerId,
      importSessionId: input.sessionId,
    },
    update: {
      targetRecordId: input.customerId,
      importSessionId: input.sessionId,
    },
  });
}

async function createProperties(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    customerId: string;
    sessionId: string;
    properties: MappedCustomer["properties"];
    existingAddresses: Set<string>;
  }
): Promise<number> {
  let created = 0;
  for (const property of input.properties) {
    const key = `${property.address}|${property.city}|${property.zip}`.toLowerCase();
    if (input.existingAddresses.has(key)) continue;
    await tx.property.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        name: property.name ?? null,
        address: property.address,
        city: property.city,
        state: property.state,
        zip: property.zip,
        isPrimary: property.isPrimary && input.existingAddresses.size === 0,
        importSessionId: input.sessionId,
        importMode: "HISTORICAL",
      },
    });
    input.existingAddresses.add(key);
    created += 1;
  }
  return created;
}

export async function executeImportBatch(input: {
  prisma: PrismaClient;
  companyId: string;
  sessionId: string;
  batchSize?: number;
}): Promise<{ processed: number; remaining: number; summary: ImportSummary; done: boolean }> {
  const session = await input.prisma.importSession.findFirst({
    where: { id: input.sessionId, companyId: input.companyId },
  });
  if (!session) throw new Error("Import session not found.");
  if (session.status === "CANCELLED") throw new Error("This import was cancelled.");
  if (session.status === "COMPLETED") {
    return {
      processed: session.processedRows,
      remaining: 0,
      summary: (session.importSummary as ImportSummary | null) ?? emptySummary(),
      done: true,
    };
  }

  const batchSize = input.batchSize ?? IMPORT_BATCH_SIZE;
  const pending = await input.prisma.importRow.findMany({
    where: {
      companyId: input.companyId,
      importSessionId: input.sessionId,
      status: { in: ["PENDING", "VALID", "WARNING", "ERROR"] },
    },
    orderBy: { rowNumber: "asc" },
    take: batchSize,
  });

  const summary = ((session.importSummary as ImportSummary | null) ?? emptySummary()) as ImportSummary;
  const createdByGroup = new Map<string, string>();

  for (const row of pending) {
    const mapped = row.mappedData as MappedCustomer | null;
    if (!mapped || row.action === "ERROR" || row.status === "ERROR") {
      await input.prisma.importRow.update({
        where: { id: row.id },
        data: { status: "FAILED", action: "ERROR" },
      });
      addSummary(summary, { errors: 1, failed: 1 });
      continue;
    }

    if (row.action === "SKIP") {
      await input.prisma.importRow.update({
        where: { id: row.id },
        data: { status: "SKIPPED" },
      });
      addSummary(summary, { customersSkipped: 1, duplicates: row.duplicateVerdict === "NEW" ? 0 : 1 });
      continue;
    }

    try {
      const groupKey = customerGroupKey(mapped);
      const result = await input.prisma.$transaction(async (tx) => {
        let customerId = createdByGroup.get(groupKey) ?? (row.action === "UPDATE" ? row.targetRecordId : null);
        if (!customerId && mapped.externalId) {
          const prior = await tx.customer.findFirst({
            where: {
              companyId: input.companyId,
              importSessionId: input.sessionId,
              externalId: mapped.externalId,
            },
            select: { id: true },
          });
          if (prior) customerId = prior.id;
        }
        if (!customerId && mapped.email) {
          const prior = await tx.customer.findFirst({
            where: {
              companyId: input.companyId,
              importSessionId: input.sessionId,
              email: mapped.email,
            },
            select: { id: true },
          });
          if (prior) customerId = prior.id;
        }
        if (row.action === "UPDATE" && customerId) {
          const existing = await tx.customer.findFirst({
            where: { id: customerId, companyId: input.companyId },
            include: { properties: true },
          });
          if (!existing) throw new Error("Existing customer not found.");
          await tx.customer.update({
            where: { id: existing.id },
            data: {
              firstName: mapped.firstName || existing.firstName,
              lastName: mapped.lastName || existing.lastName,
              businessName: mapped.businessName ?? existing.businessName,
              email: mapped.email ?? existing.email,
              phone: mapped.phone ?? existing.phone,
              secondaryPhone: mapped.secondaryPhone ?? existing.secondaryPhone,
              notes: [existing.notes, mapped.notes].filter(Boolean).join("\n") || null,
              tags: [...new Set([...existing.tags, ...mapped.tags])],
              source: mapped.source ?? existing.source,
              status: mapped.status,
              sourceSystem: session.sourceType,
              externalId: mapped.externalId ?? existing.externalId,
            },
          });
          const existingAddresses = new Set(
            existing.properties.map((property) => `${property.address}|${property.city}|${property.zip}`.toLowerCase())
          );
          const propertiesCreated = await createProperties(tx, {
            companyId: input.companyId,
            customerId: existing.id,
            sessionId: input.sessionId,
            properties: mapped.properties,
            existingAddresses,
          });
          if (mapped.externalId) {
            await upsertExternalRef(tx, {
              companyId: input.companyId,
              sessionId: input.sessionId,
              sourceSystem: session.sourceType,
              externalId: mapped.externalId,
              customerId: existing.id,
            });
          }
          return { customerId: existing.id, created: false, propertiesCreated };
        }

        if (customerId && row.action !== "UPDATE") {
          const existing = await tx.customer.findFirst({
            where: { id: customerId, companyId: input.companyId },
            include: { properties: true },
          });
          if (existing) {
            const existingAddresses = new Set(
              existing.properties.map((property) => `${property.address}|${property.city}|${property.zip}`.toLowerCase())
            );
            const propertiesCreated = await createProperties(tx, {
              companyId: input.companyId,
              customerId: existing.id,
              sessionId: input.sessionId,
              properties: mapped.properties,
              existingAddresses,
            });
            return { customerId: existing.id, created: false, propertiesCreated };
          }
        }

        const created = await tx.customer.create({
          data: {
            companyId: input.companyId,
            firstName: mapped.firstName || "Unknown",
            lastName: mapped.lastName || "Customer",
            businessName: mapped.businessName,
            email: mapped.email,
            phone: mapped.phone,
            secondaryPhone: mapped.secondaryPhone,
            notes: mapped.notes,
            tags: mapped.tags,
            source: mapped.source,
            status: mapped.status,
            sourceSystem: session.sourceType,
            externalId: mapped.externalId,
            importSessionId: input.sessionId,
            importMode: "HISTORICAL",
          },
        });
        const propertiesCreated = await createProperties(tx, {
          companyId: input.companyId,
          customerId: created.id,
          sessionId: input.sessionId,
          properties: mapped.properties,
          existingAddresses: new Set(),
        });
        if (mapped.externalId) {
          await upsertExternalRef(tx, {
            companyId: input.companyId,
            sessionId: input.sessionId,
            sourceSystem: session.sourceType,
            externalId: mapped.externalId,
            customerId: created.id,
          });
        }
        return { customerId: created.id, created: true, propertiesCreated };
      });

      createdByGroup.set(groupKey, result.customerId);
      await input.prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: "IMPORTED",
          targetRecordId: result.customerId,
        },
      });
      addSummary(summary, {
        customersCreated: result.created && row.status !== "WARNING" ? 1 : 0,
        customersUpdated: result.created ? 0 : row.action === "UPDATE" ? 1 : 0,
        propertiesCreated: result.propertiesCreated,
        warnings: row.status === "WARNING" ? 1 : 0,
      });
    } catch {
      await input.prisma.importRow.update({
        where: { id: row.id },
        data: { status: "FAILED", action: "ERROR" },
      });
      addSummary(summary, { failed: 1, errors: 1 });
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
  const failedAny = summary.failed > 0 || summary.errors > 0;
  const outcomeRows = await input.prisma.importRow.findMany({
    where: { companyId: input.companyId, importSessionId: input.sessionId },
    select: { status: true, action: true, duplicateVerdict: true },
  });
  const accounting = finalizeAccounting(
    {
      sourceRows: session.rowCount,
      created: outcomeRows.filter((row) => row.status === "IMPORTED" && row.action === "CREATE").length,
      updated: outcomeRows.filter((row) => row.status === "IMPORTED" && row.action === "UPDATE").length,
      merged: outcomeRows.filter((row) => row.status === "IMPORTED" && row.action === "MERGE").length,
      duplicates: outcomeRows.filter((row) => row.status === "SKIPPED" && row.duplicateVerdict !== "NEW").length,
      skipped: outcomeRows.filter((row) => row.status === "SKIPPED" && row.duplicateVerdict === "NEW").length,
      warningImported: summary.warnings,
      errors: outcomeRows.filter((row) => row.status === "FAILED" || row.action === "ERROR").length,
      other: 0,
    } satisfies RowAccounting,
    session.rowCount
  );
  await input.prisma.importSession.update({
    where: { id: input.sessionId, companyId: input.companyId },
    data: {
      processedRows: processed,
      importSummary: { ...summary, accounting },
      rowAccounting: accounting,
      status: done ? (failedAny || summary.customersSkipped > 0 ? "PARTIAL" : "COMPLETED") : "IMPORTING",
      startedAt: session.startedAt ?? new Date(),
      completedAt: done ? new Date() : null,
    },
  });

  return { processed, remaining, summary, done };
}

export async function summarizeImportedCustomers(input: {
  prisma: PrismaClient;
  companyId: string;
  sessionId: string;
}): Promise<string> {
  const customers = await input.prisma.customer.findMany({
    where: { companyId: input.companyId, importSessionId: input.sessionId },
    include: { properties: true },
  });
  if (customers.length === 0) {
    return "No new customers were created in this import.";
  }
  const withPhone = customers.filter((customer) => customer.phone).length;
  const withEmail = customers.filter((customer) => customer.email).length;
  const multiProperty = customers.filter((customer) => customer.properties.length > 1).length;
  return [
    `${customers.length} customers were imported successfully.`,
    `${withPhone} have phone numbers.`,
    `${withEmail} have email addresses.`,
    `${multiProperty} customers have more than one service location.`,
  ].join(" ");
}
