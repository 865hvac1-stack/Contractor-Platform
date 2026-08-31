import type { PrismaClient } from "@prisma/client";

export async function attributionUserIds(
  prisma: PrismaClient,
  input: {
    jobId?: string | null;
    createdById?: string | null;
    soldById?: string | null;
  }
): Promise<string[]> {
  const ids = new Set<string>();
  if (input.createdById) ids.add(input.createdById);
  if (input.soldById) ids.add(input.soldById);
  if (input.jobId) {
    const assignees = await prisma.jobAssignment.findMany({
      where: { jobId: input.jobId },
      select: { userId: true },
    });
    for (const row of assignees) ids.add(row.userId);
  }
  return [...ids];
}
