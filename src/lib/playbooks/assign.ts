import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseDefinition } from "@/lib/playbooks/engine";

export async function assignPlaybookToJob(input: {
  companyId: string;
  jobId: string;
  playbookId: string;
}) {
  const playbook = await prisma.playbook.findFirst({
    where: { id: input.playbookId, companyId: input.companyId, status: "ACTIVE" },
  });
  if (!playbook) return null;

  const version = playbook.currentVersionId
    ? await prisma.playbookVersion.findFirst({
        where: { id: playbook.currentVersionId, companyId: input.companyId },
      })
    : await prisma.playbookVersion.findFirst({
        where: { playbookId: playbook.id, companyId: input.companyId },
        orderBy: { versionNumber: "desc" },
      });
  if (!version) return null;

  const definition = parseDefinition(version.definition);
  const firstStage = definition.phases.flatMap((p) => p.stages)[0]?.key ?? null;

  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    select: { jobType: true, importMode: true },
  });
  if (!job) return null;
  if (job.importMode === "HISTORICAL") return null;

  await prisma.job.update({
    where: { id: input.jobId },
    data: {
      playbookId: playbook.id,
      playbookVersionId: version.id,
      jobType: job.jobType || playbook.name,
    },
  });

  await prisma.jobPlaybookSnapshot.upsert({
    where: { jobId: input.jobId },
    create: {
      companyId: input.companyId,
      jobId: input.jobId,
      playbookId: playbook.id,
      versionId: version.id,
      definition: definition as unknown as Prisma.InputJsonValue,
      currentStageKey: firstStage,
    },
    update: {
      playbookId: playbook.id,
      versionId: version.id,
      definition: definition as unknown as Prisma.InputJsonValue,
      currentStageKey: firstStage,
    },
  });

  return { playbook, version };
}
