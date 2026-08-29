import { prisma } from "@/lib/db";

/**
 * Atomically allocate the next document number for a company.
 */
export async function nextNumber(
  companyId: string,
  kind: "JOB" | "ESTIMATE" | "INVOICE",
  prefix: string
): Promise<string> {
  const seq = await prisma.$transaction(async (tx) => {
    const existing = await tx.numberSequence.findUnique({
      where: { companyId_kind: { companyId, kind } },
    });
    if (!existing) {
      return tx.numberSequence.create({
        data: { companyId, kind, prefix, nextValue: 2 },
      }).then(() => 1);
    }
    const current = existing.nextValue;
    await tx.numberSequence.update({
      where: { id: existing.id },
      data: { nextValue: current + 1 },
    });
    return current;
  });

  return `${prefix}-${String(seq).padStart(5, "0")}`;
}
