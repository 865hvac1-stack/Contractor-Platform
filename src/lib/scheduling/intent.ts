import type { AppointmentDaypart } from "@prisma/client";
import { daypartFromPhrase, windowsMatchingExactTime } from "@/lib/scheduling/daypart";
import { isAvailabilityQuestion, isDeclineScheduling } from "@/lib/scheduling/conversation-turn";
import { parseClockToMinutes, addLocalDays, companyTodayKey, firstOfMonthKey, lastOfMonthKey, weekdayFromDateKey } from "@/lib/scheduling/time";
import type { SchedulingIntent } from "@/lib/scheduling/types";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseWindowClock(value: string) {
  const hasPeriod = /am|pm/i.test(value);
  const minutes = parseClockToMinutes(value);
  if (minutes == null) return null;
  if (!hasPeriod) {
    const hours = Math.floor(minutes / 60);
    if (hours >= 1 && hours <= 7) return minutes + 12 * 60;
  }
  return minutes;
}

export function interpretSchedulingIntent(input: {
  text: string;
  timeZone: string;
  now?: Date;
  windows?: Array<{ id: string; startMinutes: number; endMinutes: number; active?: boolean }>;
}): SchedulingIntent {
  const now = input.now ?? new Date();
  const today = companyTodayKey(now, input.timeZone);
  const text = input.text.trim();
  const lower = text.toLowerCase();

  const humanRequested = /\b(human|person|office|someone from the office|talk to (a )?person|speak to (a )?(human|person|rep)|representative|stop texting|real person)\b/.test(lower);
  const cancelIntent = /\b(cancel|call off).*(appointment|visit|job)?|\bi need to cancel\b|\bcancel (my |the )?(appointment|visit|job)\b/.test(lower);
  const declineIntent = isDeclineScheduling(lower);
  const availabilityAsk = isAvailabilityQuestion(lower);
  const availabilitySearchRequested = availabilityAsk;
  const rescheduleIntent = /\b(reschedule|change (my |the )?appointment|move (me|it|my appointment)|can't do|cannot do|switch to)\b/.test(lower);
  const maintenanceIntent = /\b(maintenance|tune[- ]?up|comfort club|membership visit|fall maintenance|spring maintenance)\b/.test(lower);
  const urgency: SchedulingIntent["urgency"] = /\b(emergency|asap|right now|no (heat|cooling|ac)|urgent)\b/.test(lower)
    ? "emergency"
    : "normal";

  let requestedDaypart = daypartFromPhrase(lower);
  let requestedDate: string | null = null;
  let requestedDateEnd: string | null = null;
  let requestedStartMinutes: number | null = null;
  let requestedEndMinutes: number | null = null;
  let requestedWindowId: string | null = null;
  let missingField: SchedulingIntent["missingField"] = null;

  if (/\btoday\b/.test(lower) || /\bthis (morning|afternoon|evening)\b/.test(lower)) requestedDate = today;
  else if (/\btomorrow\b/.test(lower)) requestedDate = addLocalDays(today, 1);
  else if (/\bnext week\b/.test(lower)) {
    const daysUntilMonday = (8 - weekdayFromDateKey(today)) % 7 || 7;
    requestedDate = addLocalDays(today, daysUntilMonday);
    requestedDateEnd = addLocalDays(requestedDate, 4);
    if (!requestedDaypart) missingField = "daypart";
  } else if (/\bsix months\b|\bin 6 months\b/.test(lower)) {
    requestedDate = addLocalDays(today, 180);
    requestedDateEnd = addLocalDays(requestedDate, 30);
  }

  for (const [name, month] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) {
      const yearNow = Number(today.slice(0, 4));
      const monthNow = Number(today.slice(5, 7));
      const wantsThis = new RegExp(`\\bthis ${name}\\b`).test(lower);
      const year = month < monthNow && !wantsThis ? yearNow + 1 : yearNow;
      requestedDate = firstOfMonthKey(year, month);
      requestedDateEnd = lastOfMonthKey(Number(requestedDate.slice(0, 4)), Number(requestedDate.slice(5, 7)));
      break;
    }
  }

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) {
      let delta = (weekday - weekdayFromDateKey(today) + 7) % 7;
      if (delta === 0 && !/\btoday\b/.test(lower)) delta = 7;
      requestedDate = addLocalDays(today, delta);
      break;
    }
  }

  const range = lower.match(/between\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+and\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i)
    ?? lower.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|—)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (range) {
    requestedStartMinutes = parseWindowClock(range[1]);
    requestedEndMinutes = parseWindowClock(range[2]);
    if (requestedStartMinutes != null && requestedEndMinutes != null && requestedEndMinutes <= requestedStartMinutes) {
      requestedEndMinutes += 12 * 60;
    }
  }

  if (input.windows && requestedStartMinutes != null) {
    const matches = windowsMatchingExactTime(input.windows, requestedStartMinutes, requestedEndMinutes);
    if (matches.length === 1) requestedWindowId = matches[0].id;
  }

  const schedulingAsk = /\b(come|schedule|appointment|available|book|send someone|get someone|can you|do you have|works)\b/.test(lower)
    || availabilityAsk
    || declineIntent
    || Boolean(requestedDate)
    || Boolean(requestedDaypart)
    || requestedStartMinutes != null
    || Boolean(requestedWindowId)
    || maintenanceIntent
    || rescheduleIntent
    || cancelIntent;

  if (!schedulingAsk && !humanRequested) {
    return { confidence: "low", missingField: null };
  }

  if (availabilityAsk && !requestedDate && !requestedDateEnd && !requestedWindowId) {
    missingField = null;
  } else if (!requestedDate && !requestedDateEnd && !cancelIntent && !rescheduleIntent && !declineIntent && !availabilityAsk) {
    missingField = missingField ?? "date";
  } else if (requestedDate && !requestedDaypart && !requestedWindowId && !requestedStartMinutes && requestedDateEnd) {
    missingField = missingField ?? "daypart";
  } else if (requestedDate && !requestedDaypart && !requestedWindowId && !requestedStartMinutes && /\banytime\b/.test(lower)) {
    requestedDaypart = "ANY";
  } else if (requestedDate && !requestedDaypart && !requestedWindowId && !requestedStartMinutes && !cancelIntent) {
    missingField = missingField ?? "daypart";
  }

  const confidence: SchedulingIntent["confidence"] =
    humanRequested || cancelIntent || declineIntent || availabilityAsk || (requestedDate && (requestedDaypart || requestedWindowId))
      ? "high"
      : "low";

  return {
    requestedDate,
    requestedDateEnd,
    requestedDaypart: requestedDaypart as AppointmentDaypart | null,
    requestedWindowId,
    requestedStartMinutes,
    requestedEndMinutes,
    serviceIntent: maintenanceIntent ? "maintenance" : "service",
    maintenanceIntent,
    urgency,
    rescheduleIntent,
    cancelIntent,
    declineIntent,
    availabilityAsk,
    availabilitySearchRequested,
    humanRequested,
    missingField,
    confidence,
  };
}

