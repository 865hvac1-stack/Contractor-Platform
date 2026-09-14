import type { CompanyRole, Prisma, PrismaClient } from "@prisma/client";
import { loadJob360 } from "@/lib/jobs/job-360";

export async function loadDispatchJobPanel(
  prisma: PrismaClient,
  input: {
    companyId: string;
    jobId: string;
    role: CompanyRole;
    access: Prisma.JobWhereInput;
  }
) {
  const view = await loadJob360(prisma, input);
  if (!view) return null;
  const [thread, call, jobParts] = await Promise.all([
    prisma.communicationThread.findFirst({
      where: { companyId: input.companyId, customerId: view.customer.id },
      orderBy: { lastActivityAt: "desc" },
      include: {
        messages: {
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { body: true, direction: true, channel: true, occurredAt: true, status: true },
        },
      },
    }),
    prisma.callRecord.findFirst({
      where: {
        companyId: input.companyId,
        OR: [{ jobId: view.job.id }, { customerId: view.customer.id }],
      },
      orderBy: { startedAt: "desc" },
      select: { direction: true, startedAt: true, durationSeconds: true, answered: true, missed: true },
    }),
    prisma.jobPart.findMany({
      where: { companyId: input.companyId, jobId: view.job.id, status: { not: "CANCELED" } },
      include: {
        part: { select: { name: true, sku: true } },
        location: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    job: view.job,
    customer: view.customer,
    property: view.property,
    technicians: view.technicians,
    equipment: view.equipment,
    history: {
      lastService: view.customer.lastService,
      recentJobs: view.relatedJobs.slice(0, 4),
    },
    financials: view.financials,
    billing: view.billing,
    costing: view.costing,
    parts: jobParts.map((row) => ({
      id: row.id,
      name: row.part.name,
      sku: row.part.sku,
      quantity: row.quantity,
      status: row.status,
      location: row.location?.name ?? null,
    })),
    communications: {
      lastMessage: thread?.messages[0] ?? null,
      lastCall: call,
    },
  };
}
