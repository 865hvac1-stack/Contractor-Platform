import type { AppointmentDaypart } from "@prisma/client";

export function matchesDaypart(
  window: { startMinutes: number; daypart?: AppointmentDaypart | null },
  requested?: AppointmentDaypart | null
) {
  if (!requested || requested === "ANY") return true;
  const inferred = window.daypart && window.daypart !== "ANY" ? window.daypart : inferFromStart(window.startMinutes);
  if (requested === inferred) return true;
  if (requested === "AFTERNOON" && window.startMinutes >= 12 * 60) return true;
  if (requested === "MORNING" && window.startMinutes < 12 * 60) return true;
  if (requested === "EVENING" && window.startMinutes >= 17 * 60) return true;
  return false;
}

export function inferFromStart(startMinutes: number): AppointmentDaypart {
  if (startMinutes >= 17 * 60) return "EVENING";
  if (startMinutes >= 12 * 60) return "AFTERNOON";
  return "MORNING";
}

export function daypartFromPhrase(text: string): AppointmentDaypart | null {
  const value = text.toLowerCase();
  if (/\bafter lunch\b|\bafternoon\b|\bafter noon\b/.test(value)) return "AFTERNOON";
  if (/\bevening\b|\btonight\b/.test(value)) return "EVENING";
  if (/\bmorning\b|\bam\b/.test(value) && !/\bafternoon\b/.test(value)) return "MORNING";
  return null;
}

export function windowsMatchingExactTime(
  windows: Array<{ id: string; startMinutes: number; endMinutes: number; active?: boolean }>,
  startMinutes: number,
  endMinutes?: number | null
) {
  return windows.filter((window) => {
    if (window.active === false) return false;
    if (endMinutes == null) {
      return startMinutes >= window.startMinutes && startMinutes < window.endMinutes;
    }
    return startMinutes >= window.startMinutes && endMinutes <= window.endMinutes;
  });
}
