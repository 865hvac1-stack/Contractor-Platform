export const LOCATION_FRESHNESS = {
  liveMs: 2 * 60_000,
  recentMs: 10 * 60_000,
  staleMs: 45 * 60_000,
} as const;

export type LocationFreshness = "LIVE" | "RECENT" | "STALE" | "UNAVAILABLE";

export type LocationSource = "DEVICE" | "CURRENT_JOB" | "START_LOCATION" | "LAST_KNOWN";

export function locationFreshness(capturedAt: Date | string | null | undefined, now = new Date()): LocationFreshness {
  if (!capturedAt) return "UNAVAILABLE";
  const age = now.getTime() - new Date(capturedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return "UNAVAILABLE";
  if (age <= LOCATION_FRESHNESS.liveMs) return "LIVE";
  if (age <= LOCATION_FRESHNESS.recentMs) return "RECENT";
  if (age <= LOCATION_FRESHNESS.staleMs) return "STALE";
  return "UNAVAILABLE";
}

export function locationFreshnessLabel(input: {
  freshness: LocationFreshness;
  capturedAt?: Date | string | null;
  source?: LocationSource | null;
  now?: Date;
}) {
  if (input.freshness === "UNAVAILABLE") return "No current location";
  const captured = input.capturedAt ? new Date(input.capturedAt) : null;
  const ageMs = captured ? Math.max(0, (input.now ?? new Date()).getTime() - captured.getTime()) : 0;
  const age =
    ageMs < 60_000
      ? `${Math.max(1, Math.round(ageMs / 1000))} sec ago`
      : `${Math.max(1, Math.round(ageMs / 60_000))} min ago`;
  if (input.source === "CURRENT_JOB") return `Estimated from current job location · ${age}`;
  if (input.source === "START_LOCATION") return `Estimated from start location · ${age}`;
  if (input.freshness === "LIVE") return `Live · ${age}`;
  if (input.freshness === "RECENT") return `Recent · ${age}`;
  return `Stale · ${age}`;
}

export function locationConfidenceWeight(freshness: LocationFreshness) {
  if (freshness === "LIVE") return 1;
  if (freshness === "RECENT") return 0.7;
  if (freshness === "STALE") return 0.25;
  return 0;
}
