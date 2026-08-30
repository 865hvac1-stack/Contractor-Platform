import { prisma } from "@/lib/db";

export type PlaybookMetrics = {
  playbookId: string;
  jobs: number;
  completedJobs: number;
  revenueCents: number;
  averageTicketCents: number;
  completionTimeMinutes: number | null;
  estimateCount: number;
  closeCount: number;
};

/**
 * Real playbook metrics only. Returns zeros when the company has no matching jobs.
 * Never invents ticket, margin, callback, or review numbers.
 */
export async function getPlaybookMetrics(
  companyId: string,
  playbookId: string
): Promise<PlaybookMetrics | null> {
  const playbook = await prisma.playbook.findFirst({
    where: { id: playbookId, companyId },
    select: { id: true },
  });
  if (!playbook) return null;

  const jobs = await prisma.job.findMany({
    where: { companyId, playbookId },
    select: {
      status: true,
      createdAt: true,
      completedAt: true,
      invoices: { select: { totalCents: true, status: true } },
      estimates: { select: { id: true, status: true } },
    },
  });

  const completed = jobs.filter((job) => job.status === "COMPLETED");
  const paidCents = jobs
    .flatMap((job) => job.invoices)
    .filter((invoice) => invoice.status === "PAID")
    .reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const durations = completed
    .filter((job) => job.completedAt)
    .map((job) => (job.completedAt!.getTime() - job.createdAt.getTime()) / 60000);
  const estimateCount = jobs.reduce((sum, job) => sum + job.estimates.length, 0);
  const closeCount = jobs.reduce(
    (sum, job) => sum + job.estimates.filter((estimate) => estimate.status === "APPROVED").length,
    0
  );

  return {
    playbookId,
    jobs: jobs.length,
    completedJobs: completed.length,
    revenueCents: paidCents,
    averageTicketCents: completed.length > 0 ? Math.round(paidCents / completed.length) : 0,
    completionTimeMinutes:
      durations.length > 0
        ? Math.round(durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length)
        : null,
    estimateCount,
    closeCount,
  };
}
