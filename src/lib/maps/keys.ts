export function mapsServerKey() {
  return (
    process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_ROUTES_API_KEY?.trim() ||
    ""
  );
}

export function mapsBrowserKey() {
  return process.env.GOOGLE_MAPS_BROWSER_API_KEY?.trim() || "";
}

export function mapsServerConfigured() {
  return Boolean(mapsServerKey());
}

export function mapsBrowserConfigured() {
  return Boolean(mapsBrowserKey());
}

export function assertNoServerKeyLeak(haystack: string) {
  const key = mapsServerKey();
  if (!key) return true;
  return !haystack.includes(key);
}
