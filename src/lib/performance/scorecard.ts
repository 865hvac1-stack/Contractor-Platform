import { prisma } from "@/lib/db";
import { summarizeCompensation } from "@/lib/compensation/calculate";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks } from "date-fns";

export type ScorePeriod = "this_week" | "last_week" | "this_month";

export function periodRange(period: ScorePeriod) {
  const now = new Date();
  if (period === "last_week") {
    const d = subWeeks(now, 1);
    return { start: startOfWeek(d, { weekStartsOn: 1 }), end: endOfWeek(d, { weekStartsOn: 1 }), label: "Last week" };
  }
  if (period === "this_month") {
    return { start: startOfMonth(now), end: endOfMonth(now), label: "This month" };
  }
  return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }), label: "This week" };
}

export async function technicianScorecard(input: {
  companyId: string;
  userId: string;
  period?: ScorePeriod;
  includeMargin?: boolean;
}) {
  const range = periodRange(input.period ?? "this_week");
  const jobFilter = { companyId: input.companyId, assignments: { some: { userId: input.userId } } };
  const [jobsCompleted, invoices, estimates, memberships, compensation, reviews, callbacks] = await Promise.all([
    prisma.job.count({
      where: { ...jobFilter, status: "COMPLETED", completedAt: { gte: range.start, lte: range.end } },
    }),
    prisma.invoice.findMany({
      where: {
        companyId: input.companyId,
        status: { notIn: ["DRAFT", "VOID"] },
        createdAt: { gte: range.start, lte: range.end },
        job: { assignments: { some: { userId: input.userId } } },
      },
      select: { totalCents: true, amountPaidCents: true, status: true },
    }),
    prisma.estimate.findMany({
      where: { companyId: input.companyId, createdById: input.userId, createdAt: { gte: range.start, lte: range.end } },
      select: { status: true, totalCents: true },
    }),
    prisma.customerMembership.findMany({
      where: { companyId: input.companyId, soldById: input.userId, saleDate: { gte: range.start, lte: range.end } },
      select: { id: true, status: true, priceCents: true },
    }),
    prisma.compensationEvent.findMany({
      where: { companyId: input.companyId, userId: input.userId, earnedAt: { gte: range.start, lte: range.end } },
    }),
    prisma.review.count({
      where: { companyId: input.companyId, job: { assignments: { some: { userId: input.userId } } }, createdAt: { gte: range.start, lte: range.end } },
    }),
    prisma.job.count({
      where: {
        ...jobFilter,
        createdAt: { gte: range.start, lte: range.end },
        OR: [{ jobType: { contains: "callback", mode: "insensitive" } }, { description: { contains: "callback", mode: "insensitive" } }],
      },
    }),
  ]);
  const revenueCents = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const collectedCents = invoices.reduce((sum, invoice) => sum + invoice.amountPaidCents, 0);
  const presented = estimates.length;
  const approved = estimates.filter((estimate) => estimate.status === "APPROVED").length;
  const closeRate = presented === 0 ? null : Math.round((approved / presented) * 1000) / 10;
  const avgTicket = invoices.length === 0 ? null : Math.round(revenueCents / invoices.length);
  const membershipConversion = presented === 0 ? null : Math.round((memberships.length / presented) * 1000) / 10;
  return {
    period: range,
    jobsCompleted,
    revenueCents,
    collectedCents,
    averageTicketCents: avgTicket,
    estimatesPresented: presented,
    estimatesApproved: approved,
    closeRate,
    membershipsSold: memberships.length,
    membershipConversion,
    reviews,
    callbacks,
    incentives: summarizeCompensation(compensation),
    events: compensation,
    includeMargin: Boolean(input.includeMargin),
  };
}

export function closeRate(presented: number, approved: number) {
  if (presented === 0) return null;
  return Math.round((approved / presented) * 1000) / 10;
}

export function averageTicket(totals: number[]) {
  if (totals.length === 0) return null;
  return Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length);
}

export function membershipConversion(presented: number, sold: number) {
  if (presented === 0) return null;
  return Math.round((sold / presented) * 1000) / 10;
}
