import { prisma } from "@/lib/db";
import {
  locationConfidenceWeight,
  locationFreshness,
  locationFreshnessLabel,
  type LocationFreshness,
  type LocationSource,
} from "@/lib/maps/freshness";
import type { LatLng } from "@/lib/maps/types";

export type ResolvedTechnicianLocation = {
  technicianId: string;
  point: LatLng | null;
  freshness: LocationFreshness;
  source: LocationSource | null;
  capturedAt: Date | null;
  label: string;
  confidence: number;
};

export async function recordTechnicianDeviceLocation(input: {
  companyId: string;
  technicianId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  heading?: number | null;
  speedMetersPerSecond?: number | null;
  capturedAt: Date;
}) {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    throw new Error("Invalid coordinates.");
  }
  if (Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) {
    throw new Error("Invalid coordinates.");
  }
  return prisma.technicianLocation.upsert({
    where: { companyId_technicianId: { companyId: input.companyId, technicianId: input.technicianId } },
    update: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
      heading: input.heading ?? null,
      speedMetersPerSecond: input.speedMetersPerSecond ?? null,
      capturedAt: input.capturedAt,
      receivedAt: new Date(),
      source: "DEVICE",
    },
    create: {
      companyId: input.companyId,
      technicianId: input.technicianId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
      heading: input.heading ?? null,
      speedMetersPerSecond: input.speedMetersPerSecond ?? null,
      capturedAt: input.capturedAt,
      source: "DEVICE",
    },
  });
}

export async function resolveTechnicianLocation(input: {
  companyId: string;
  technicianId: string;
  now?: Date;
}): Promise<ResolvedTechnicianLocation> {
  const now = input.now ?? new Date();
  const ping = await prisma.technicianLocation.findUnique({
    where: { companyId_technicianId: { companyId: input.companyId, technicianId: input.technicianId } },
  });
  if (ping) {
    const freshness = locationFreshness(ping.capturedAt, now);
    if (freshness !== "UNAVAILABLE") {
      const source: LocationSource = ping.source === "DEVICE" ? "DEVICE" : "LAST_KNOWN";
      return {
        technicianId: input.technicianId,
        point: { lat: ping.latitude, lng: ping.longitude },
        freshness,
        source,
        capturedAt: ping.capturedAt,
        label: locationFreshnessLabel({ freshness, capturedAt: ping.capturedAt, source, now }),
        confidence: locationConfidenceWeight(freshness),
      };
    }
  }

  const currentJob = await prisma.job.findFirst({
    where: {
      companyId: input.companyId,
      status: { in: ["DISPATCHED", "IN_PROGRESS"] },
      assignments: { some: { userId: input.technicianId } },
    },
    include: { property: { select: { latitude: true, longitude: true } } },
    orderBy: { scheduledStart: "asc" },
  });
  if (currentJob?.property.latitude != null && currentJob.property.longitude != null) {
    return {
      technicianId: input.technicianId,
      point: { lat: currentJob.property.latitude, lng: currentJob.property.longitude },
      freshness: "RECENT",
      source: "CURRENT_JOB",
      capturedAt: currentJob.checkedInAt ?? currentJob.scheduledStart ?? now,
      label: locationFreshnessLabel({
        freshness: "RECENT",
        capturedAt: currentJob.checkedInAt ?? currentJob.scheduledStart ?? now,
        source: "CURRENT_JOB",
        now,
      }),
      confidence: 0.45,
    };
  }

  return {
    technicianId: input.technicianId,
    point: null,
    freshness: "UNAVAILABLE",
    source: null,
    capturedAt: ping?.capturedAt ?? null,
    label: ping ? `Last location too stale to use` : "LOCATION UNAVAILABLE",
    confidence: 0,
  };
}
