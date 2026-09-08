const windows = new Map<string, number[]>();

export function checkAgentToolRateLimit(key: string, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const prior = (windows.get(key) ?? []).filter((at) => now - at < windowMs);
  if (prior.length >= limit) {
    return { ok: false as const };
  }
  prior.push(now);
  windows.set(key, prior);
  return { ok: true as const };
}

export function resetAgentToolRateLimit() {
  windows.clear();
}
