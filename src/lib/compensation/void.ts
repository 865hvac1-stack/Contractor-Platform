import type { PrismaClient } from "@prisma/client";

export async function voidCompensationForSource(input: {
  prisma: PrismaClient;
  companyId: string;
  sourceType: string;
  sourceId: string;
  reason: string;
}) {
  const rows = await input.prisma.compensationEvent.findMany({
    where: {
      companyId: input.companyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: { in: ["PENDING", "QUALIFIED", "APPROVED"] },
    },
  });
  if (rows.length === 0) return 0;
  await input.prisma.compensationEvent.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { status: "VOIDED", notes: input.reason },
  });
  return rows.length;
}
