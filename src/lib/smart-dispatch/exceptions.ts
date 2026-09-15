import { prisma } from "@/lib/db";
import { isRunningLate } from "@/lib/dispatch/validate";
import { parseDispatchPolicy } from "@/lib/smart-dispatch/policy";
import { recordSmartDispatchEvent, SMART_DISPATCH_EVENTS } from "@/lib/smart-dispatch/events";
import { recommendTechniciansForJob } from "@/lib/smart-dispatch/recommend";

export type DispatchOpportunity = {
  id: string;
  kind: "APPOINTMENT_AT_RISK" | "OPEN_CAPACITY" | "UNASSIGNED_MATCH";
  title: string;
  detail: string;
  jobId?: string;
  technicianId?: string;
  href: string;
};

export async function listMeaningfulOpportunities(input: {
  companyId: string;
  day: Date;
  unassignedJobIds: string[];
  persist?: boolean;
}): Promise<DispatchOpportunity[]> {
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { dispatchPolicyJson: true },
  });
  const policy = parseDispatchPolicy(company?.dispatchPolicyJson);
  const opportunities: DispatchOpportunity[] = [];

  const inProgress = await prisma.job.findMany({
    where: {
      companyId: input.companyId,
      status: "IN_PROGRESS",
      scheduledEnd: { not: null },
    },
    include: { assignments: { include: { user: { select: { firstName: true, lastName: true } } } }, customer: true },
    take: 12,
  });
  for (const job of inProgress) {
    if (!isRunningLate({ scheduledStart: job.scheduledStart, status: "SCHEDULED" }) && job.scheduledEnd && job.scheduledEnd > new Date()) {
      continue;
    }
    const tech = job.assignments[0]?.user;
    const next = await prisma.job.findFirst({
      where: {
        companyId: input.companyId,
        id: { not: job.id },
        status: { in: ["SCHEDULED", "DISPATCHED"] },
        assignments: { some: { userId: job.assignments[0]?.userId ?? "" } },
        scheduledStart: { gt: job.scheduledEnd ?? new Date() },
      },
      orderBy: { scheduledStart: "asc" },
    });
    if (!next) continue;
    opportunities.push({
      id: `risk-${job.id}`,
      kind: "APPOINTMENT_AT_RISK",
      title: "Appointment at risk",
      detail: `${tech ? `${tech.firstName} ${tech.lastName}` : "Technician"} is still on a job. The next promised window may slip.`,
      jobId: next.id,
      technicianId: job.assignments[0]?.userId,
      href: `/jobs?view=dispatch&job=${next.id}`,
    });
    if (input.persist) {
      await recordSmartDispatchEvent({
        companyId: input.companyId,
        kind: SMART_DISPATCH_EVENTS.APPOINTMENT_AT_RISK,
        jobId: next.id,
        technicianId: job.assignments[0]?.userId,
      });
    }
  }

  for (const jobId of input.unassignedJobIds.slice(0, 3)) {
    const match = await recommendTechniciansForJob({
      companyId: input.companyId,
      jobId,
      persist: false,
    });
    if (!match.best) continue;
    opportunities.push({
      id: `match-${jobId}`,
      kind: "UNASSIGNED_MATCH",
      title: `${match.best.name} · ${match.best.score?.display ?? "Best match"}`,
      detail: match.best.reasons.filter((reason) => reason.kind === "POSITIVE").slice(0, 2).map((reason) => reason.label).join(" · ") || "Eligible and available.",
      jobId,
      technicianId: match.best.technicianId,
      href: `/jobs?view=dispatch&job=${jobId}`,
    });
  }

  const available = await prisma.membership.count({
    where: { companyId: input.companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
  });
  if (available && input.unassignedJobIds.length === 0 && policy.minCapacityMinutes) {
    // Capacity chips come from the existing board openings; only surface when the gap is meaningful.
  }

  return opportunities.slice(0, 4);
}

export async function previewDayOptimization() {
  return {
    available: false as const,
    reason:
      "Whole-day optimization is prepared but not auto-applied. Use Optimize Route on one technician, or assign with Smart Match.",
  };
}
