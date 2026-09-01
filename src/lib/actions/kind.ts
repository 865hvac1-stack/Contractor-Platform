import type { AskKind } from "@/lib/actions/types";

export function kindLabel(kind?: string | null) {
  switch (kind) {
    case "INSIGHT":
      return "Insight";
    case "DRAFT":
      return "Draft";
    case "ACTION_REQUIRES_APPROVAL":
      return "Action requires approval";
    case "ACTION_COMPLETED":
      return "Action completed";
    case "ACTION_FAILED":
      return "Action failed";
    default:
      return "Answer";
  }
}

export function kindFromRequest(status?: string | null): AskKind {
  if (status === "COMPLETED") return "ACTION_COMPLETED";
  if (status === "PARTIALLY_COMPLETED") return "ACTION_COMPLETED";
  if (status === "FAILED") return "ACTION_FAILED";
  if (status === "AWAITING_APPROVAL" || status === "APPROVED" || status === "DRAFT") return "ACTION_REQUIRES_APPROVAL";
  return "ANSWER";
}
