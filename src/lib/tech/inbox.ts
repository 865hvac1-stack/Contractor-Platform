import { prisma } from "@/lib/db";

export type TechInboxItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  createdAt: Date;
};

export async function technicianInbox(companyId: string, userId: string): Promise<TechInboxItem[]> {
  const assigned = { assignments: { some: { userId } } };
  const [calls, estimates, payments, jobs] = await Promise.all([
    prisma.callRecord.findMany({
      where: { companyId, job: assigned },
      orderBy: { startedAt: "desc" },
      take: 15,
      select: { id: true, caller: true, startedAt: true, jobId: true },
    }),
    prisma.estimate.findMany({
      where: { companyId, status: "APPROVED", job: assigned },
      orderBy: { approvedAt: "desc" },
      take: 10,
      select: { id: true, estimateNumber: true, approvedAt: true, jobId: true },
    }),
    prisma.payment.findMany({
      where: { companyId, invoice: { job: assigned } },
      orderBy: { paidAt: "desc" },
      take: 10,
      select: { id: true, amountCents: true, paidAt: true, invoice: { select: { jobId: true, invoiceNumber: true } } },
    }),
    prisma.job.findMany({
      where: { companyId, ...assigned, status: { in: ["SCHEDULED", "DISPATCHED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, jobNumber: true, updatedAt: true, status: true },
    }),
  ]);
  const items: TechInboxItem[] = [
    ...calls.map((call) => ({
      id: `call-${call.id}`,
      title: "Customer call logged",
      detail: call.caller || "Call",
      href: call.jobId ? `/tech/jobs/${call.jobId}` : "/tech/inbox",
      createdAt: call.startedAt,
    })),
    ...estimates.map((estimate) => ({
      id: `est-${estimate.id}`,
      title: "Estimate approved",
      detail: estimate.estimateNumber,
      href: estimate.jobId ? `/tech/jobs/${estimate.jobId}` : "/tech/inbox",
      createdAt: estimate.approvedAt ?? new Date(),
    })),
    ...payments.map((payment) => ({
      id: `pay-${payment.id}`,
      title: "Payment received",
      detail: payment.invoice.invoiceNumber,
      href: payment.invoice.jobId ? `/tech/jobs/${payment.invoice.jobId}` : "/tech/inbox",
      createdAt: payment.paidAt,
    })),
    ...jobs.map((job) => ({
      id: `job-${job.id}`,
      title: job.status === "SCHEDULED" ? "Schedule updated" : "Job assigned",
      detail: job.jobNumber,
      href: `/tech/jobs/${job.id}`,
      createdAt: job.updatedAt,
    })),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 30);
}
