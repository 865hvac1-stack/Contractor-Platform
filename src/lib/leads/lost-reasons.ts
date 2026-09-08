/** Suggested lost reasons. Stored on the existing Lead.lostReason string. */
export const LEAD_LOST_REASONS = [
  "Price",
  "No response",
  "Competitor",
  "Not qualified",
  "Customer cancelled",
  "Duplicate",
  "Other",
] as const;

export function parseLostReason(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { preset: "", other: "" };
  if ((LEAD_LOST_REASONS as readonly string[]).includes(trimmed) && trimmed !== "Other") {
    return { preset: trimmed, other: "" };
  }
  return { preset: "Other", other: trimmed };
}
