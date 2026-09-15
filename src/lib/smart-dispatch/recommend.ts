import { prisma } from "@/lib/db";
import { findScheduleConflict } from "@/lib/dispatch/validate";
import { cachedRouteMatrix } from "@/lib/maps/matrix-cache";
import { pointKey, type RoutingMatrixProvider } from "@/lib/maps/routing";
import { resolveTechnicianLocation } from "@/lib/maps/technician-location";
import { parseDispatchPolicy, weightsForCategory } from "@/lib/smart-dispatch/policy";
import { recordSmartDispatchEvent, SMART_DISPATCH_EVENTS } from "@/lib/smart-dispatch/events";
import {
  combineScore,
  driveTimeScore,
  familiarityScore,
  historicalPerformanceScore,
  partsReadinessScore,
  routeImpactScore,
  scheduleFitScore,
  skillFitScore,
  workloadScore,
  type RankedScore,
} from "@/lib/smart-dispatch/score";
import { getTechnicianJobFit } from "@/lib/technician-intelligence/job-fit";
import { propertyAddress } from "@/lib/tech/access";

export type SmartDispatchCandidate = {
  technicianId: string;
  name: string;
  eligible: boolean;
  infeasible: boolean;
  profileNeedsSetup: boolean;
  limitedMatchData: boolean;
  score: RankedScore | null;
  driveSeconds: number | null;
  driveMinutes: number | null;
  driveLabel: string | null;
  locationLabel: string;
  locationFreshness: string;
  nextJobImpactMinutes: number | null;
  reasons: Array<{ code: string; label: string; kind: string }>;
  blockers: Array<{ code: string; label: string }>;
  recommended: boolean;
};

export type SmartDispatchMatch = {
  jobId: string;
  routingAvailable: boolean;
  routingStatus: "OK" | "ROUTING_TEMPORARILY_UNAVAILABLE" | "SKIPPED";
  best: SmartDispatchCandidate | null;
  candidates: SmartDispatchCandidate[];
  ineligible: SmartDispatchCandidate[];
};

function minutesFromSeconds(value: number | null) {
  return value == null ? null : Math.max(1, Math.round(value / 60));
}

function driveLabel(seconds: number | null, freshness: string) {
  if (seconds == null) return null;
  const minutes = minutesFromSeconds(seconds);
  if (freshness === "STALE") return `~${minutes} min drive · based on stale location`;
  if (freshness === "UNAVAILABLE") return null;
  return `${minutes} min drive`;
}

