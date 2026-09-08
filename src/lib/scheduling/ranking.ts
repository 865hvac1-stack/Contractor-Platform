export type RankingComponents = {
  usedCapacityPercent: number;
  dayWorkload: number;
  stableTieBreak: number;
  routeScore?: number | null;
};

export type RankableOption = {
  technicianId: string;
  windowId: string;
  date: string;
  configuredCapacity: number;
  usedCapacity: number;
  remainingCapacity: number;
  dayWorkload: number;
};

export function rankingComponents(option: RankableOption): RankingComponents {
  const usedCapacityPercent =
    option.configuredCapacity <= 0 ? 100 : (option.usedCapacity / option.configuredCapacity) * 100;
  return {
    usedCapacityPercent,
    dayWorkload: option.dayWorkload,
    stableTieBreak: Number.parseInt(option.technicianId.replace(/\D/g, "").slice(-8) || "0", 10) || hashId(option.technicianId),
    routeScore: null,
  };
}

export function compareRanking(a: RankingComponents, b: RankingComponents) {
  if (a.usedCapacityPercent !== b.usedCapacityPercent) return a.usedCapacityPercent - b.usedCapacityPercent;
  if (a.dayWorkload !== b.dayWorkload) return a.dayWorkload - b.dayWorkload;
  const routeA = a.routeScore ?? Number.POSITIVE_INFINITY;
  const routeB = b.routeScore ?? Number.POSITIVE_INFINITY;
  if (routeA !== routeB) return routeA - routeB;
  return a.stableTieBreak - b.stableTieBreak;
}

export function rankEligibleOptions<T extends RankableOption>(options: T[]) {
  return [...options]
    .map((option) => ({ option, ranking: rankingComponents(option) }))
    .sort((a, b) => compareRanking(a.ranking, b.ranking));
}

function hashId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}
