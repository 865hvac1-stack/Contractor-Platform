"use server";

import { createJobAction } from "@/server/actions/jobs";
import type { ActionResult } from "@/server/actions/auth";

function toIsoOrEmpty(localValue: string): string {
  if (!localValue.trim()) return "";
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

/** Converts datetime-local values to ISO before createJobAction / zod.datetime(). */
export async function createJobFormAction(
  prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const start = String(formData.get("scheduledStart") || "");
  const end = String(formData.get("scheduledEnd") || "");
  formData.set("scheduledStart", toIsoOrEmpty(start));
  formData.set("scheduledEnd", toIsoOrEmpty(end));
  return createJobAction(prev, formData);
}