export async function recommendTechniciansForJob(input: {
  companyId: string;
  jobId: string;
  now?: Date;
  routingProvider?: RoutingMatrixProvider;
  persist?: boolean;
}): Promise<SmartDispatchMatch> {
  const now = input.now ?? new Date();
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    include: {
      property: true,
      assignments: true,
      jobParts: { where: { status: { not: "CANCELED" } }, include: { part: { include: { inventoryStocks: true } } } },
      company: { select: { dispatchPolicyJson: true } },
    },
  });
  if (!job) throw new Error("Job not found");

  const memberships = await prisma.membership.findMany({
    where: { companyId: input.companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });

  const fits = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
      fit: await getTechnicianJobFit({
        companyId: input.companyId,
        technicianId: membership.userId,
        jobId: job.id,
        now,
      }),
    }))
  );

  const locations = await Promise.all(
    memberships.map((membership) =>
      resolveTechnicianLocation({ companyId: input.companyId, technicianId: membership.userId, now })
    )
  );
  const locationByTech = new Map(locations.map((row) => [row.technicianId, row]));

  const destPoint =
    job.property.latitude != null && job.property.longitude != null
      ? { lat: job.property.latitude, lng: job.property.longitude }
      : propertyAddress(job.property);
  const destKey = pointKey(destPoint);

  const eligibleForRouting = fits.filter((row) => row.fit.eligible);
  const origins = eligibleForRouting
    .map((row) => {
      const location = locationByTech.get(row.membership.userId);
      if (!location?.point) return null;
      return { key: `${row.membership.userId}:${pointKey(location.point)}`, point: location.point, technicianId: row.membership.userId };
    })
    .filter(Boolean) as Array<{ key: string; point: { lat: number; lng: number }; technicianId: string }>;

  let routingStatus: SmartDispatchMatch["routingStatus"] = origins.length ? "OK" : "SKIPPED";
  const driveByTech = new Map<string, number>();
  if (origins.length) {
    const matrix = await cachedRouteMatrix({
      companyId: input.companyId,
      origins: origins.map(({ key, point }) => ({ key, point })),
      destinations: [{ key: destKey, point: destPoint }],
      trafficAware: true,
      provider: input.routingProvider,
    });
    if (matrix.error) routingStatus = "ROUTING_TEMPORARILY_UNAVAILABLE";
    for (const origin of origins) {
      const row = matrix.rows.find((item) => item.originKey === origin.key && item.destKey === destKey);
      if (row) driveByTech.set(origin.technicianId, row.durationSeconds);
    }
  }

  const dayStart = new Date(job.scheduledStart ?? now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);
  const dayJobs = await prisma.job.findMany({
    where: {
      companyId: input.companyId,
      id: { not: job.id },
      status: { notIn: ["CANCELED", "COMPLETED"] },
      scheduledStart: { gte: dayStart, lte: dayEnd },
    },
    include: { assignments: true },
  });

  const policy = parseDispatchPolicy(job.company.dispatchPolicyJson);
  const weights = weightsForCategory(policy, fits[0]?.fit.category?.key);
  const partsStatus = job.jobParts.some((part) => part.status === "NEEDED") ? "NEEDED" : job.jobParts.length ? "READY" : "NONE";

  const candidates: SmartDispatchCandidate[] = [];
  for (const row of fits) {
    const location = locationByTech.get(row.membership.userId)!;
    const techDayJobs = dayJobs.filter((item) => item.assignments.some((assignment) => assignment.userId === row.membership.userId));
    const conflict = job.scheduledStart
      ? Boolean(
          findScheduleConflict(
            techDayJobs.map((item) => ({
              id: item.id,
              scheduledStart: item.scheduledStart,
              scheduledEnd: item.scheduledEnd,
              status: item.status,
            })),
            {
              id: job.id,
              scheduledStart: job.scheduledStart,
              scheduledEnd: job.scheduledEnd,
              status: job.status,
            }
          )
        )
      : false;

    const driveSeconds = driveByTech.get(row.membership.userId) ?? null;
    const nextJob = techDayJobs
      .filter((item) => item.scheduledStart && item.scheduledStart > (job.scheduledStart ?? now))
      .sort((a, b) => a.scheduledStart!.getTime() - b.scheduledStart!.getTime())[0];
    const arrivalAt = driveSeconds != null ? new Date(now.getTime() + driveSeconds * 1000) : null;
    const windowEnd = job.arrivalWindowEnd ?? job.scheduledEnd ?? null;
    const canMakeWindow = !windowEnd || !arrivalAt || arrivalAt <= windowEnd;
    const nextImpact =
      nextJob?.scheduledStart && arrivalAt && job.scheduledEnd
        ? Math.round((new Date(job.scheduledEnd).getTime() + (driveSeconds ?? 0) * 1000 - nextJob.scheduledStart.getTime()) / 60000)
        : nextJob && driveSeconds != null
          ? Math.round(driveSeconds / 60) - 20
          : null;
    const jeopardizesNext = Boolean(nextImpact && nextImpact > 0);
    const infeasible = conflict || (!canMakeWindow && Boolean(windowEnd));

    const reasons: Array<{ code: string; label: string; kind: string }> = [...row.fit.reasons];
    if (driveSeconds != null && location.freshness !== "UNAVAILABLE") {
      reasons.push({
        code: "DRIVE_TIME_FIT",
        label: driveLabel(driveSeconds, location.freshness) || `${minutesFromSeconds(driveSeconds)} min drive`,
        kind: "POSITIVE",
      });
    }
    if (!jeopardizesNext && canMakeWindow && !conflict) {
      reasons.push({
        code: "NEXT_APPOINTMENT_PROTECTED",
        label: "Next appointment protected",
        kind: "POSITIVE",
      });
    }
    if (jeopardizesNext) {
      reasons.push({
        code: "ROUTE_IMPACT",
        label: `Assignment adds ${nextImpact} min risk to the next promised appointment`,
        kind: "WARNING",
      });
    }
    if (infeasible && conflict) {
      reasons.push({
        code: "SCHEDULE_CONFLICT",
        label: "Schedule conflict — already booked in this window",
        kind: "BLOCKER",
      });
    }
    if (infeasible && !conflict) {
      reasons.push({
        code: "APPOINTMENT_WINDOW",
        label: "Cannot reach job inside promised window",
        kind: "BLOCKER",
      });
    }

    const eligible = row.fit.eligible && !infeasible;
    const components = {
      skillFit: skillFitScore(row.fit.ownerEvaluation.skillRating),
      historicalPerformance: historicalPerformanceScore({
        firstTimeCompletionRate: row.fit.historicalPerformance.firstTimeCompletionRate,
        callbackRate: row.fit.historicalPerformance.callbackRate,
        completedJobs: row.fit.historicalPerformance.completedJobs,
        confidence: row.fit.historicalPerformance.confidence as "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH",
      }),
      familiarity: familiarityScore(row.fit.familiarity),
      driveTime: driveTimeScore(driveSeconds, location.confidence),
      routeImpact: routeImpactScore(nextImpact),
      scheduleFit: scheduleFitScore({ canMakeWindow, jeopardizesNext, conflict }),
      workload: workloadScore(techDayJobs.length),
      partsReadiness: partsReadinessScore(partsStatus),
    };
    const score = eligible
      ? combineScore(components, weights, row.fit.historicalPerformance.confidence as "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH")
      : null;

    const profileNeedsSetup = !row.fit.ownerEvaluation.skillRating && row.fit.historicalPerformance.completedJobs === 0;
    candidates.push({
      technicianId: row.membership.userId,
      name: row.name,
      eligible,
      infeasible,
      profileNeedsSetup,
      limitedMatchData: row.fit.historicalPerformance.confidence === "INSUFFICIENT",
      score,
      driveSeconds,
      driveMinutes: minutesFromSeconds(driveSeconds),
      driveLabel: driveLabel(driveSeconds, location.freshness),
      locationLabel: location.label,
      locationFreshness: location.freshness,
      nextJobImpactMinutes: nextImpact,
      reasons: reasons.map((reason) => ({ code: reason.code, label: reason.label, kind: reason.kind })),
      blockers: reasons.filter((reason) => reason.kind === "BLOCKER").map((reason) => ({ code: reason.code, label: reason.label })),
      recommended: false,
    });
  }

  const ranked = candidates.filter((row) => row.eligible && row.score).sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
  if (ranked[0]) ranked[0].recommended = true;
  const ineligible = candidates.filter((row) => !row.eligible);

  if (input.persist !== false) {
    await prisma.smartDispatchRecommendation.create({
      data: {
        companyId: input.companyId,
        jobId: job.id,
        recommendedTechnicianId: ranked[0]?.technicianId ?? null,
        recommendedScore: ranked[0]?.score?.total ?? null,
        candidateJson: ranked.slice(0, 8).map((row) => ({
          technicianId: row.technicianId,
          score: row.score?.total ?? null,
          reasons: row.reasons.map((reason) => reason.code),
        })),
        reasonCodes: ranked[0]?.reasons.map((reason) => reason.code) ?? [],
      },
    });
    await recordSmartDispatchEvent({
      companyId: input.companyId,
      kind: SMART_DISPATCH_EVENTS.RECOMMENDATION_CREATED,
      jobId: job.id,
      technicianId: ranked[0]?.technicianId,
      payload: { score: ranked[0]?.score?.total ?? null },
    });
  }

  return {
    jobId: job.id,
    routingAvailable: routingStatus === "OK",
    routingStatus,
    best: ranked[0] ?? null,
    candidates: ranked,
    ineligible,
  };
}

export async function recordAssignmentDecision(input: {
  companyId: string;
  jobId: string;
  actorId: string;
  assignedTechnicianId: string | null;
  recommendedTechnicianId?: string | null;
}) {
  const overridden =
    Boolean(input.recommendedTechnicianId) &&
    input.assignedTechnicianId !== input.recommendedTechnicianId;
  await prisma.smartDispatchRecommendation.updateMany({
    where: { companyId: input.companyId, jobId: input.jobId, dispatcherDecision: null },
    data: {
      dispatcherDecision: overridden ? "OVERRIDDEN" : "ACCEPTED",
      assignedTechnicianId: input.assignedTechnicianId,
      actorId: input.actorId,
    },
  });
  await recordSmartDispatchEvent({
    companyId: input.companyId,
    kind: overridden ? SMART_DISPATCH_EVENTS.RECOMMENDATION_OVERRIDDEN : SMART_DISPATCH_EVENTS.ASSIGNMENT_ACCEPTED,
    jobId: input.jobId,
    technicianId: input.assignedTechnicianId,
    payload: { recommendedTechnicianId: input.recommendedTechnicianId ?? null },
  });
}
