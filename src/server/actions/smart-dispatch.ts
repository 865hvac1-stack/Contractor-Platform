"use server";

import { AuthError } from "@/lib/auth";
import { recommendTechniciansForJob } from "@/lib/smart-dispatch/recommend";
import { previewDayOptimization } from "@/lib/smart-dispatch/exceptions";
import { requirePermission } from "@/lib/tenant";
import { geocodePropertyIfNeeded } from "@/lib/maps/geocode-property";
import { recordTechnicianDeviceLocation } from "@/lib/maps/technician-location";
import type { ActionResult } from "@/server/actions/auth";

export async function previewSmartAssignmentAction(input: { jobId: string; technicianUserId?: string | null }) {
  try {
    const ctx = await requirePermission("schedule:view");
    const match = await recommendTechniciansForJob({
      companyId: ctx.company.id,
      jobId: input.jobId,
      persist: false,
    });
    const focused =
      input.technicianUserId
        ? [...match.candidates, ...match.ineligible].find((row) => row.technicianId === input.technicianUserId) ?? null
        : match.best;
    return { ok: true as const, match, focused };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: error instanceof Error ? error.message : "Unable to preview assignment." };
  }
}

export async function retryPropertyGeocodeAction(propertyId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("customers:manage");
    const result = await geocodePropertyIfNeeded({
      companyId: ctx.company.id,
      propertyId,
      force: true,
    });
    if (result.status === "OK" || result.status === "CACHED") return { ok: true };
    if (result.status === "UNAVAILABLE") return { ok: false, error: "Geocoding is not configured." };
    return { ok: false, error: ("error" in result && result.error) || "LOCATION NEEDS REVIEW" };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Unable to geocode this property." };
  }
}

export async function pingTechnicianLocationAction(input: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  capturedAt?: string | null;
}): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:field_status");
    await recordTechnicianDeviceLocation({
      companyId: ctx.company.id,
      technicianId: ctx.user.id,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracy,
      heading: input.heading,
      speedMetersPerSecond: input.speed,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not save location." };
  }
}

export async function previewDayOptimizationAction() {
  try {
    await requirePermission("routing:optimize");
    return { ok: true as const, ...(await previewDayOptimization()) };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "Unable to preview day optimization." };
  }
}
