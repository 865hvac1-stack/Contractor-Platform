import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

export type SequenceKind = "JOB" | "ESTIMATE" | "INVOICE";

const DEFAULTS: Record<SequenceKind, { prefix: string; padding: number }> = {
  JOB: { prefix: "JOB", padding: 5 },
  ESTIMATE: { prefix: "EST", padding: 5 },
  INVOICE: { prefix: "INV", padding: 5 },
};

type Db = PrismaClient | Prisma.TransactionClient;

function newSequenceId() {
  return `c${randomBytes(12).toString("hex")}`;
}

export function parseDocumentSerial(number: string, prefix: string): number | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = number.trim().match(new RegExp(`^${escaped}-(\\d+)$`, "i"));
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function formatDocumentNumber(prefix: string, value: number, padding = 5) {
  const safePadding = Math.min(8, Math.max(3, padding));
  return `${prefix}-${String(value).padStart(safePadding, "0")}`;
}

async function highestExistingSerial(db: Db, companyId: string, kind: SequenceKind, prefix: string) {
  if (kind === "INVOICE") {
    const rows = await db.invoice.findMany({
      where: { companyId, invoiceNumber: { startsWith: `${prefix}-` } },
      select: { invoiceNumber: true },
    });
    return rows.reduce((max, row) => Math.max(max, parseDocumentSerial(row.invoiceNumber, prefix) ?? 0), 0);
  }
  if (kind === "JOB") {
    const rows = await db.job.findMany({
      where: { companyId, jobNumber: { startsWith: `${prefix}-` } },
      select: { jobNumber: true },
    });
    return rows.reduce((max, row) => Math.max(max, parseDocumentSerial(row.jobNumber, prefix) ?? 0), 0);
  }
  const rows = await db.estimate.findMany({
    where: { companyId, estimateNumber: { startsWith: `${prefix}-` } },
    select: { estimateNumber: true },
  });
  return rows.reduce((max, row) => Math.max(max, parseDocumentSerial(row.estimateNumber, prefix) ?? 0), 0);
}

async function ensureSequenceRow(tx: Prisma.TransactionClient, companyId: string, kind: SequenceKind, prefix: string) {
  const defaults = DEFAULTS[kind];
  const stored = await tx.numberSequence.findUnique({
    where: { companyId_kind: { companyId, kind } },
  });
  const effectivePrefix = stored?.prefix || prefix || defaults.prefix;
  const highest = await highestExistingSerial(tx, companyId, kind, effectivePrefix);
  const floor = highest + 1;

  if (!stored) {
    await tx.$executeRaw`
      INSERT INTO "NumberSequence" (id, "companyId", kind, prefix, "nextValue", padding)
      VALUES (${newSequenceId()}, ${companyId}, ${kind}, ${effectivePrefix}, ${floor}, ${defaults.padding})
      ON CONFLICT ("companyId", kind) DO NOTHING
    `;
    return;
  }

  if (stored.nextValue < floor) {
    await tx.numberSequence.update({
      where: { id: stored.id },
      data: { nextValue: floor },
    });
  }
}

/**
 * Atomically allocate the next document number for a company.
 * Uses a row-locked increment so concurrent creates cannot share a number.
 * Existing invoice/job/estimate numbers are never rewritten.
 */
export async function nextNumber(
  companyId: string,
  kind: SequenceKind,
  prefix?: string
): Promise<string> {
  const defaults = DEFAULTS[kind];
  const requestedPrefix = prefix || defaults.prefix;

  return prisma.$transaction(async (tx) => {
    await ensureSequenceRow(tx, companyId, kind, requestedPrefix);
    const rows = await tx.$queryRaw<Array<{ allocated: bigint | number; prefix: string; padding: number }>>`
      UPDATE "NumberSequence"
      SET "nextValue" = "nextValue" + 1
      WHERE "companyId" = ${companyId} AND kind = ${kind}
      RETURNING ("nextValue" - 1) AS allocated, prefix, padding
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("Could not allocate a document number.");
    }
    return formatDocumentNumber(row.prefix, Number(row.allocated), row.padding);
  });
}

export async function getSequenceSettings(companyId: string, kind: SequenceKind) {
  const defaults = DEFAULTS[kind];
  const stored = await prisma.numberSequence.findUnique({
    where: { companyId_kind: { companyId, kind } },
  });
  const prefix = stored?.prefix || defaults.prefix;
  const highest = await highestExistingSerial(prisma, companyId, kind, prefix);
  return {
    prefix,
    padding: stored?.padding ?? defaults.padding,
    nextValue: Math.max(stored?.nextValue ?? 1, highest + 1),
    highestExisting: highest,
  };
}

export async function updateInvoiceSequenceSettings(input: {
  companyId: string;
  prefix?: string;
  nextValue?: number;
  padding?: number;
}) {
  const prefix = (input.prefix || "INV").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "INV";
  const padding = input.padding ?? 5;
  if (padding < 3 || padding > 8) {
    return { ok: false as const, error: "Padding must be between 3 and 8 digits." };
  }
  const highest = await highestExistingSerial(prisma, input.companyId, "INVOICE", prefix);
  const nextValue = input.nextValue ?? highest + 1;
  if (!Number.isInteger(nextValue) || nextValue < 1) {
    return { ok: false as const, error: "Next invoice number must be a positive whole number." };
  }
  if (nextValue <= highest) {
    return {
      ok: false as const,
      error: `Next number must be greater than the highest existing ${prefix} invoice (${highest}). Existing invoices are not renumbered.`,
    };
  }

  await prisma.numberSequence.upsert({
    where: { companyId_kind: { companyId: input.companyId, kind: "INVOICE" } },
    create: {
      companyId: input.companyId,
      kind: "INVOICE",
      prefix,
      nextValue,
      padding,
    },
    update: { prefix, nextValue, padding },
  });
  return { ok: true as const, prefix, nextValue, padding };
}
