import { subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";

export type OpportunityItem = {
  id: string;
  type: string;
  title: string;
  summary: string;
  reason: string;
  href: string;
  priority: "HIGH" | "NORMAL";
  valueCents?: number;
};

export async function getOpportunities(companyId: string): Promise<OpportunityItem[]> {
  const where = scopedCompanyWhere(companyId);
  const cutoff = subDays(new Date(), 3);
  const inactiveSince = subDays(new Date(), 180);
  const items: OpportunityItem[] = [];

  const staleEstimates = await prisma.estimate.findMany({
    where: {
      ...where,
      status: { in: ["SENT", "VIEWED"] },
      issueDate: { lte: cutoff },
    },
    orderBy: { totalCents: "desc" },
    take: 8,
    include: { customer: { select: { firstName: true, lastName: true, businessName: true } } },
  });
  for (const estimate of staleEstimates) {
    const name =
      estimate.customer.businessName?.trim() ||
      `${estimate.customer.firstName} ${estimate.customer.lastName}`.trim();
    items.push({
      id: `est-${estimate.id}`,
      type: "estimate_follow_up",
      title: `${estimate.estimateNumber} · ${name}`,
      summary: "Open estimate with no recent close.",
      reason:
        estimate.totalCents >= 200000
          ? "High value + still open after 3 days."
          : "Sent more than 3 days ago and still open.",
      href: `/estimates/${estimate.id}`,
      priority: estimate.totalCents >= 200000 ? "HIGH" : "NORMAL",
      valueCents: estimate.totalCents,
    });
  }

  const engagedLeads = await prisma.lead.findMany({
    where: {
      ...where,
      status: { in: ["NEW", "CONTACTED"] },
      receivedAt: { lte: cutoff },
    },
    orderBy: { receivedAt: "asc" },
    take: 6,
  });
  for (const lead of engagedLeads) {
    items.push({
      id: `lead-${lead.id}`,
      type: "lead_not_booked",
      title: `${lead.firstName} ${lead.lastName}`,
      summary: "Lead is still open and has not booked.",
      reason: "Engaged or received more than 3 days ago.",
      href: `/marketing/leads/${lead.id}`,
      priority: "NORMAL",
    });
  }

  const completed = await prisma.job.findMany({
    where: {
      ...where,
      status: "COMPLETED",
      completedAt: { lte: inactiveSince },
    },
    orderBy: { completedAt: "asc" },
    take: 5,
    include: { customer: { select: { id: true, firstName: true, lastName: true, businessName: true } } },
  });
  const completedJobCounts = await prisma.job.groupBy({
    by: ["customerId"],
    where: { companyId, status: "COMPLETED" },
    _count: { customerId: true },
  });
  const repeatIds = completedJobCounts.filter((row) => row._count.customerId >= 2).map((row) => row.customerId);
  if (repeatIds.length > 0) {
    const members = await prisma.customerMembership.findMany({
      where: { companyId, status: "ACTIVE", customerId: { in: repeatIds } },
      select: { customerId: true },
    });
    const memberSet = new Set(members.map((row) => row.customerId));
    const withoutMembership = repeatIds.filter((id) => !memberSet.has(id)).length;
    if (withoutMembership >= 3) {
      items.push({
        id: "membership-opportunity",
        type: "membership_opportunity",
        title: `${withoutMembership} repeat customers without a membership`,
        summary: `${withoutMembership} customers`,
        reason: "Repeat service history with no active membership.",
        href: "/memberships",
        priority: "NORMAL",
      });
    }
  }

  for (const job of completed) {
    const recent = await prisma.job.count({
      where: {
        companyId,
        customerId: job.customerId,
        completedAt: { gt: inactiveSince },
      },
    });
    if (recent > 0) continue;
    const name =
      job.customer.businessName?.trim() ||
      `${job.customer.firstName} ${job.customer.lastName}`.trim();
    items.push({
      id: `cust-${job.customer.id}`,
      type: "inactive_customer",
      title: name,
      summary: "No completed job in the last 180 days.",
      reason: "Repeat customer opportunity from last completed work.",
      href: `/customers/${job.customer.id}`,
      priority: "NORMAL",
    });
  }

  return items.slice(0, 10);
}
