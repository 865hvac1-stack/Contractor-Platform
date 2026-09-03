export type HighLevelClaimUserType = "Company" | "Location";

export type HighLevelTokenClaims = {
  userType: HighLevelClaimUserType | null;
  locationId: string | null;
  companyId: string | null;
  locationIdPresent: boolean;
  companyIdPresent: boolean;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || parts[0] === token) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asId(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length < 80 ? value.trim() : null;
}

function normalizeUserType(value: unknown): HighLevelClaimUserType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "company" || normalized === "agency") return "Company";
  if (normalized === "location") return "Location";
  return null;
}

/**
 * Read HighLevel OAuth JWT claims only. Never returns the token, signature, or raw JWT.
 */
export function inspectHighLevelTokenClaims(accessToken: string | undefined | null): HighLevelTokenClaims {
  const empty: HighLevelTokenClaims = {
    userType: null,
    locationId: null,
    companyId: null,
    locationIdPresent: false,
    companyIdPresent: false,
  };
  if (!accessToken) return empty;
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return empty;
  const meta = asObject(payload.oauthMeta) ?? {};
  const authClass = normalizeUserType(payload.authClass);
  const userType = normalizeUserType(meta.userType) ?? authClass;
  const locationId =
    asId(meta.locationId) ?? (userType === "Location" ? asId(payload.authClassId) : null);
  const companyId =
    asId(meta.companyId) ??
    asId(meta.agencyId) ??
    (userType === "Company" ? asId(payload.authClassId) : null) ??
    asId(payload.primaryAuthClassId);
  return {
    userType,
    locationId,
    companyId,
    locationIdPresent: Boolean(locationId),
    companyIdPresent: Boolean(companyId),
  };
}
