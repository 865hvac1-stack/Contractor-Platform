import type { AppointmentDaypart } from "@prisma/client";

export type WindowDraft = {
  id?: string;
  name: string;
  label?: string | null;
  startMinutes: number;
  endMinutes: number;
  daypart?: AppointmentDaypart | null;
  active?: boolean;
  sortOrder?: number;
};

export type WindowOverlapIssue = {
  left: string;
  right: string;
  message: string;
};

export function windowNameFromTimes(startMinutes: number, endMinutes: number) {
  const hours = (minutes: number) => {
    const hours24 = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 || 12;
    return mins === 0 ? `${hours12} ${period}` : `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
  };
  return `${hours(startMinutes)}–${hours(endMinutes)}`;
}

export function windowOverlapsHours(
  window: { startMinutes: number; endMinutes: number },
  startMinutes: number,
  endMinutes: number
) {
  return window.startMinutes < endMinutes && startMinutes < window.endMinutes;
}

export function inferDaypart(startMinutes: number): AppointmentDaypart {
  if (startMinutes >= 17 * 60) return "EVENING";
  if (startMinutes >= 12 * 60) return "AFTERNOON";
  return "MORNING";
}

export function windowsOverlap(a: { startMinutes: number; endMinutes: number }, b: { startMinutes: number; endMinutes: number }) {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

export function validateAppointmentWindow(input: WindowDraft): string | null {
  const name = input.name.trim();
  if (!name) return "Window name is required.";
  if (!Number.isInteger(input.startMinutes) || !Number.isInteger(input.endMinutes)) {
    return "Start and end times must be valid clock times.";
  }
  if (input.startMinutes < 0 || input.endMinutes < 0 || input.startMinutes >= 24 * 60 || input.endMinutes > 24 * 60) {
    return "Window times must stay inside a single day.";
  }
  if (input.endMinutes <= input.startMinutes) {
    return "End time must be after start time.";
  }
  if (input.endMinutes - input.startMinutes < 30) {
    return "Windows must be at least 30 minutes long.";
  }
  return null;
}

export function findActiveWindowOverlaps(windows: Array<WindowDraft & { name: string }>): WindowOverlapIssue[] {
  const active = windows.filter((window) => window.active !== false);
  const issues: WindowOverlapIssue[] = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (windowsOverlap(active[i], active[j])) {
        issues.push({
          left: active[i].name,
          right: active[j].name,
          message: `"${active[i].name}" overlaps "${active[j].name}". Active windows cannot overlap.`,
        });
      }
    }
  }
  return issues;
}

export function canDeleteWindow(input: { bookingCount: number; jobCount: number }) {
  if (input.bookingCount > 0 || input.jobCount > 0) {
    return { ok: false as const, error: "This window has booked appointments. Disable it instead of deleting." };
  }
  return { ok: true as const };
}

export const DEFAULT_APPOINTMENT_WINDOWS: Array<{
  name: string;
  startMinutes: number;
  endMinutes: number;
  daypart: AppointmentDaypart;
  sortOrder: number;
}> = [
  { name: "Morning 1", startMinutes: 9 * 60, endMinutes: 11 * 60, daypart: "MORNING", sortOrder: 0 },
  { name: "Morning 2", startMinutes: 11 * 60, endMinutes: 13 * 60, daypart: "MORNING", sortOrder: 1 },
  { name: "Afternoon 1", startMinutes: 13 * 60, endMinutes: 15 * 60, daypart: "AFTERNOON", sortOrder: 2 },
  { name: "Afternoon 2", startMinutes: 15 * 60, endMinutes: 17 * 60, daypart: "AFTERNOON", sortOrder: 3 },
];
