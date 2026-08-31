import type { PrismaClient } from "@prisma/client";

export async function findPossibleDuplicate(
  prisma: PrismaClient,
  input: {
    companyId: string;
    excludeId?: string;
    fileHash?: string | null;
    vendor?: string | null;
    totalCents?: number | null;
    receiptDate?: Date | null;
  }
) {
  if (input.fileHash) {
    const byHash = await prisma.receipt.findFirst({
      where: {
        companyId: input.companyId,
        fileHash: input.fileHash,
        id: input.excludeId ? { not: input.excludeId } : undefined,
      },
    });
    if (byHash) return byHash;
  }
  if (input.vendor && input.totalCents != null && input.receiptDate) {
    const start = new Date(input.receiptDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return prisma.receipt.findFirst({
      where: {
        companyId: input.companyId,
        id: input.excludeId ? { not: input.excludeId } : undefined,
        vendor: { equals: input.vendor, mode: "insensitive" },
        totalCents: input.totalCents,
        receiptDate: { gte: start, lt: end },
      },
    });
  }
  return null;
}
