export type RouteStop = {
  id: string;
  address: string;
};

export type RouteLeg = {
  fromId: string;
  toId: string;
  durationSeconds: number;
  distanceMeters: number;
};

export type RouteOptimizeResult = {
  provider: string;
  orderedIds: string[];
  durationSeconds: number;
  distanceMeters: number;
  legs: RouteLeg[];
  polyline: string | null;
  mapUrl: string | null;
};

export type RoutingProvider = {
  name: string;
  configured: () => boolean;
  optimize: (input: {
    origin: string;
    destination: string;
    stops: RouteStop[];
  }) => Promise<RouteOptimizeResult>;
};

export function routingApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || process.env.GOOGLE_ROUTES_API_KEY?.trim() || "";
}

export function routingConfigured() {
  return Boolean(routingApiKey());
}

export function googleRoutingProvider(): RoutingProvider {
  return {
    name: "google_directions",
    configured: routingConfigured,
    async optimize(input) {
      const key = routingApiKey();
      if (!key) {
        throw new RoutingNotConfiguredError();
      }
      if (input.stops.length === 0) {
        return {
          provider: "google_directions",
          orderedIds: [],
          durationSeconds: 0,
          distanceMeters: 0,
          legs: [],
          polyline: null,
          mapUrl: null,
        };
      }
      const waypoints = input.stops.map((stop) => encodeURIComponent(stop.address)).join("|");
      const optimizePrefix = input.stops.length > 1 ? "optimize:true|" : "";
      const url =
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${encodeURIComponent(input.origin)}` +
        `&destination=${encodeURIComponent(input.destination)}` +
        (input.stops.length
          ? `&waypoints=${optimizePrefix}${waypoints}`
          : "") +
        `&key=${key}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new RoutingProviderError(`Routing provider rejected the request (${response.status}).`);
      }
      const data = (await response.json()) as {
        status: string;
        error_message?: string;
        routes?: {
          overview_polyline?: { points?: string };
          waypoint_order?: number[];
          legs?: { duration?: { value?: number }; distance?: { value?: number } }[];
        }[];
      };
      if (data.status !== "OK" || !data.routes?.[0]) {
        throw new RoutingProviderError(data.error_message || `Routing provider returned ${data.status}.`);
      }
      const route = data.routes[0];
      const order = route.waypoint_order ?? input.stops.map((_, index) => index);
      const ordered = order.map((index) => input.stops[index]).filter(Boolean);
      const durationSeconds = (route.legs ?? []).reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
      const distanceMeters = (route.legs ?? []).reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
      const sequence = ["origin", ...ordered.map((stop) => stop.id), "destination"];
      const legs: RouteLeg[] = (route.legs ?? []).map((leg, index) => ({
        fromId: sequence[index] ?? "origin",
        toId: sequence[index + 1] ?? "destination",
        durationSeconds: leg.duration?.value ?? 0,
        distanceMeters: leg.distance?.value ?? 0,
      }));
      const path = [input.origin, ...ordered.map((stop) => stop.address), input.destination]
        .map((part) => encodeURIComponent(part))
        .join("/");
      return {
        provider: "google_directions",
        orderedIds: ordered.map((stop) => stop.id),
        durationSeconds,
        distanceMeters,
        legs,
        polyline: route.overview_polyline?.points ?? null,
        mapUrl: `https://www.google.com/maps/dir/${path}`,
      };
    },
  };
}

export class RoutingNotConfiguredError extends Error {
  constructor() {
    super("Route optimization is not configured. Set GOOGLE_MAPS_API_KEY on the server.");
    this.name = "RoutingNotConfiguredError";
  }
}

export class RoutingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingProviderError";
  }
}
