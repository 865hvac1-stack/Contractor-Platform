import type { AppointmentDaypart } from "@prisma/client";
import { matchesDaypart } from "@/lib/scheduling/daypart";
import { rankEligibleOptions } from "@/lib/scheduling/ranking";
import {
  addLocalDays,
  companyTodayKey,
  compareDateKeys,
  daysBetweenKeys,
  isWeekendDateKey,
  localMinutesOf,
} from "@/lib/scheduling/time";
import type {
  CapacityOption,
  CapacityQuery,
  CapacityRejectionReason,
  CapacityResult,
  RejectedCapacityOption,
  SchedulingPolicyView,
} from "@/lib/scheduling/types";

export type EngineWindow = {
  id: string;
  name: string;
  label?: string | null;
  startMinutes: number;
  endMinutes: number;
  daypart: AppointmentDaypart;
  active: boolean;
};

export type EngineTechnician = {
  id: string;
  name: string;
  active: boolean;
};

export type EngineWeekly = {
  userId: string;
  windowId: string;
  weekday: number;
  available: boolean;
  capacity: number;
};

export type EngineOverride = {
  userId: string;
  windowId: string;
  date: string;
  available: boolean;
  capacity: number | null;
};

export type EngineEligibility = {
  userId: string;
  serviceTypeId: string;
  eligible: boolean;
};

export type EngineBooking = {
  technicianId: string;
  windowId: string;
  date: string;
  jobId: string;
  scheduleLocked?: boolean;
};

export type EngineSnapshot = {
  timeZone: string;
  policy: SchedulingPolicyView;
  windows: EngineWindow[];
  technicians: EngineTechnician[];
  weekly: EngineWeekly[];
  overrides: EngineOverride[];
  eligibility: EngineEligibility[];
  bookings: EngineBooking[];
  now: Date;
};

