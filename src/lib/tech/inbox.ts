import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { customerLabel } from "@/lib/tech/today";
import { smsProviderConfigured } from "@/lib/communications/sms";

export type TechInboxItem = {
  id: string;
  customer: string;
  jobContext: string;
  preview: string;
  href: string;
  createdAt: Date;
  unread: boolean;
  phone: string | null;
};

export async function technicianInbox(companyId: string, userId: string): Promise<TechInboxItem[]> {
  const assigned = { assignments: { some: { userId } } };
  const [calls, estimates, payments, jobs] = await Promise.all([
    prisma.callRecord.findMany({
      where: { companyId, job: assigned },
      orderBy: { startedAt: "desc" },
      take: 15,
      select: {
        id: true,
        caller: true,
        startedAt: true,
        jobId: true,
        missed: true,
        job: {
          select: {
            jobNumber: true,
            jobType: true,
            customer: { select: { firstName: true, lastName: true, businessName: true, phone: true } },
          },
        },
      },
    }),
    prisma.estimate.findMany({
      where: { companyId, status: "APPROVED", job: assigned },
      orderBy: { approvedAt: "desc" },
      take: 10,
      select: {
        id: true,
        estimateNumber: true,
        approvedAt: true,
        jobId: true,
        job: {
          select: {
            jobNumber: true,
            jobType: true,
            customer: { select: { firstName: true, lastName: true, businessName: true, phone: true } },
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: { companyId, invoice: { job: assigned } },
      orderBy: { paidAt: "desc" },
      take: 10,
      select: {
        id: true,
        amountCents: true,
        paidAt: true,
        invoice: {
          select: {
            jobId: true,
            invoiceNumber: true,
            job: {
              select: {
                jobNumber: true,
                jobType: true,
                customer: { select: { firstName: true, lastName: true, businessName: true, phone: true } },
              },
            },
          },
        },
      },
    }),
    prisma.job.findMany({
      where: { companyId, ...assigned, status: { in: ["SCHEDULED", "DISPATCHED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        updatedAt: true,
        status: true,
        customer: { select: { firstName: true, lastName: true, businessName: true, phone: true } },
      },
    }),
  ]);

  const items: TechInboxItem[] = [
    ...calls.map((call) => ({
      id: `call-${call.id}`,
      customer: call.job?.customer ? customerLabel(call.job.customer) : call.caller || "Customer",
      jobContext: call.job ? `${call.job.jobType || "Job"} · ${call.job.jobNumber}` : "Call",
      preview: call.missed ? "Missed call" : "Call activity logged",
      href: call.jobId ? `/tech/jobs/${call.jobId}` : "/tech/inbox",
      createdAt: call.startedAt,
      unread: Boolean(call.missed),
      phone: call.job?.customer.phone ?? null,
    })),
    ...estimates.map((estimate) => ({
      id: `est-${estimate.id}`,
      customer: estimate.job?.customer ? customerLabel(estimate.job.customer) : "Customer",
      jobContext: estimate.job ? `${estimate.job.jobType || "Job"} · ${estimate.job.jobNumber}` : estimate.estimateNumber,
      preview: `Estimate ${estimate.estimateNumber} approved`,
      href: estimate.jobId ? `/tech/jobs/${estimate.jobId}` : "/tech/inbox",
      createdAt: estimate.approvedAt ?? new Date(),
      unread: false,
      phone: estimate.job?.customer.phone ?? null,
    })),
    ...payments.map((payment) => ({
      id: `pay-${payment.id}`,
      customer: payment.invoice.job?.customer ? customerLabel(payment.invoice.job.customer) : "Customer",
      jobContext: payment.invoice.job
        ? `${payment.invoice.job.jobType || "Job"} · ${payment.invoice.job.jobNumber}`
        : payment.invoice.invoiceNumber,
      preview: `Payment ${formatMoney(payment.amountCents)} recorded`,
      href: payment.invoice.jobId ? `/tech/jobs/${payment.invoice.jobId}` : "/tech/inbox",
      createdAt: payment.paidAt,
      unread: false,
      phone: payment.invoice.job?.customer.phone ?? null,
    })),
    ...jobs.map((job) => ({
      id: `job-${job.id}`,
      customer: customerLabel(job.customer),
      jobContext: `${job.jobType || "Job"} · ${job.jobNumber}`,
      preview: job.status === "SCHEDULED" ? "Schedule updated" : "Job assigned to you",
      href: `/tech/jobs/${job.id}`,
      createdAt: job.updatedAt,
      unread: false,
      phone: job.customer.phone,
    })),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 30);
}

export function technicianInboxEmptyCopy() {
  return {
    title: "No conversations yet.",
    detail: smsProviderConfigured()
      ? "Calls, texts, and updates for your assigned jobs will appear here."
      : "Calls, texts, and updates for your assigned jobs will appear here. Company calling and texting stay off until Communications is configured.",
  };
}
