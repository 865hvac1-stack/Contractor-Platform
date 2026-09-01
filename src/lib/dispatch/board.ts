import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { customerLabel } from "@/lib/tech/today";
import { fieldStatusLabel, propertyAddress } from "@/lib/tech/access";
import { classifyDispatchJob } from "@/lib/dispatch/job-type";
import { isRunningLate, scheduledMinutes, technicianBoardState } from "@/lib/dispatch/validate";

const jobInclude = {
  customer: {
    include: {
      customerMemberships: {
        where: { status: "ACTIVE" as const },
        include: { plan: { select: { name: true } } },
        take: 1,
      },
    },
  },
  property: true,
  assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
} as const;

export type DispatchIssueKind =
  | "running_late"
  | "conflict"
  | "unassigned"
  | "emergency"
  | "missing_technician"
  | "missing_contact"
  | "missing_address";

export type DispatchIssue = {
  id: string;
  kind: DispatchIssueKind;
  title: string;
  subtitle: string;
  href: string;
  jobId?: string;
  customerName?: string;
  minutesLate?: number | null;
};

export async function getDispatchBoard(companyId: string, day = new Date()) {
  const start = startOfDay(day);
  const end = endOfDay(day);

  const [technicians, jobs, unassigned] = await Promise.all([
    prisma.membership.findMany({
      where: { companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.job.findMany({
      where: {
        companyId,
        status: { notIn: ["CANCELED"] },
        assignments: { some: { userId: { not: "" } } },
        OR: [
          { scheduledStart: { gte: start, lte: end } },
          {
            AND: [
              { scheduledStart: null },
              { status: { in: ["SCHEDULED", "DISPATCHED", "IN_PROGRESS"] } },
            ],
          },
        ],
      },
      include: jobInclude,
      orderBy: [{ routeOrder: "asc" }, { scheduledStart: "asc" }, { createdAt: "asc" }],
    }),
    prisma.job.findMany({
      where: {
        companyId,
        status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED"] },
        assignments: { none: {} },
        OR: [{ scheduledStart: { gte: start, lte: end } }, { scheduledStart: null }],
      },
      include: jobInclude,
      orderBy: [{ priority: "desc" }, { scheduledStart: "asc" }, { createdAt: "asc" }],
      take: 80,
    }),
  ]);

  const cards = [...jobs, ...unassigned].map(toDispatchCard);
  const byTech = technicians.map((member) => {
    const laneJobs = cards
      .filter((job) => job.assigneeIds.includes(member.user.id))
      .sort((a, b) => {
        if (!a.scheduledStart) return 1;
        if (!b.scheduledStart) return -1;
        return new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
      });
    const minutes = laneJobs.reduce((sum, job) => sum + scheduledMinutes(job), 0);
    const next = nextAvailableAt(laneJobs);
    return {
      userId: member.user.id,
      name: `${member.user.firstName} ${member.user.lastName}`.trim(),
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      initials: `${member.user.firstName[0] ?? ""}${member.user.lastName[0] ?? ""}`.toUpperCase(),
      role: member.role,
      jobs: laneJobs,
      jobCount: laneJobs.length,
      scheduledMinutes: minutes,
      nextAvailable: next,
      state: technicianBoardState(laneJobs),
    };
  });

  const issues = buildIssues(cards, byTech);
  return {
    day: start,
    technicians: byTech,
    unassigned: cards.filter((job) => job.assigneeIds.length === 0),
    exceptions: issues.map((issue) => ({ kind: issue.kind, title: issue.title, href: issue.href })),
    issues,
    openings: buildOpenings(byTech),
    metrics: buildMetrics(cards),
    jobTypes: [...new Set(cards.map((job) => job.jobType).filter(Boolean))] as string[],
  };
}

export function toDispatchCard(job: {
  id: string;
  jobNumber: string;
  jobType: string | null;
  trade?: string | null;
  status: Parameters<typeof fieldStatusLabel>[0];
  priority: string;
  description: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  scheduleLocked: boolean;
  routeOrder: number | null;
  customerId: string;
  customer: {
    firstName: string;
    lastName: string;
    businessName: string | null;
    phone: string | null;
    email?: string | null;
    customerMemberships: { plan: { name: string } }[];
  };
  property: { address: string; city: string; state: string; zip: string; accessNotes: string | null };
  assignments: { userId: string; user: { id: string; firstName: string; lastName: string } }[];
}) {
  const kind = classifyDispatchJob({ jobType: job.jobType, priority: job.priority, description: job.description });
  return {
    id: job.id,
    customerId: job.customerId,
    jobNumber: job.jobNumber,
    jobType: job.jobType,
    kind,
    trade: job.trade ?? null,
    status: job.status,
    statusLabel: fieldStatusLabel(job.status),
    priority: job.priority,
    description: job.description,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
    scheduleLocked: job.scheduleLocked,
    routeOrder: job.routeOrder,
    customer: customerLabel(job.customer),
    phone: job.customer.phone,
    email: job.customer.email ?? null,
    address: propertyAddress(job.property),
    city: job.property.city,
    accessNotes: job.property.accessNotes,
    membership: job.customer.customerMemberships[0]?.plan.name ?? null,
    assigneeIds: job.assignments.map((row) => row.userId),
    assignees: job.assignments.map((row) => `${row.user.firstName} ${row.user.lastName}`.trim()),
  };
}

function nextAvailableAt(jobs: ReturnType<typeof toDispatchCard>[]) {
  const open = jobs
    .filter((job) => job.scheduledEnd && !["COMPLETED", "CANCELED"].includes(job.status))
    .sort((a, b) => new Date(a.scheduledEnd!).getTime() - new Date(b.scheduledEnd!).getTime());
  if (open.length === 0) return null;
  return open[open.length - 1]?.scheduledEnd ?? null;
}

export function buildMetrics(cards: ReturnType<typeof toDispatchCard>[]) {
  const now = new Date();
  const runningLate = cards.filter((job) => isRunningLate(job, now)).length;
  return {
    jobs: cards.length,
    completed: cards.filter((job) => job.status === "COMPLETED").length,
    inProgress: cards.filter((job) => job.status === "IN_PROGRESS").length,
    runningLate,
    unassigned: cards.filter((job) => job.assigneeIds.length === 0).length,
    emergency: cards.filter((job) => job.priority === "URGENT" || job.kind === "emergency").length,
  };
}

function minutesBehind(job: { scheduledStart: Date | string | null }, now = new Date()) {
  if (!job.scheduledStart) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(job.scheduledStart).getTime()) / 60000));
}

