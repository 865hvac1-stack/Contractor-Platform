const windows = new Map<string, number[]>();

export function checkIntelligenceRateLimit(key: string, limit = 20, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const prior = (windows.get(key) ?? []).filter((at) => now - at < windowMs);
  if (prior.length >= limit) {
    return {
      ok: false as const,
      error: "That's a lot of questions in a short time. Wait a few minutes and ask again.",
    };
  }
  prior.push(now);
  windows.set(key, prior);
  return { ok: true as const };
}
