import { prisma } from "@/lib/db";
import { googleMapsRoutingProvider, type RoutingMatrixProvider } from "@/lib/maps/routing";
import type { DriveTimeResult, LatLng } from "@/lib/maps/types";
import { RoutingNotConfiguredError } from "@/lib/routing/provider";

const MATRIX_TTL_MS = 8 * 60_000;

export async function cachedRouteMatrix(input: {
  companyId: string;
  origins: Array<{ key: string; point: LatLng | string }>;
  destinations: Array<{ key: string; point: LatLng | string }>;
  trafficAware?: boolean;
  provider?: RoutingMatrixProvider;
}) {
  const provider = input.provider ?? googleMapsRoutingProvider();
  const trafficAware = Boolean(input.trafficAware);
  const results: DriveTimeResult[] = [];
  const missingOrigins: typeof input.origins = [];
  const missingDest = new Map<string, { key: string; point: LatLng | string }>();

  for (const origin of input.origins) {
    let originMissing = false;
    for (const dest of input.destinations) {
      const cached = await prisma.routeMatrixCache.findUnique({
        where: {
          companyId_originKey_destKey_trafficAware: {
            companyId: input.companyId,
            originKey: origin.key,
            destKey: dest.key,
            trafficAware,
          },
        },
      });
      if (cached && Date.now() - cached.computedAt.getTime() < MATRIX_TTL_MS) {
        results.push({
          originKey: origin.key,
          destKey: dest.key,
          durationSeconds: cached.durationSeconds,
          distanceMeters: cached.distanceMeters,
          provider: cached.provider,
          trafficAware,
        });
      } else {
        originMissing = true;
        missingDest.set(dest.key, dest);
      }
    }
    if (originMissing) missingOrigins.push(origin);
  }

  if (!missingOrigins.length) {
    return { rows: results, cached: true as const, configured: provider.configured() };
  }
  if (!provider.configured()) {
    return { rows: results, cached: false as const, configured: false, error: "ROUTING_TEMPORARILY_UNAVAILABLE" };
  }

  try {
    const fetched = await provider.calculateRouteMatrix({
      origins: missingOrigins,
      destinations: [...missingDest.values()],
      trafficAware,
    });
    for (const row of fetched) {
      await prisma.routeMatrixCache.upsert({
        where: {
          companyId_originKey_destKey_trafficAware: {
            companyId: input.companyId,
            originKey: row.originKey,
            destKey: row.destKey,
            trafficAware: row.trafficAware,
          },
        },
        update: {
          durationSeconds: row.durationSeconds,
          distanceMeters: row.distanceMeters,
          provider: row.provider,
          computedAt: new Date(),
        },
        create: {
          companyId: input.companyId,
          originKey: row.originKey,
          destKey: row.destKey,
          durationSeconds: row.durationSeconds,
          distanceMeters: row.distanceMeters,
          provider: row.provider,
          trafficAware: row.trafficAware,
        },
      });
      results.push(row);
    }
    return { rows: results, cached: false as const, configured: true };
  } catch (error) {
    if (error instanceof RoutingNotConfiguredError) {
      return { rows: results, cached: false as const, configured: false, error: "ROUTING_TEMPORARILY_UNAVAILABLE" };
    }
    return {
      rows: results,
      cached: false as const,
      configured: true,
      error: "ROUTING_TEMPORARILY_UNAVAILABLE",
    };
  }
}
