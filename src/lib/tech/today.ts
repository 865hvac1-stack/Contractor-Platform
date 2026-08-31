import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";

export async function technicianTodayJobs(companyId: string, userId: string) {
  const start = startOfDay(new Date());
  const end = endOfDay(new Date());
  return prisma.job.findMany({
    where: {
      companyId,
      assignments: { some: { userId } },
      status: { notIn: ["CANCELED"] },
      OR: [
        { scheduledStart: { gte: start, lte: end } },
        { scheduledStart: null, status: { in: ["DISPATCHED", "IN_PROGRESS", "SCHEDULED"] } },
      ],
    },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, businessName: true } },
      property: true,
      assignments: { include: { user: { select: { firstName: true, lastName: true } } } },
      playbook: { select: { name: true } },
      customerMemberships: {
        where: { status: "ACTIVE" },
        include: { plan: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: [{ scheduledStart: "asc" }, { createdAt: "asc" }],
  });
}

export async function technicianUpcomingJobs(companyId: string, userId: string) {
  return prisma.job.findMany({
    where: {
      companyId,
      assignments: { some: { userId } },
      status: { notIn: ["CANCELED", "COMPLETED"] },
      scheduledStart: { gt: endOfDay(new Date()) },
    },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, businessName: true } },
      property: true,
      playbook: { select: { name: true } },
      customerMemberships: {
        where: { status: "ACTIVE" },
        include: { plan: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: { scheduledStart: "asc" },
    take: 40,
  });
}

export function customerLabel(customer: {
  firstName: string;
  lastName: string;
  businessName?: string | null;
}) {
  return customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();
}
