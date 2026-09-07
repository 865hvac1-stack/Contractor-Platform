import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { DEFAULT_CADENCE, DEFAULT_COLUMNS, DEFAULT_TEMPLATES } from "@/lib/waiting/defaults";

export async function ensureWaitingSetup(companyId: string, db: PrismaClient = defaultPrisma) {
  const [existingColumns, setting] = await Promise.all([
    db.waitingColumn.findMany({ where: { companyId }, orderBy: { sortOrder: "asc" } }),
    db.waitingBoardSetting.findUnique({ where: { companyId } }),
  ]);

  if (!setting) {
    await db.waitingBoardSetting.create({
      data: {
        companyId,
        automaticUpdatesEnabled: true,
        defaultCadence: DEFAULT_CADENCE,
        businessHoursStart: 10,
      },
    });
  }

  if (existingColumns.length === 0) {
    await db.waitingColumn.createMany({
      data: DEFAULT_COLUMNS.map((column) => ({
        companyId,
        key: column.key,
        name: column.name,
        kind: column.kind,
        sortOrder: column.sortOrder,
        warningDays: column.warningDays,
        urgentDays: column.urgentDays,
      })),
    });
  }

  const columns = await db.waitingColumn.findMany({ where: { companyId } });
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const templates = await db.waitingTemplate.findMany({ where: { companyId } });
  const have = new Set(templates.map((row) => `${row.columnId ?? "null"}:${row.kind}`));

  for (const template of DEFAULT_TEMPLATES) {
    const column = template.columnKey ? columnByKey.get(template.columnKey) : null;
    if (template.columnKey && !column) continue;
    const key = `${column?.id ?? "null"}:${template.kind}`;
    if (have.has(key)) continue;
    await db.waitingTemplate.create({
      data: {
        companyId,
        columnId: column?.id ?? null,
        kind: template.kind,
        name: template.name,
        body: template.body,
      },
    });
    have.add(key);
  }

  return {
    columns: await db.waitingColumn.findMany({
      where: { companyId, archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    setting:
      (await db.waitingBoardSetting.findUnique({ where: { companyId } })) ??
      (await db.waitingBoardSetting.create({
        data: { companyId, automaticUpdatesEnabled: true, defaultCadence: DEFAULT_CADENCE },
      })),
  };
}

export function columnKeyFromName(name: string) {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `CUSTOM_${Date.now()}`;
}
