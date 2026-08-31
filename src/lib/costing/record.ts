import type { JobCostCategory, JobCostSource, PrismaClient } from "@prisma/client";

export async function recordJobCost(
  prisma: PrismaClient,
  input: {
    companyId: string;
    jobId: string;
    createdById: string;
    category: JobCostCategory;
    description?: string | null;
    amountCents: number;
    sourceType: JobCostSource;
    sourceId?: string | null;
    receiptId?: string | null;
    expenseId?: string | null;
    confirmed?: boolean;
  }
) {
  if (input.expenseId) {
    const existing = await prisma.jobCost.findFirst({
      where: { companyId: input.companyId, expenseId: input.expenseId },
    });
    if (existing) {
      return prisma.jobCost.update({
        where: { id: existing.id },
        data: {
          amountCents: input.amountCents,
          category: input.category,
          description: input.description ?? existing.description,
          confirmed: input.confirmed ?? true,
        },
      });
    }
  }
  return prisma.jobCost.create({
    data: {
      companyId: input.companyId,
      jobId: input.jobId,
      category: input.category,
      description: input.description ?? null,
      amountCents: input.amountCents,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      receiptId: input.receiptId ?? null,
      expenseId: input.expenseId ?? null,
      createdById: input.createdById,
      confirmed: input.confirmed ?? true,
    },
  });
}
