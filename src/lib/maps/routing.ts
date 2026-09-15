import { mapsServerKey } from "@/lib/maps/keys";
import type { DriveTimeResult, LatLng } from "@/lib/maps/types";
import {
  googleRoutingProvider,
  RoutingNotConfiguredError,
  type RoutingProvider,
} from "@/lib/routing/provider";

export type RoutingMatrixProvider = RoutingProvider & {
  calculateDriveTime: (input: {
    origin: LatLng | string;
    destination: LatLng | string;
    trafficAware?: boolean;
  }) => Promise<DriveTimeResult>;
  calculateRouteMatrix: (input: {
    origins: Array<{ key: string; point: LatLng | string }>;
    destinations: Array<{ key: string; point: LatLng | string }>;
    trafficAware?: boolean;
  }) => Promise<DriveTimeResult[]>;
};

export function pointKey(point: LatLng | string) {
  if (typeof point === "string") return `addr:${point.trim().toLowerCase()}`;
  return `ll:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
}

function pointParam(point: LatLng | string) {
  return typeof point === "string" ? point : `${point.lat},${point.lng}`;
}

export function googleMapsRoutingProvider(): RoutingMatrixProvider {
  const base = googleRoutingProvider();
  return {
    ...base,
    name: "google_maps",
    async calculateDriveTime(input) {
      const rows = await this.calculateRouteMatrix({
        origins: [{ key: pointKey(input.origin), point: input.origin }],
        destinations: [{ key: pointKey(input.destination), point: input.destination }],
        trafficAware: input.trafficAware,
      });
      if (!rows[0]) {
        throw new Error("Routing matrix returned no drive time.");
      }
      return rows[0];
    },
    async calculateRouteMatrix(input) {
      const key = mapsServerKey();
      if (!key) throw new RoutingNotConfiguredError();
      if (!input.origins.length || !input.destinations.length) return [];

      const originList = input.origins.map((origin) => pointParam(origin.point));
      const destList = input.destinations.map((dest) => pointParam(dest.point));
      const url =
        `https://maps.googleapis.com/maps/api/distancematrix/json` +
        `?origins=${encodeURIComponent(originList.join("|"))}` +
        `&destinations=${encodeURIComponent(destList.join("|"))}` +
        `&units=imperial` +
        (input.trafficAware ? `&departure_time=now` : "") +
        `&key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Routing matrix rejected the request (${response.status}).`);
      }
      const data = (await response.json()) as {
        status: string;
        error_message?: string;
        rows?: Array<{
          elements?: Array<{
            status?: string;
            duration?: { value?: number };
            duration_in_traffic?: { value?: number };
            distance?: { value?: number };
          }>;
        }>;
      };
      if (data.status !== "OK") {
        throw new Error(data.error_message || `Routing matrix returned ${data.status}.`);
      }

      const trafficAware = Boolean(input.trafficAware);
      const results: DriveTimeResult[] = [];
      input.origins.forEach((origin, oi) => {
        input.destinations.forEach((dest, di) => {
          const element = data.rows?.[oi]?.elements?.[di];
          if (!element || element.status !== "OK") return;
          results.push({
            originKey: origin.key,
            destKey: dest.key,
            durationSeconds: element.duration_in_traffic?.value ?? element.duration?.value ?? 0,
            distanceMeters: element.distance?.value ?? 0,
            provider: "google_distance_matrix",
            trafficAware,
          });
        });
      });
      return results;
    },
  };
}
