export type LatLng = { lat: number; lng: number };

export type GeocodeResult = {
  ok: true;
  lat: number;
  lng: number;
  formattedAddress: string | null;
  placeId: string | null;
  confidence: "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE" | "UNKNOWN";
  provider: string;
};

export type GeocodeFailure = {
  ok: false;
  error: string;
  status: string;
  provider: string;
};

export type DriveTimeResult = {
  originKey: string;
  destKey: string;
  durationSeconds: number;
  distanceMeters: number;
  provider: string;
  trafficAware: boolean;
};

export type MapProviderCapability = {
  mapsJavaScript: boolean;
  geocoding: boolean;
  routes: boolean;
  routeOptimization: boolean;
};
