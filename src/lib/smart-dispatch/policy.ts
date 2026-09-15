export type DispatchScoreWeights = {
  skillFit: number;
  historicalPerformance: number;
  familiarity: number;
  driveTime: number;
  routeImpact: number;
  scheduleFit: number;
  workload: number;
  partsReadiness: number;
};

export type DispatchPolicy = {
  minRouteSwapMinutes: number;
  minCapacityMinutes: number;
  minMatchDeltaToSurface: number;
  weights: Record<string, DispatchScoreWeights>;
};

export const DEFAULT_DISPATCH_WEIGHTS: DispatchScoreWeights = {
  skillFit: 22,
  historicalPerformance: 16,
  familiarity: 10,
  driveTime: 20,
  routeImpact: 12,
  scheduleFit: 12,
  workload: 4,
  partsReadiness: 4,
};

export const DEFAULT_DISPATCH_POLICY: DispatchPolicy = {
  minRouteSwapMinutes: 15,
  minCapacityMinutes: 45,
  minMatchDeltaToSurface: 8,
  weights: {
    DEFAULT: DEFAULT_DISPATCH_WEIGHTS,
    NO_COOLING: {
      skillFit: 20,
      historicalPerformance: 20,
      familiarity: 6,
      driveTime: 22,
      routeImpact: 10,
      scheduleFit: 16,
      workload: 2,
      partsReadiness: 4,
    },
    NO_HEATING: {
      skillFit: 20,
      historicalPerformance: 20,
      familiarity: 6,
      driveTime: 22,
      routeImpact: 10,
      scheduleFit: 16,
      workload: 2,
      partsReadiness: 4,
    },
    MAINTENANCE: {
      skillFit: 14,
      historicalPerformance: 12,
      familiarity: 8,
      driveTime: 16,
      routeImpact: 22,
      scheduleFit: 16,
      workload: 8,
      partsReadiness: 4,
    },
    INSTALL_CHANGEOUT: {
      skillFit: 24,
      historicalPerformance: 14,
      familiarity: 16,
      driveTime: 10,
      routeImpact: 12,
      scheduleFit: 14,
      workload: 6,
      partsReadiness: 4,
    },
    CALLBACK: {
      skillFit: 16,
      historicalPerformance: 18,
      familiarity: 28,
      driveTime: 12,
      routeImpact: 8,
      scheduleFit: 14,
      workload: 2,
      partsReadiness: 2,
    },
  },
};

export function weightsForCategory(policy: DispatchPolicy, categoryKey?: string | null): DispatchScoreWeights {
  if (categoryKey && policy.weights[categoryKey]) return policy.weights[categoryKey];
  return policy.weights.DEFAULT ?? DEFAULT_DISPATCH_WEIGHTS;
}

export function parseDispatchPolicy(value: unknown): DispatchPolicy {
  if (!value || typeof value !== "object") return DEFAULT_DISPATCH_POLICY;
  const raw = value as Partial<DispatchPolicy>;
  return {
    minRouteSwapMinutes: Number(raw.minRouteSwapMinutes) || DEFAULT_DISPATCH_POLICY.minRouteSwapMinutes,
    minCapacityMinutes: Number(raw.minCapacityMinutes) || DEFAULT_DISPATCH_POLICY.minCapacityMinutes,
    minMatchDeltaToSurface: Number(raw.minMatchDeltaToSurface) || DEFAULT_DISPATCH_POLICY.minMatchDeltaToSurface,
    weights: { ...DEFAULT_DISPATCH_POLICY.weights, ...(raw.weights ?? {}) },
  };
}