export function buildIssues(
  cards: ReturnType<typeof toDispatchCard>[],
  lanes: { userId: string; name: string; jobs: ReturnType<typeof toDispatchCard>[] }[]
): DispatchIssue[] {
  const items: DispatchIssue[] = [];
  const now = new Date();

  for (const job of cards.filter((row) => row.priority === "URGENT" && row.assigneeIds.length === 0)) {
    items.push({
      id: `emergency-${job.id}`,
      kind: "emergency",
      title: job.customer,
      subtitle: `${job.jobType || "Emergency"} · waiting for assignment`,
      href: `/jobs/${job.id}`,
      jobId: job.id,
      customerName: job.customer,
    });
  }
  for (const job of cards.filter((row) => isRunningLate(row, now))) {
    const late = minutesBehind(job, now);
    items.push({
      id: `late-${job.id}`,
      kind: "running_late",
      title: job.customer,
      subtitle: `${job.assignees[0] || "Unassigned"} · ${job.jobType || "Job"} · ${late} min behind`,
      href: `/jobs/${job.id}`,
      jobId: job.id,
      customerName: job.customer,
      minutesLate: late,
    });
  }
  for (const job of cards.filter((row) => row.assigneeIds.length === 0 && row.priority !== "URGENT")) {
    items.push({
      id: `unassigned-${job.id}`,
      kind: "unassigned",
      title: job.customer,
      subtitle: `${job.jobType || "Job"} · ${job.city || "No city"}`,
      href: `/jobs/${job.id}`,
      jobId: job.id,
      customerName: job.customer,
    });
  }
  for (const job of cards.filter((row) => !row.address.replace(/, /g, "").trim())) {
    items.push({
      id: `address-${job.id}`,
      kind: "missing_address",
      title: job.jobNumber,
      subtitle: "Missing property address",
      href: `/jobs/${job.id}`,
      jobId: job.id,
      customerName: job.customer,
    });
  }
  for (const job of cards.filter((row) => !row.phone)) {
    items.push({
      id: `contact-${job.id}`,
      kind: "missing_contact",
      title: job.customer,
      subtitle: "No phone on file",
      href: `/office/customers/${job.customerId}`,
      jobId: job.id,
      customerName: job.customer,
    });
  }
  for (const lane of lanes) {
    const times = lane.jobs
      .filter((job) => job.scheduledStart && job.status !== "COMPLETED")
      .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime());
    for (let i = 1; i < times.length; i += 1) {
      const prev = times[i - 1];
      const next = times[i];
      if (prev.scheduledEnd && next.scheduledStart && new Date(prev.scheduledEnd) > new Date(next.scheduledStart)) {
        items.push({
          id: `conflict-${lane.userId}-${prev.id}-${next.id}`,
          kind: "conflict",
          title: lane.name,
          subtitle: `${prev.customer} overlaps ${next.customer}`,
          href: `/jobs/${next.id}`,
          jobId: next.id,
          customerName: next.customer,
        });
      }
    }
  }
  return items.slice(0, 40);
}

function buildOpenings(lanes: { userId: string; name: string; jobs: ReturnType<typeof toDispatchCard>[] }[]) {
  return lanes.map((lane) => {
    const timed = lane.jobs
      .filter((job) => job.scheduledStart && job.status !== "COMPLETED" && job.status !== "CANCELED")
      .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime());
    const gaps: string[] = [];
    for (let i = 1; i < timed.length; i += 1) {
      const prevEnd = timed[i - 1].scheduledEnd ? new Date(timed[i - 1].scheduledEnd!).getTime() : null;
      const nextStart = timed[i].scheduledStart ? new Date(timed[i].scheduledStart!).getTime() : null;
      if (prevEnd && nextStart && nextStart - prevEnd >= 90 * 60 * 1000) {
        const minutes = Math.round((nextStart - prevEnd) / 60000);
        gaps.push(`${minutes} min after ${timed[i - 1].customer}`);
      }
    }
    return {
      userId: lane.userId,
      name: lane.name,
      jobCount: lane.jobs.length,
      gaps,
    };
  });
}
