import { mapsServerKey } from "@/lib/maps/keys";
import type { GeocodeFailure, GeocodeResult } from "@/lib/maps/types";

export type GeocodingProvider = {
  name: string;
  configured: () => boolean;
  geocodeAddress: (address: string) => Promise<GeocodeResult | GeocodeFailure>;
};

export function googleGeocodingProvider(): GeocodingProvider {
  return {
    name: "google_geocoding",
    configured: () => Boolean(mapsServerKey()),
    async geocodeAddress(address) {
      const key = mapsServerKey();
      if (!key) {
        return { ok: false, error: "Geocoding is not configured.", status: "NOT_CONFIGURED", provider: "google_geocoding" };
      }
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}` +
        `&key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return {
          ok: false,
          error: `Geocoding provider rejected the request (${response.status}).`,
          status: "HTTP_ERROR",
          provider: "google_geocoding",
        };
      }
      const data = (await response.json()) as {
        status: string;
        error_message?: string;
        results?: Array<{
          formatted_address?: string;
          place_id?: string;
          geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
        }>;
      };
      const first = data.results?.[0];
      const lat = first?.geometry?.location?.lat;
      const lng = first?.geometry?.location?.lng;
      if (data.status !== "OK" || !first || lat == null || lng == null) {
        return {
          ok: false,
          error: data.error_message || `Geocoding returned ${data.status}.`,
          status: data.status || "ZERO_RESULTS",
          provider: "google_geocoding",
        };
      }
      const locationType = first.geometry?.location_type;
      const confidence =
        locationType === "ROOFTOP" ||
        locationType === "RANGE_INTERPOLATED" ||
        locationType === "GEOMETRIC_CENTER" ||
        locationType === "APPROXIMATE"
          ? locationType
          : "UNKNOWN";
      return {
        ok: true,
        lat,
        lng,
        formattedAddress: first.formatted_address ?? null,
        placeId: first.place_id ?? null,
        confidence,
        provider: "google_geocoding",
      };
    },
  };
}