function dateKey(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function evaluateCapacity(snapshot: EngineSnapshot, query: CapacityQuery): CapacityResult {
  const date = query.date;
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const windows = snapshot.windows.filter((window) => window.active && (!query.appointmentWindowId || window.id === query.appointmentWindowId));
  const companyWindowUsed: Record<string, number> = {};
  for (const booking of snapshot.bookings.filter((row) => dateKey(row.date) === date)) {
    companyWindowUsed[booking.windowId] = (companyWindowUsed[booking.windowId] ?? 0) + 1;
  }
  const companyDayUsed = snapshot.bookings.filter((row) => dateKey(row.date) === date).length;

  const options: CapacityOption[] = [];
  const rejected: RejectedCapacityOption[] = [];
  const today = companyTodayKey(snapshot.now, snapshot.timeZone);
  const horizonDays = query.maintenance ? snapshot.policy.maintenanceHorizonDays : snapshot.policy.standardHorizonDays;

  for (const window of windows) {
    const policyReasons = policyGate(snapshot.policy, query, window, date, today, snapshot.now, snapshot.timeZone, horizonDays);
    for (const tech of snapshot.technicians) {
      const reasons: CapacityRejectionReason[] = [...policyReasons];
      if (query.technicianId && query.technicianId !== tech.id) reasons.push("preference_mismatch");
      if (!tech.active) reasons.push("technician_inactive");

      const override = snapshot.overrides.find(
        (row) => row.userId === tech.id && row.windowId === window.id && dateKey(row.date) === date
      );
      const weekly = snapshot.weekly.find(
        (row) => row.userId === tech.id && row.windowId === window.id && row.weekday === weekday
      );
      const available = override ? override.available === true : weekly?.available === true;
      const configuredCapacity = override?.capacity ?? weekly?.capacity ?? 0;
      if (!weekly && !override) reasons.push("not_working");
      else if (!available) reasons.push("window_unavailable");

      const usedCapacity = snapshot.bookings.filter(
        (row) => row.technicianId === tech.id && row.windowId === window.id && dateKey(row.date) === date
      ).length;
      const reserve = snapshot.policy.emergencyReservePerWindow;
      const usableCapacity =
        query.allowEmergencyReserve || snapshot.policy.allowEmergencyReserveUse
          ? configuredCapacity
          : Math.max(0, configuredCapacity - reserve);
      const remainingCapacity = Math.max(0, usableCapacity - usedCapacity);
      if (available && remainingCapacity <= 0) reasons.push("no_remaining_capacity");

      if (query.serviceTypeId) {
        const rows = snapshot.eligibility.filter((row) => row.userId === tech.id);
        const match = rows.find((row) => row.serviceTypeId === query.serviceTypeId);
        if (rows.length > 0 && match && !match.eligible) reasons.push("ineligible_service_type");
        if (rows.length > 0 && !match) reasons.push("ineligible_service_type");
      }

      const lockedConflict = snapshot.bookings.some(
        (row) =>
          row.technicianId === tech.id &&
          dateKey(row.date) === date &&
          row.windowId === window.id &&
          row.scheduleLocked
      );
      if (lockedConflict && remainingCapacity <= 0) reasons.push("locked_conflict");

      const companyWindowRemaining =
        snapshot.policy.maxJobsPerWindow == null
          ? null
          : Math.max(0, snapshot.policy.maxJobsPerWindow - (companyWindowUsed[window.id] ?? 0));
      const companyDayRemaining =
        snapshot.policy.maxJobsPerDay == null ? null : Math.max(0, snapshot.policy.maxJobsPerDay - companyDayUsed);
      if (companyWindowRemaining === 0) reasons.push("company_window_full");
      if (companyDayRemaining === 0) reasons.push("company_day_full");

      if (reasons.length) {
        rejected.push({
          technicianId: tech.id,
          technicianName: tech.name,
          windowId: window.id,
          date,
          reasons: [...new Set(reasons)],
        });
        continue;
      }

      const dayWorkload = snapshot.bookings.filter(
        (row) => row.technicianId === tech.id && dateKey(row.date) === date
      ).length;
      options.push({
        technicianId: tech.id,
        technicianName: tech.name,
        windowId: window.id,
        windowName: window.name,
        windowLabel: window.label || window.name,
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
        daypart: window.daypart,
        date,
        configuredCapacity,
        usedCapacity,
        remainingCapacity,
        dayWorkload,
        companyRemaining:
          companyWindowRemaining == null && companyDayRemaining == null
            ? null
            : Math.min(companyWindowRemaining ?? remainingCapacity, companyDayRemaining ?? remainingCapacity),
        eligibility: "eligible",
        ranking: {
          usedCapacityPercent: configuredCapacity <= 0 ? 100 : (usedCapacity / configuredCapacity) * 100,
          dayWorkload,
          stableTieBreak: 0,
          routeScore: null,
        },
      });
    }
  }

  const ranked = rankEligibleOptions(options).map(({ option, ranking }) => ({ ...option, ranking }));
  return { date, options: ranked, rejected, companyWindowUsed, companyDayUsed };
}

function policyGate(
  policy: SchedulingPolicyView,
  query: CapacityQuery,
  window: EngineWindow,
  date: string,
  today: string,
  now: Date,
  timeZone: string,
  horizonDays: number
): CapacityRejectionReason[] {
  const reasons: CapacityRejectionReason[] = [];
  if (!window.active) reasons.push("window_inactive");
  if (compareDateKeys(date, today) < 0) reasons.push("outside_horizon");
  if (daysBetweenKeys(today, date) > horizonDays) reasons.push("outside_horizon");
  if (date === today && !policy.allowSameDay) reasons.push("same_day_disabled");
  if (isWeekendDateKey(date) && !policy.allowWeekend) reasons.push("weekend_disabled");
  if (date === today && policy.minNoticeMinutes > 0) {
    const localNow = localMinutesOf(now, timeZone);
    if (window.startMinutes < localNow + policy.minNoticeMinutes) reasons.push("min_notice");
  }
  return reasons;
}

export function firstEligibleOption(result: CapacityResult) {
  return result.options[0] ?? null;
}

export function filterOptionsByDaypart(result: CapacityResult, daypart?: AppointmentDaypart | null) {
  if (!daypart || daypart === "ANY") return result;
  return {
    ...result,
    options: result.options.filter((option) => matchesDaypart(option, daypart)),
  };
}

export function searchNextAvailable(
  snapshot: EngineSnapshot,
  query: Omit<CapacityQuery, "date"> & { startDate: string; days?: number; daypart?: AppointmentDaypart | null }
) {
  const days = query.days ?? 14;
  const found: CapacityOption[] = [];
  for (let i = 0; i < days && found.length < 4; i += 1) {
    const date = addLocalDays(query.startDate, i);
    const result = filterOptionsByDaypart(
      evaluateCapacity(snapshot, { ...query, date, companyId: query.companyId || "" }),
      query.daypart
    );
    found.push(...result.options.slice(0, 2));
  }
  return found.slice(0, 4);
}
