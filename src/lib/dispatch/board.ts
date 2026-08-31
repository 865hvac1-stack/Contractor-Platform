import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { customerLabel } from "@/lib/tech/today";
import { fieldStatusLabel, propertyAddress } from "@/lib/tech/access";

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
        status: { not: "CANCELED" },
        assignments: { some: {} },
        OR: [
          { scheduledStart: { gte: start, lte: end } },
          {
            AND: [
              { scheduledStart: null },
              { status: { in: ["SCHEDULED", "DISPATCHED", "IN_PROGRESS"] } },
              { assignments: { some: {} } },
            ],
          },
        ],
      },
      include: {
        customer: true,
        property: true,
        assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        customerMemberships: { include: { plan: { select: { name: true } } }, take: 1 },
      },
      orderBy: [{ routeOrder: "asc" }, { scheduledStart: "asc" }, { createdAt: "asc" }],
    }),
    prisma.job.findMany({
      where: {
        companyId,
        status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED"] },
        assignments: { none: {} },
      },
      include: {
        customer: true,
        property: true,
        assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        customerMemberships: { include: { plan: { select: { name: true } } }, take: 1 },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 80,
    }),
  ]);

  const cards = [...jobs, ...unassigned].map(toDispatchCard);
  const byTech = technicians.map((member) => ({
    userId: member.user.id,
    name: `${member.user.firstName} ${member.user.lastName}`.trim(),
    role: member.role,
    jobs: cards.filter((job) => job.assigneeIds.includes(member.user.id)),
  }));

  return {
    day: start,
    technicians: byTech,
    unassigned: cards.filter((job) => job.assigneeIds.length === 0),
    exceptions: buildExceptions(cards, byTech),
    openings: buildOpenings(byTech),
  };
}

export function toDispatchCard(job: {
  id: string;
  jobNumber: string;
  jobType: string | null;
  status: Parameters<typeof fieldStatusLabel>[0];
  priority: string;
  description: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  scheduleLocked: boolean;
  routeOrder: number | null;
  customerId: string;
  customer: { firstName: string; lastName: string; businessName: string | null; phone: string | null };
  property: { address: string; city: string; state: string; zip: string; accessNotes: string | null };
  assignments: { userId: string; user: { id: string; firstName: string; lastName: string } }[];
  customerMemberships: { plan: { name: string }; status: string }[];
}) {
  return {
    id: job.id,
    customerId: job.customerId,
    jobNumber: job.jobNumber,
    jobType: job.jobType,
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
    address: propertyAddress(job.property),
    city: job.property.city,
    accessNotes: job.property.accessNotes,
    membership: job.customerMemberships[0]?.plan.name ?? null,
    assigneeIds: job.assignments.map((row) => row.userId),
    assignees: job.assignments.map((row) => `${row.user.firstName} ${row.user.lastName}`.trim()),
  };
}

function buildExceptions(
  cards: ReturnType<typeof toDispatchCard>[],
  lanes: { userId: string; name: string; jobs: ReturnType<typeof toDispatchCard>[] }[]
) {
  const items: { kind: string; title: string; href: string }[] = [];
  for (const job of cards.filter((row) => row.assigneeIds.length === 0)) {
    items.push({ kind: "unassigned", title: `${job.customer} is unassigned`, href: `/jobs/${job.id}` });
  }
  for (const job of cards.filter((row) => !row.address.replace(/, /g, "").trim())) {
    items.push({ kind: "missing_address", title: `${job.jobNumber} is missing an address`, href: `/jobs/${job.id}` });
  }
  const now = new Date();
  for (const job of cards.filter(
    (row) =>
      row.scheduledStart &&
      row.scheduledStart < now &&
      ["SCHEDULED", "DISPATCHED"].includes(row.status)
  )) {
    items.push({
      kind: "running_late",
      title: `${job.customer} is past the scheduled start`,
      href: `/jobs/${job.id}`,
    });
  }
  for (const job of cards.filter((row) => row.priority === "URGENT" && row.assigneeIds.length === 0)) {
    items.push({
      kind: "emergency_waiting",
      title: `Urgent: ${job.customer} is waiting for assignment`,
      href: `/jobs/${job.id}`,
    });
  }
  for (const lane of lanes) {
    const times = lane.jobs
      .filter((job) => job.scheduledStart && job.status !== "COMPLETED")
      .sort((a, b) => (a.scheduledStart!.getTime() ?? 0) - (b.scheduledStart!.getTime() ?? 0));
    for (let i = 1; i < times.length; i += 1) {
      const prev = times[i - 1];
      const next = times[i];
      if (prev.scheduledEnd && next.scheduledStart && prev.scheduledEnd > next.scheduledStart) {
        items.push({
          kind: "conflict",
          title: `${lane.name} has overlapping jobs`,
          href: `/dispatch`,
        });
      }
    }
  }
  return items.slice(0, 20);
}

function buildOpenings(lanes: { userId: string; name: string; jobs: ReturnType<typeof toDispatchCard>[] }[]) {
  return lanes.map((lane) => {
    const timed = lane.jobs
      .filter((job) => job.scheduledStart && job.status !== "COMPLETED" && job.status !== "CANCELED")
      .sort((a, b) => a.scheduledStart!.getTime() - b.scheduledStart!.getTime());
    const gaps: string[] = [];
    for (let i = 1; i < timed.length; i += 1) {
      const prevEnd = timed[i - 1].scheduledEnd?.getTime();
      const nextStart = timed[i].scheduledStart?.getTime();
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
