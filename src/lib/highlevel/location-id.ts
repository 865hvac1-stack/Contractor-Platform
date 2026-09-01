/**
 * HighLevel location IDs are opaque provider account ids.
 * They must never be derived from emails or company profile fields.
 */
export function sanitizeHighLevelLocationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) return null;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(trimmed)) return null;
  return trimmed;
}

export function publicHighLevelConnectionView(input: {
  status?: string | null;
  externalAccountId?: string | null;
  accountLabel?: string | null;
  hasCredential?: boolean;
  companyEmail?: string | null;
  userEmail?: string | null;
}) {
  const stored = sanitizeHighLevelLocationId(input.externalAccountId);
  const companyEmail = input.companyEmail?.trim() || "";
  const userEmail = input.userEmail?.trim() || "";
  const polluted =
    !stored ||
    (companyEmail && stored.toLowerCase() === companyEmail.toLowerCase()) ||
    (userEmail && stored.toLowerCase() === userEmail.toLowerCase());

  return {
    locationId: polluted ? null : stored,
    locationName: input.accountLabel ?? null,
    tokenStored: Boolean(input.hasCredential),
    status: input.status ?? "NOT_CONNECTED",
  };
}
