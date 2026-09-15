import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { geocodePropertyIfNeeded, invalidatePropertyGeocode } from "@/lib/maps/geocode-property";
import { googleGeocodingProvider } from "@/lib/maps/geocoding";
import { RoutingNotConfiguredError } from "@/lib/routing/provider";
import { googleMapsRoutingProvider } from "@/lib/maps/routing";

const prisma = new PrismaClient();

describe("geocoding cache", () => {
  const stamp = Date.now();
  let companyId = "";
  let propertyId = "";

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { businessName: `Geo ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    companyId = company.id;
    const customer = await prisma.customer.create({
      data: {
        companyId,
        firstName: "Geo",
        lastName: "House",
      },
    });
    const property = await prisma.property.create({
      data: {
        companyId,
        customerId: customer.id,
        address: "100 Main St",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
      },
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("stores a successful geocode and reuses coordinates without a second provider call", async () => {
    let calls = 0;
    const provider = {
      name: "mock",
      configured: () => true,
      async geocodeAddress() {
        calls += 1;
        return {
          ok: true as const,
          lat: 35.96,
          lng: -83.92,
          formattedAddress: "100 Main St, Knoxville, TN 37902",
          placeId: "place-1",
          confidence: "ROOFTOP" as const,
          provider: "mock",
        };
      },
    };
    const first = await geocodePropertyIfNeeded({ companyId, propertyId, provider });
    const second = await geocodePropertyIfNeeded({ companyId, propertyId, provider });
    expect(first.status).toBe("OK");
    expect(second.status).toBe("CACHED");
    expect(calls).toBe(1);
  });

  it("records geocode failure without guessing coordinates", async () => {
    const property = await prisma.property.create({
      data: {
        companyId,
        customerId: (await prisma.customer.findFirstOrThrow({ where: { companyId } })).id,
        address: "Unknown Place",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
      },
    });
    const result = await geocodePropertyIfNeeded({
      companyId,
      propertyId: property.id,
      provider: {
        name: "mock",
        configured: () => true,
        async geocodeAddress() {
          return { ok: false as const, error: "ZERO_RESULTS", status: "ZERO_RESULTS", provider: "mock" };
        },
      },
    });
    const stored = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(result.status).toBe("FAILED");
    expect(stored.latitude).toBeNull();
    expect(stored.longitude).toBeNull();
    expect(stored.geocodingStatus).toBe("FAILED");
  });

  it("invalidates geocode when the operational address changes", () => {
    expect(invalidatePropertyGeocode("100 Main St Knoxville TN 37902", "200 Main St Knoxville TN 37902")).toBe(true);
    expect(invalidatePropertyGeocode("100 Main St Knoxville TN 37902", "100 Main St Knoxville TN 37902")).toBe(false);
  });
});

describe("routing provider failure", () => {
  it("does not pretend Google is configured when the server key is missing", async () => {
    const previous = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    const legacy = process.env.GOOGLE_MAPS_API_KEY;
    const routes = process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    const provider = googleMapsRoutingProvider();
    expect(provider.configured()).toBe(false);
    await expect(
      provider.calculateDriveTime({ origin: "A", destination: "B" })
    ).rejects.toBeInstanceOf(RoutingNotConfiguredError);
    if (previous) process.env.GOOGLE_MAPS_SERVER_API_KEY = previous;
    if (legacy) process.env.GOOGLE_MAPS_API_KEY = legacy;
    if (routes) process.env.GOOGLE_ROUTES_API_KEY = routes;
    expect(googleGeocodingProvider().name).toBe("google_geocoding");
  });
});
