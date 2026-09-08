import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function linkLeadToEstimate(input: {
  companyId: string;
  actorId: string;
  leadId: string;
  estimateId: string;
  estimateNumber: string;
}) {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
  });
  if (!lead) return;
  await prisma.lead.update({
    where: { id: lead.id },
    data: { estimateId: input.estimateId },
  });
  await prisma.leadActivity.create({
    data: {
      companyId: input.companyId,
      leadId: lead.id,
      actorId: input.actorId,
      kind: "ESTIMATE",
      body: `Estimate ${input.estimateNumber} created.`,
    },
  });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "lead.estimate_linked",
    entityType: "Lead",
    entityId: lead.id,
    metadata: { estimateId: input.estimateId, estimateNumber: input.estimateNumber },
  });
}

export async function linkLeadToJob(input: {
  companyId: string;
  actorId: string;
  leadId: string;
  jobId: string;
  jobNumber: string;
  scheduled?: boolean;
}) {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
  });
  if (!lead) return;
  await prisma.lead.update({
    where: { id: lead.id },
    data: { jobId: input.jobId },
  });
  await prisma.leadActivity.create({
    data: {
      companyId: input.companyId,
      leadId: lead.id,
      actorId: input.actorId,
      kind: "APPOINTMENT",
      body: input.scheduled
        ? `Appointment scheduled as ${input.jobNumber}.`
        : `Job ${input.jobNumber} created.`,
    },
  });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "lead.job_linked",
    entityType: "Lead",
    entityId: lead.id,
    metadata: { jobId: input.jobId, jobNumber: input.jobNumber, scheduled: Boolean(input.scheduled) },
  });
}
