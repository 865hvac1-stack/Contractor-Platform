import type { RemainingItem } from "@/lib/playbooks/engine";
import type { PlaybookStepDef } from "@/lib/playbooks/types";

export function fieldSectionForStep(step: PlaybookStepDef | RemainingItem | { actionKey?: string | null; kind?: string; title?: string }) {
  const key = "actionKey" in step ? step.actionKey ?? undefined : undefined;
  const kind = "kind" in step ? step.kind : undefined;
  const title = ("title" in step ? step.title ?? "" : "").toLowerCase();
  if (key === "ON_MY_WAY" || key === "ARRIVED") return "overview";
  if (key === "ESTIMATE" || title.includes("estimate") || title.includes("option")) return "options";
  if (key === "INVOICE" || key === "PAYMENT" || title.includes("invoice") || title.includes("payment")) return "invoice";
  if (key === "EQUIPMENT" || title.includes("equipment") || title.includes("serial") || title.includes("model"))
    return "equipment";
  if (key === "MEMBERSHIP" || title.includes("membership")) return "membership";
  if (kind === "PHOTO" || title.includes("photo")) return "photos";
  if (title.includes("approval") || title.includes("signature")) return "options";
  return "playbook";
}

export function fieldCtaForStep(step: PlaybookStepDef) {
  if (step.actionKey === "ON_MY_WAY") return "On my way";
  if (step.actionKey === "ARRIVED") return "Start job";
  if (step.actionKey === "ESTIMATE") return "Build options";
  if (step.actionKey === "INVOICE") return "Create invoice";
  if (step.actionKey === "PAYMENT") return "Collect payment";
  if (step.actionKey === "EQUIPMENT") return "Add equipment";
  if (step.actionKey === "MEMBERSHIP") return "Offer membership";
  if (step.kind === "PHOTO") return "Open camera";
  return "Complete step";
}

export function remainingHref(item: RemainingItem) {
  return `#${fieldSectionForStep(item)}`;
}