export function mergeSchedulingIntent(previous: SchedulingIntent, next: SchedulingIntent): SchedulingIntent {
  const searching =
    Boolean(next.availabilityAsk || next.availabilitySearchRequested) ||
    (previous.missingField === "date" &&
      !next.requestedDate &&
      !next.requestedWindowId &&
      !next.requestedStartMinutes &&
      !next.cancelIntent &&
      !next.declineIntent &&
      !next.humanRequested);
  const requestedDate = searching && !next.requestedDate ? null : next.requestedDate ?? previous.requestedDate;
  const requestedDaypart = searching ? next.requestedDaypart ?? null : next.requestedDaypart ?? previous.requestedDaypart;
  const requestedWindowId = next.requestedWindowId ?? (searching ? null : previous.requestedWindowId);
  let missingField: SchedulingIntent["missingField"] = null;
  if (previous.missingField === "slot_selection" && !searching && !next.requestedWindowId) {
    missingField = "slot_selection";
  } else if (searching && !requestedWindowId) missingField = null;
  else if (!requestedDate && !next.cancelIntent && !next.declineIntent) missingField = "date";
  else if (!requestedDaypart && !requestedWindowId && !next.requestedStartMinutes) missingField = "daypart";
  return {
    requestedDate,
    requestedDateEnd: searching ? next.requestedDateEnd ?? null : next.requestedDateEnd ?? previous.requestedDateEnd,
    requestedDaypart,
    requestedWindowId,
    requestedStartMinutes: next.requestedStartMinutes ?? previous.requestedStartMinutes,
    requestedEndMinutes: next.requestedEndMinutes ?? previous.requestedEndMinutes,
    serviceIntent: next.serviceIntent ?? previous.serviceIntent,
    maintenanceIntent: next.maintenanceIntent || previous.maintenanceIntent,
    urgency: next.urgency ?? previous.urgency,
    rescheduleIntent: next.rescheduleIntent || previous.rescheduleIntent,
    cancelIntent: next.cancelIntent || previous.cancelIntent,
    declineIntent: Boolean(next.declineIntent),
    availabilityAsk: Boolean(next.availabilityAsk || searching),
    availabilitySearchRequested: Boolean(next.availabilitySearchRequested || searching),
    humanRequested: next.humanRequested || previous.humanRequested,
    missingField,
    confidence: missingField ? "low" : "high",
  };
}
