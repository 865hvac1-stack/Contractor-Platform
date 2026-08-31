import type { PrismaClient } from "@prisma/client";
import { propertyAddress } from "@/lib/tech/access";
import {
  googleRoutingProvider,
  routingConfigured,
  RoutingNotConfiguredError,
  type RoutingProvider,
  type RouteOptimizeResult,
} from "@/lib/routing/provider";

const CLOSED = new Set(["COMPLETED", "CANCELED"]);
const IMMOVABLE_STATUS = new Set(["COMPLETED", "IN_PROGRESS", "CANCELED"]);

export type OptimizeJob = {
  id: string;
  status: string;
  scheduleLocked: boolean;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  arrivalWindowStart: Date | null;
  arrivalWindowEnd: Date | null;
  address: string | null;
  priority: string;
};

export function jobIsImmovable(job: Pick<OptimizeJob, "status" | "scheduleLocked">) {
  return IMMOVABLE_STATUS.has(job.status) || job.scheduleLocked;
}

export function hasHardWindow(job: Pick<OptimizeJob, "arrivalWindowStart" | "arrivalWindowEnd">) {
  return Boolean(job.arrivalWindowStart && job.arrivalWindowEnd);
}

export function windowViolated(job: OptimizeJob, proposedStart: Date) {
  if (!job.arrivalWindowStart || !job.arrivalWindowEnd) return false;
  return proposedStart < job.arrivalWindowStart || proposedStart > job.arrivalWindowEnd;
}

export function companyDepotAddress(company: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}) {
  return [company.address, company.city, company.state, company.zip].filter(Boolean).join(", ");
}

