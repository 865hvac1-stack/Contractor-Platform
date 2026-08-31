"use client";

import { useState, useTransition } from "react";
import { applyRouteAction, previewRouteAction } from "@/server/actions/dispatch";

export function RouteOptimizePanel({
  technicianUserId,
  technicianName,
  dayIso,
}: {
  technicianUserId: string;
  technicianName: string;
  dayIso?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<null | {
    currentMinutes: number;
    suggestedMinutes: number;
    currentMiles: number;
    suggestedMiles: number;
    mapUrl: string | null;
    orderedIds: string[];
  }>(null);

  return (
    <div className="mt-2 space-y-2">
      <button
        type="button"
        className="h-8 w-full rounded-lg bg-[var(--muted)] text-[11px] font-semibold"
        disabled={pending}
        onClick={() => {
          start(async () => {
            setError(null);
            const result = await previewRouteAction(technicianUserId, dayIso);
            if (!result.ok) {
              setError(result.error);
              setPreview(null);
              return;
            }
            setPreview({
              currentMinutes: Math.round(result.preview.current.durationSeconds / 60),
              suggestedMinutes: Math.round(result.preview.suggested.durationSeconds / 60),
              currentMiles: Math.round((result.preview.current.distanceMeters / 1609.34) * 10) / 10,
              suggestedMiles: Math.round((result.preview.suggested.distanceMeters / 1609.34) * 10) / 10,
              mapUrl: result.preview.suggested.mapUrl,
              orderedIds: result.preview.suggested.orderedIds,
            });
          });
        }}
      >
        {pending ? "Optimizing…" : "Optimize route"}
      </button>
      {error ? <p className="text-[11px] text-rose-700">{error}</p> : null}
      {preview ? (
        <div className="rounded-lg bg-[var(--muted)] p-2 text-[11px]">
          <p className="font-semibold">{technicianName}</p>
          <p>
            Current {preview.currentMinutes} min · {preview.currentMiles} mi
          </p>
          <p>
            Optimized {preview.suggestedMinutes} min · {preview.suggestedMiles} mi
          </p>
          <p>
            Saves {Math.max(0, preview.currentMinutes - preview.suggestedMinutes)} min ·{" "}
            {Math.max(0, preview.currentMiles - preview.suggestedMiles)} mi
          </p>
          {preview.mapUrl ? (
            <a href={preview.mapUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block underline">
              Map preview
            </a>
          ) : null}
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              className="h-7 flex-1 rounded bg-[var(--cy-navy)] text-white"
              disabled={pending}
              onClick={() => {
                start(async () => {
                  const result = await applyRouteAction({
                    technicianUserId,
                    orderedIds: preview.orderedIds,
                    dayIso,
                  });
                  if (!result.ok) setError(result.error);
                  else setPreview(null);
                });
              }}
            >
              Apply
            </button>
            <button type="button" className="h-7 flex-1 rounded border" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
