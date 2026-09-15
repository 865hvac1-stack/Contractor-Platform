"use client";

import { useEffect, useState } from "react";
import { pingTechnicianLocationAction } from "@/server/actions/smart-dispatch";

export function TechnicianLocationBeacon() {
  const [status, setStatus] = useState<"idle" | "live" | "denied">("idle");

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus("denied");
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setStatus("live");
        void pingTechnicianLocationAction({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
      },
      () => setStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  if (status !== "denied") return null;
  return (
    <p className="px-4 py-2 text-center text-xs text-[var(--muted-foreground)]">
      LOCATION UNAVAILABLE. Dispatch can still assign you using schedule and qualifications.
    </p>
  );
}