export async function previewTechnicianRoute(
  prisma: PrismaClient,
  input: {
    companyId: string;
    technicianUserId: string;
    day: Date;
    includeHome?: boolean;
    provider?: RoutingProvider;
  }
) {
  if (!(input.provider ?? googleRoutingProvider()).configured() && !input.provider) {
    throw new RoutingNotConfiguredError();
  }
  const provider = input.provider ?? googleRoutingProvider();
  const dayStart = new Date(input.day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const [company, membership, jobs] = await Promise.all([
    prisma.company.findUnique({ where: { id: input.companyId } }),
    prisma.membership.findUnique({
      where: { companyId_userId: { companyId: input.companyId, userId: input.technicianUserId } },
    }),
    prisma.job.findMany({
      where: {
        companyId: input.companyId,
        status: { not: "CANCELED" },
        assignments: { some: { userId: input.technicianUserId } },
        OR: [
          { scheduledStart: { gte: dayStart, lte: dayEnd } },
          { AND: [{ scheduledStart: null }, { status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED"] } }] },
        ],
      },
      include: { property: true },
      orderBy: [{ routeOrder: "asc" }, { scheduledStart: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  if (!company) throw new Error("Company not found.");

  const mapped: OptimizeJob[] = jobs.map((job) => ({
    id: job.id,
    status: job.status,
    scheduleLocked: job.scheduleLocked,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
    arrivalWindowStart: job.arrivalWindowStart,
    arrivalWindowEnd: job.arrivalWindowEnd,
    address: job.property ? propertyAddress(job.property) : null,
    priority: job.priority,
  }));

  const missing = mapped.filter((job) => !CLOSED.has(job.status) && !job.address);
  const movable = mapped.filter((job) => !jobIsImmovable(job) && job.address);
  const fixed = mapped.filter((job) => jobIsImmovable(job));

  if (movable.length === 0) {
    return {
      configured: provider.configured(),
      current: emptyMeasure(mapped),
      suggested: emptyMeasure(mapped),
      applied: false,
      reason: "nothing_to_optimize" as const,
      missingAddresses: missing.map((job) => job.id),
      fixedJobIds: fixed.map((job) => job.id),
    };
  }

  const depot = companyDepotAddress(company);
  const origin =
    membership?.routeStartKind === "FIRST_JOB"
      ? movable[0].address!
      : depot || movable[0].address!;
  const destination =
    membership?.routeEndKind === "HOME" && input.includeHome && membership.homeAddress
      ? [membership.homeAddress, membership.homeCity, membership.homeState, membership.homeZip]
          .filter(Boolean)
          .join(", ")
      : membership?.routeEndKind === "COMPANY" && depot
        ? depot
        : movable[movable.length - 1].address!;

  const current = await measureSequence(
    provider,
    origin,
    destination,
    movable.map((job) => ({ id: job.id, address: job.address! }))
  );
  const suggestedRaw = await provider.optimize({
    origin,
    destination,
    stops: movable.map((job) => ({ id: job.id, address: job.address! })),
  });

  const proposedOrder = mergeFixedOrder(
    mapped,
    suggestedRaw.orderedIds.length ? suggestedRaw.orderedIds : movable.map((job) => job.id)
  );
  const windowSafe = enforceWindows(mapped, proposedOrder);
  const suggestedStops = windowSafe
    .map((id) => mapped.find((job) => job.id === id))
    .filter((job): job is OptimizeJob => Boolean(job?.address && !jobIsImmovable(job)));
  const suggested =
    suggestedStops.length > 0
      ? await measureSequence(
          provider,
          origin,
          destination,
          suggestedStops.map((job) => ({ id: job.id, address: job.address! }))
        )
      : current;

  return {
    configured: true,
    current,
    suggested: { ...suggested, orderedIds: windowSafe },
    applied: false,
    reason: "ok" as const,
    missingAddresses: missing.map((job) => job.id),
    fixedJobIds: fixed.map((job) => job.id),
    originUsed: origin,
    destinationUsed: destination,
    homeExposed: false,
  };
}

export async function applyTechnicianRoute(
  prisma: PrismaClient,
  input: {
    companyId: string;
    technicianUserId: string;
    orderedIds: string[];
    day: Date;
  }
) {
  const dayStart = new Date(input.day);
  dayStart.setHours(0, 0, 0, 0);
  const jobs = await prisma.job.findMany({
    where: { companyId: input.companyId, id: { in: input.orderedIds } },
  });
  if (jobs.length !== input.orderedIds.length) {
    throw new Error("One or more jobs are not in this company.");
  }
  for (const job of jobs) {
    if (jobIsImmovable(job)) continue;
    const assigned = await prisma.jobAssignment.findFirst({
      where: { jobId: job.id, userId: input.technicianUserId },
    });
    if (!assigned) throw new Error("Job is not assigned to that technician.");
  }

  const movable = input.orderedIds.filter((id) => {
    const job = jobs.find((row) => row.id === id);
    return job && !jobIsImmovable(job);
  });
  const base = movable
    .map((id) => jobs.find((row) => row.id === id)?.scheduledStart)
    .find((value) => value instanceof Date);
  const start = base ? new Date(base) : new Date(dayStart.getTime() + 8 * 60 * 60 * 1000);

  await prisma.$transaction(
    movable.map((id, index) => {
      const job = jobs.find((row) => row.id === id)!;
      const durationMs =
        job.scheduledStart && job.scheduledEnd
          ? Math.max(30 * 60 * 1000, job.scheduledEnd.getTime() - job.scheduledStart.getTime())
          : 90 * 60 * 1000;
      const scheduledStart = new Date(start.getTime() + index * durationMs);
      if (windowViolated({ ...job, address: null }, scheduledStart)) {
        return prisma.job.update({
          where: { id },
          data: { routeOrder: index + 1 },
        });
      }
      return prisma.job.update({
        where: { id },
        data: {
          routeOrder: index + 1,
          scheduledStart,
          scheduledEnd: new Date(scheduledStart.getTime() + durationMs),
          status: job.status === "NEW" || job.status === "UNSCHEDULED" ? "SCHEDULED" : job.status,
        },
      });
    })
  );
}

function emptyMeasure(jobs: OptimizeJob[]): RouteOptimizeResult {
  return {
    provider: "none",
    orderedIds: jobs.map((job) => job.id),
    durationSeconds: 0,
    distanceMeters: 0,
    legs: [],
    polyline: null,
    mapUrl: null,
  };
}

async function measureSequence(
  provider: RoutingProvider,
  origin: string,
  destination: string,
  stops: { id: string; address: string }[]
) {
  if (!stops.length) return emptyMeasure([]);
  return provider.optimize({ origin, destination, stops });
}

export function mergeFixedOrder(jobs: OptimizeJob[], suggestedMovableIds: string[]) {
  const immovable = jobs.filter(jobIsImmovable);
  const movableQueue = suggestedMovableIds.filter((id) => jobs.some((job) => job.id === id && !jobIsImmovable(job)));
  const result: string[] = [];
  for (const job of jobs) {
    if (jobIsImmovable(job)) {
      result.push(job.id);
    } else {
      const next = movableQueue.shift();
      if (next) result.push(next);
    }
  }
  for (const leftover of movableQueue) result.push(leftover);
  for (const job of immovable) {
    if (!result.includes(job.id)) result.push(job.id);
  }
  return result;
}

export function enforceWindows(jobs: OptimizeJob[], proposedIds: string[]) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const original = jobs.map((job) => job.id);
  const proposed = [...proposedIds];
  proposed.forEach((id, index) => {
    const job = byId.get(id);
    if (!job || !hasHardWindow(job) || !job.scheduledStart) return;
    const originalIndex = original.indexOf(id);
    if (originalIndex >= 0 && originalIndex !== index) {
      const occupant = proposed[originalIndex];
      proposed[originalIndex] = id;
      proposed[index] = occupant;
    }
  });
  return proposed.filter(Boolean);
}

export { routingConfigured };
