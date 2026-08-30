export type TrendLabel = "RISING" | "DECLINING" | "STABLE" | "ANOMALOUS" | "INSUFFICIENT";

/**
 * Deterministic trend label. Never invent a direction from a tiny sample.
 */
export function classifyTrend(input: {
  current: number;
  previous: number;
  sampleSize: number;
  minSamples?: number;
  stableBand?: number;
  anomalyMultiple?: number;
}): TrendLabel {
  const minSamples = input.minSamples ?? 5;
  if (input.sampleSize < minSamples) return "INSUFFICIENT";
  if (input.previous === 0 && input.current === 0) return "STABLE";
  if (input.previous === 0) return input.current > 0 ? "RISING" : "INSUFFICIENT";

  const change = (input.current - input.previous) / Math.abs(input.previous);
  const band = input.stableBand ?? 0.08;
  const anomaly = input.anomalyMultiple ?? 2.5;

  if (Math.abs(change) >= anomaly) return "ANOMALOUS";
  if (change > band) return "RISING";
  if (change < -band) return "DECLINING";
  return "STABLE";
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
