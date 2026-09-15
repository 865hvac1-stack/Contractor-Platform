import { mapsBrowserConfigured, mapsServerConfigured } from "@/lib/maps/keys";
import { googleGeocodingProvider, type GeocodingProvider } from "@/lib/maps/geocoding";
import { googleMapsRoutingProvider, type RoutingMatrixProvider } from "@/lib/maps/routing";
import type { MapProviderCapability } from "@/lib/maps/types";

export type MapStack = {
  geocoding: GeocodingProvider;
  routing: RoutingMatrixProvider;
  capabilities: () => MapProviderCapability;
};

export function googleMapStack(): MapStack {
  const geocoding = googleGeocodingProvider();
  const routing = googleMapsRoutingProvider();
  return {
    geocoding,
    routing,
    capabilities: () => ({
      mapsJavaScript: mapsBrowserConfigured(),
      geocoding: geocoding.configured(),
      routes: routing.configured(),
      routeOptimization: routing.configured(),
    }),
  };
}

export function mapsCapabilitySnapshot(): MapProviderCapability {
  return {
    mapsJavaScript: mapsBrowserConfigured(),
    geocoding: mapsServerConfigured(),
    routes: mapsServerConfigured(),
    routeOptimization: mapsServerConfigured(),
  };
}
