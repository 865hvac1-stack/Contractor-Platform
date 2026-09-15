import { prisma } from "@/lib/db";
import { googleGeocodingProvider, type GeocodingProvider } from "@/lib/maps/geocoding";
import { propertyAddress } from "@/lib/tech/access";

const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

function addressFingerprint(property: { address: string; city: string; state: string; zip: string }) {
  return propertyAddress(property).trim().toLowerCase();
}

export async function geocodePropertyIfNeeded(input: {
  companyId: string;
  propertyId: string;
  force?: boolean;
  provider?: GeocodingProvider;
}) {
  const property = await prisma.property.findFirst({
    where: { id: input.propertyId, companyId: input.companyId },
  });
  if (!property) return { status: "MISSING_PROPERTY" as const };
  const address = addressFingerprint(property);
  if (!address) {
    await prisma.property.update({
      where: { id: property.id },
      data: {
        geocodingStatus: "NEEDS_REVIEW",
        geocodeError: "Address is incomplete.",
        lastGeocodeAttemptAt: new Date(),
      },
    });
    return { status: "NEEDS_REVIEW" as const, propertyId: property.id };
  }

  const hasCoords = property.latitude != null && property.longitude != null && property.geocodingStatus === "OK";
  if (hasCoords && !input.force) {
    return { status: "CACHED" as const, lat: property.latitude!, lng: property.longitude! };
  }
  if (
    !input.force &&
    property.geocodingStatus === "FAILED" &&
    property.lastGeocodeAttemptAt &&
    Date.now() - property.lastGeocodeAttemptAt.getTime() < RETRY_AFTER_MS
  ) {
    return { status: "FAILED" as const, error: property.geocodeError };
  }

  const provider = input.provider ?? googleGeocodingProvider();
  if (!provider.configured()) {
    return { status: "UNAVAILABLE" as const };
  }

  await prisma.property.update({
    where: { id: property.id },
    data: { geocodingStatus: "PENDING", lastGeocodeAttemptAt: new Date() },
  });
  const result = await provider.geocodeAddress(propertyAddress(property));
  if (!result.ok) {
    await prisma.property.update({
      where: { id: property.id },
      data: {
        geocodingStatus: "FAILED",
        geocodeError: result.error,
        lastGeocodeAttemptAt: new Date(),
        geocodingProvider: result.provider,
      },
    });
    return { status: "FAILED" as const, error: result.error };
  }

  await prisma.property.update({
    where: { id: property.id },
    data: {
      latitude: result.lat,
      longitude: result.lng,
      geocodingStatus: "OK",
      geocodedAt: new Date(),
      geocodingProvider: result.provider,
      geocodedFormattedAddress: result.formattedAddress,
      geocodingConfidence: result.confidence,
      geocodePlaceId: result.placeId,
      geocodeError: null,
      lastGeocodeAttemptAt: new Date(),
    },
  });
  return { status: "OK" as const, lat: result.lat, lng: result.lng };
}

export async function geocodeBoardProperties(input: {
  companyId: string;
  propertyIds: string[];
  limit?: number;
  provider?: GeocodingProvider;
}) {
  const limit = input.limit ?? 8;
  const properties = await prisma.property.findMany({
    where: {
      companyId: input.companyId,
      id: { in: input.propertyIds },
      OR: [
        { latitude: null },
        { longitude: null },
        { geocodingStatus: { in: ["NONE", "FAILED", "PENDING"] } },
      ],
    },
    select: { id: true },
    take: limit,
  });
  const results = [];
  for (const property of properties) {
    results.push(await geocodePropertyIfNeeded({ companyId: input.companyId, propertyId: property.id, provider: input.provider }));
  }
  return results;
}

export function invalidatePropertyGeocode(previous: string, next: string) {
  return previous.trim().toLowerCase() !== next.trim().toLowerCase();
}
