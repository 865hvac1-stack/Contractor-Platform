import type { DataConfidence } from "@/lib/technician-intelligence/core";
import type { DispatchScoreWeights } from "@/lib/smart-dispatch/policy";

export type ScoreComponents = {
  skillFit: number | null;
  historicalPerformance: number | null;
  familiarity: number | null;
  driveTime: number | null;
  routeImpact: number | null;
  scheduleFit: number | null;
  workload: number | null;
  partsReadiness: number | null;
};

export type RankedScore = {
  total: number;
  display: string;
  confidence: DataConfidence;
  components: ScoreComponents;
};

const CONFIDENCE_DAMPING: Record<DataConfidence, number> = {
  INSUFFICIENT: 0.3,
  LOW: 0.55,
  MEDIUM: 0.85,
  HIGH: 1,
};

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function skillFitScore(rating: number | null) {
  if (rating == null) return null;
  return clampScore((rating / 5) * 100);
}

export function historicalPerformanceScore(input: {
  firstTimeCompletionRate: number | null;
  callbackRate: number | null;
  completedJobs: number;
  confidence: DataConfidence;
}) {
  if (!input.completedJobs) return null;
  const firstTime = input.firstTimeCompletionRate ?? 70;
  const callbackPenalty = input.callbackRate ?? 8;
  const raw = firstTime * 0.75 + Math.max(0, 20 - callbackPenalty) * 1.25;
  return clampScore(raw * CONFIDENCE_DAMPING[input.confidence]);
}

export function familiarityScore(input: { customerVisits: number; propertyVisits: number; equipmentVisits: number }) {
  if (!input.customerVisits && !input.propertyVisits && !input.equipmentVisits) return null;
  return clampScore(
    Math.min(40, input.customerVisits * 12) +
      Math.min(30, input.propertyVisits * 15) +
      Math.min(30, input.equipmentVisits * 20)
  );
}

export function driveTimeScore(durationSeconds: number | null, confidenceWeight = 1) {
  if (durationSeconds == null || confidenceWeight <= 0) return null;
  const minutes = durationSeconds / 60;
  return clampScore((100 - minutes * (100 / 60)) * confidenceWeight);
}

export function routeImpactScore(extraMinutes: number | null) {
  if (extraMinutes == null) return null;
  if (extraMinutes <= 0) return 100;
  return clampScore(100 - extraMinutes * 2.2);
}

export function scheduleFitScore(input: { canMakeWindow: boolean; jeopardizesNext: boolean; conflict: boolean }) {
  if (input.conflict) return 0;
  if (!input.canMakeWindow) return 8;
  if (input.jeopardizesNext) return 28;
  return 96;
}

export function workloadScore(jobCount: number) {
  return clampScore(100 - jobCount * 12);
}

export function partsReadinessScore(status: "NONE" | "READY" | "RESERVED" | "NEEDED" | "NOT_AVAILABLE" | null, thisTechHasPart?: boolean) {
  if (!status || status === "NONE") return 70;
  if (status === "READY" || status === "RESERVED") return thisTechHasPart === false ? 35 : 90;
  if (status === "NOT_AVAILABLE") return 20;
  return 45;
}

export function combineScore(components: ScoreComponents, weights: DispatchScoreWeights, confidence: DataConfidence): RankedScore {
  let weighted = 0;
  let totalWeight = 0;
  (Object.keys(weights) as Array<keyof DispatchScoreWeights>).forEach((key) => {
    const value = components[key];
    const weight = weights[key];
    if (value == null || !weight) return;
    weighted += value * weight;
    totalWeight += weight;
  });
  const total = totalWeight ? clampScore(weighted / totalWeight) : 0;
  return {
    total,
    display: `${total}%`,
    confidence,
    components,
  };
}

export function pickSmarterMatch<T extends { score: number; driveMinutes: number | null }>(left: T, right: T) {
  if (Math.abs(left.score - right.score) >= 3) return left.score >= right.score ? left : right;
  if (left.driveMinutes != null && right.driveMinutes != null && left.driveMinutes !== right.driveMinutes) {
    return left.score >= right.score ? left : right;
  }
  return left.score >= right.score ? left : right;
}
