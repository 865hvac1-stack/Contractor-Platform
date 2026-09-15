"use client";

import { useEffect, useRef } from "react";
import type { DispatchCard, DispatchLane } from "@/lib/dispatch/types";

type GoogleMaps = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => {
    setCenter: (latLng: { lat: number; lng: number }) => void;
    fitBounds: (bounds: unknown) => void;
  };
  Marker: new (opts: Record<string, unknown>) => { addListener: (event: string, handler: () => void) => void; setMap: (map: unknown) => void };
  LatLngBounds: new () => { extend: (latLng: { lat: number; lng: number }) => void };
  SymbolPath: { CIRCLE: unknown };
};

declare global {
  interface Window {
    google?: { maps?: GoogleMaps };
  }
}

function loadMaps(key: string) {
  if (window.google?.maps) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector("script[data-cy-google-maps]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.cyGoogleMaps = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Maps JavaScript API failed to load."));
    document.head.appendChild(script);
  });
}

export function DispatchMapView({
  browserKey,
  jobs,
  technicians,
  selectedJobId,
  selectedTechId,
  onSelectJob,
  onSelectTech,
}: {
  browserKey: string;
  jobs: DispatchCard[];
  technicians: DispatchLane[];
  selectedJobId?: string | null;
  selectedTechId?: string | null;
  onSelectJob: (job: DispatchCard) => void;
  onSelectTech: (techId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!browserKey || !ref.current) return;
    let cancelled = false;
    loadMaps(browserKey)
      .then(() => {
        if (cancelled || !ref.current || !window.google?.maps) return;
        const maps = window.google.maps;
        const map = new maps.Map(ref.current, {
          zoom: 10,
          center: { lat: 35.9606, lng: -83.9207 },
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        const bounds = new maps.LatLngBounds();
        let hasPoint = false;
        for (const job of jobs) {
          if (job.latitude == null || job.longitude == null) continue;
          hasPoint = true;
          const point = { lat: job.latitude, lng: job.longitude };
          bounds.extend(point);
          const marker = new maps.Marker({
            map,
            position: point,
            label: job.priority === "URGENT" ? "!" : job.assigneeIds.length ? undefined : "U",
            title: `${job.customer} · ${job.jobType || "Job"} · ${job.statusLabel}`,
            icon: job.id === selectedJobId
              ? { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#F97316", fillOpacity: 1, strokeColor: "#0B1F33", strokeWeight: 2 }
              : undefined,
          });
          marker.addListener("click", () => onSelectJob(job));
        }
        for (const tech of technicians) {
          if (tech.latitude == null || tech.longitude == null) continue;
          hasPoint = true;
          const point = { lat: tech.latitude, lng: tech.longitude };
          bounds.extend(point);
          const marker = new maps.Marker({
            map,
            position: point,
            label: tech.initials,
            title: `${tech.name} · ${tech.locationLabel || tech.state}`,
          });
          marker.addListener("click", () => onSelectTech(tech.userId));
        }
        if (hasPoint) map.fitBounds(bounds);
        void selectedTechId;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [browserKey, jobs, technicians, selectedJobId, selectedTechId, onSelectJob, onSelectTech]);

  if (!browserKey) {
    return (
      <div className="flex h-full min-h-[28rem] flex-col justify-center rounded-2xl border bg-slate-50 p-6">
        <p className="font-semibold text-[var(--cy-navy)]">Map unavailable</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Set GOOGLE_MAPS_BROWSER_API_KEY to render the operational map. Jobs and assignment still work from the list below.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {jobs.map((job) => (
            <li key={job.id}>
              <button type="button" className="text-left font-medium text-[var(--cy-navy)]" onClick={() => onSelectJob(job)}>
                {job.customer} · {job.city || job.address} · {job.statusLabel}
                {job.geocodingStatus && job.geocodingStatus !== "OK" ? " · LOCATION NEEDS REVIEW" : ""}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return <div ref={ref} className="h-full min-h-[28rem] w-full rounded-2xl border" role="application" aria-label="Dispatch map" />;
}
