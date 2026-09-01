import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";

export async function deleteCompanyJob(
  prisma: PrismaClient,
  input: { companyId: string; actorId: string; jobId: string }
) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    select: { id: true, jobNumber: true },
  });
  if (!job) return { ok: false as const, error: "Job not found." };

  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: job.id },
      data: { estimateId: null },
    });
    await tx.estimate.updateMany({
      where: { companyId: input.companyId, jobId: job.id },
      data: { jobId: null },
    });
    await tx.invoice.updateMany({
      where: { companyId: input.companyId, jobId: job.id },
      data: { jobId: null },
    });
    await tx.payment.updateMany({
      where: { companyId: input.companyId, jobId: job.id },
      data: { jobId: null },
    });
    await tx.job.delete({ where: { id: job.id } });
  });

  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "job.deleted",
    entityType: "Job",
    entityId: job.id,
    metadata: { jobNumber: job.jobNumber },
  });

  return { ok: true as const, jobNumber: job.jobNumber };
}
