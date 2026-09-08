import type { AppointmentDaypart } from "@prisma/client";
import type { SchedulingIntent } from "@/lib/scheduling/types";
import { weekdayFromDateKey } from "@/lib/scheduling/time";

export const ACTIVE_SCHEDULING_STATUSES = ["OPEN", "CLARIFYING", "SUGGESTED", "NEEDS_REVIEW"] as const;

export type OfferedSlot = {
  date: string;
  windowId: string;
  startMinutes: number;
  endMinutes: number;
};

export type SchedulingTurnAction =
  | { action: "ignore" }
  | { action: "close" }
  | { action: "handoff"; reason: string }
  | { action: "ask"; missing: NonNullable<SchedulingIntent["missingField"]> }
  | { action: "offer_slots"; slots: OfferedSlot[]; todayWasFull: boolean; requestedLabel: string | null }
  | { action: "book"; date: string; windowId: string }
  | { action: "suggest"; date: string; windowId: string };

const AVAILABILITY_QUESTION =
  /\b(when do you (have|got)|when are you|what days?( are open| do you have)?|what day do you have|what times?( do you have)?|what do you have|do you have (anything|any|an opening|availability|available)|what(?:'s| is) (your )?(next opening|soonest)|next opening|soonest appointment|when can (you|someone|anybody|a tech)|any (openings?|availability)|what(?:'s| is) available|days? (are )?open|this week)\b/;

const DECLINE_SESSION =
  /\b(never mind|nevermind|don'?t schedule|do not schedule|don'?t need it( anymore)?|i('ll| will) call back|stop scheduling|i changed my mind)\b/;

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function isAvailabilityQuestion(text: string) {
  return AVAILABILITY_QUESTION.test(text.trim().toLowerCase());
}

export function isDeclineScheduling(text: string) {
  return DECLINE_SESSION.test(text.trim().toLowerCase());
}

export function isSchedulingTurn(intent: SchedulingIntent) {
  return Boolean(
    intent.availabilityAsk ||
      intent.availabilitySearchRequested ||
      intent.declineIntent ||
      intent.humanRequested ||
      intent.cancelIntent ||
      intent.rescheduleIntent ||
      intent.maintenanceIntent ||
      intent.requestedDate ||
      intent.requestedDaypart ||
      intent.requestedWindowId ||
      intent.requestedStartMinutes != null ||
      intent.serviceIntent
  );
}

export function shouldSearchAvailability(input: {
  intent: SchedulingIntent;
  previousMissing?: string | null;
  previousStatus?: string | null;
}) {
  if (input.intent.availabilityAsk || input.intent.availabilitySearchRequested) return true;
  if (input.intent.requestedDate || input.intent.requestedWindowId || input.intent.requestedStartMinutes != null) {
    return false;
  }
  if (input.intent.declineIntent || input.intent.cancelIntent || input.intent.humanRequested) return false;
  return input.previousMissing === "date" || input.previousMissing === "slot_selection";
}

export function ownsSchedulingInbound(input: {
  activeState: { status: string; paused: boolean; expiresAt: Date } | null;
  intent: SchedulingIntent;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const active =
    input.activeState &&
    !input.activeState.paused &&
    input.activeState.expiresAt.getTime() > now.getTime() &&
    (ACTIVE_SCHEDULING_STATUSES as readonly string[]).includes(input.activeState.status);
  if (active) return "scheduling" as const;
  if (input.activeState?.paused && !input.intent.humanRequested && !input.intent.declineIntent) {
    return "ignore" as const;
  }
  if (isSchedulingTurn(input.intent)) return "scheduling" as const;
  return "ignore" as const;
}

export function uniqueWindowOffers(
  options: Array<{
    date: string;
    windowId: string;
    startMinutes: number;
    endMinutes: number;
    remainingCapacity: number;
    daypart?: AppointmentDaypart | null;
  }>,
  limit = 3
): OfferedSlot[] {
  const seen = new Set<string>();
  const offers: OfferedSlot[] = [];
  for (const option of options) {
    if (option.remainingCapacity <= 0) continue;
    const key = `${option.date}:${option.windowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push({
      date: option.date,
      windowId: option.windowId,
      startMinutes: option.startMinutes,
      endMinutes: option.endMinutes,
    });
    if (offers.length >= limit) break;
  }
  return offers;
}

export function parseOfferedSlots(value: unknown): OfferedSlot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const slot = row as Record<string, unknown>;
    if (typeof slot.date !== "string" || typeof slot.windowId !== "string") return [];
    return [
      {
        date: slot.date,
        windowId: slot.windowId,
        startMinutes: Number(slot.startMinutes) || 0,
        endMinutes: Number(slot.endMinutes) || 0,
      },
    ];
  });
}

export function matchOfferedSlot(text: string, offers: OfferedSlot[]): OfferedSlot | null {
  if (!offers.length) return null;
  const lower = text.trim().toLowerCase();
  if (/\b(first|1st|that first one|the first one)\b/.test(lower)) return offers[0] ?? null;
  if (/\b(second|2nd|the second)\b/.test(lower)) return offers[1] ?? null;
  if (/\b(third|3rd|the third)\b/.test(lower)) return offers[2] ?? null;
  if (/\b(last one|the last)\b/.test(lower)) return offers[offers.length - 1] ?? null;

  const weekdayHits = Object.entries(WEEKDAY_INDEX).filter(([name]) => new RegExp(`\\b${name}\\b`).test(lower));
  let matches = offers;
  if (weekdayHits.length === 1) {
    const weekday = weekdayHits[0]![1];
    matches = offers.filter((slot) => weekdayFromDateKey(slot.date) === weekday);
  }
  const start = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (start && matches.length) {
    let hours = Number(start[1]);
    const minutes = Number(start[2] ?? 0);
    const period = start[3];
    if (period === "pm" && hours < 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    if (!period && hours >= 1 && hours <= 7) hours += 12;
    const startMinutes = hours * 60 + minutes;
    const byTime = matches.filter((slot) => startMinutes >= slot.startMinutes && startMinutes < slot.endMinutes);
    if (byTime.length === 1) return byTime[0] ?? null;
    if (byTime.length > 1) return byTime[0] ?? null;
  }
  if (matches.length === 1) return matches[0] ?? null;
  return null;
}

export function resolveSchedulingTurn(input: {
  previous: { status: string; paused: boolean; missingField?: string | null } | null;
  intent: SchedulingIntent;
  text?: string;
  offeredSlots?: OfferedSlot[];
  canAutoBook: boolean;
  todayKey: string;
  todaySlots: OfferedSlot[];
  requestedSlots: OfferedSlot[];
  nextSlots: OfferedSlot[];
}): SchedulingTurnAction {
  const intent = input.intent;
  if (intent.declineIntent && !intent.cancelIntent) return { action: "close" };
  if (intent.humanRequested) return { action: "handoff", reason: "human_requested" };

  const offered = input.offeredSlots ?? [];
  const picked = input.text ? matchOfferedSlot(input.text, offered) : null;
  if (picked) {
    return input.canAutoBook
      ? { action: "book", date: picked.date, windowId: picked.windowId }
      : { action: "suggest", date: picked.date, windowId: picked.windowId };
  }

  if (intent.requestedWindowId && intent.requestedDate) {
    const stillOpen = input.requestedSlots.some(
      (slot) => slot.windowId === intent.requestedWindowId && slot.date === intent.requestedDate
    );
    if (!stillOpen) {
      if (!input.nextSlots.length) return { action: "handoff", reason: "no_availability" };
      return {
        action: "offer_slots",
        slots: input.nextSlots,
        todayWasFull: input.todaySlots.length === 0,
        requestedLabel: intent.requestedDate,
      };
    }
    return input.canAutoBook
      ? { action: "book", date: intent.requestedDate, windowId: intent.requestedWindowId }
      : { action: "suggest", date: intent.requestedDate, windowId: intent.requestedWindowId };
  }

  if (intent.requestedWindowId && !intent.requestedDate) {
    const match = [...input.todaySlots, ...input.nextSlots].find((slot) => slot.windowId === intent.requestedWindowId);
    if (match) {
      return input.canAutoBook
        ? { action: "book", date: match.date, windowId: match.windowId }
        : { action: "suggest", date: match.date, windowId: match.windowId };
    }
    if (!input.nextSlots.length) return { action: "handoff", reason: "no_availability" };
    return {
      action: "offer_slots",
      slots: input.nextSlots,
      todayWasFull: input.todaySlots.length === 0,
      requestedLabel: null,
    };
  }

  const search = shouldSearchAvailability({
    intent,
    previousMissing: input.previous?.missingField,
    previousStatus: input.previous?.status,
  });

  if (search) {
    const primary = intent.requestedDate ? input.requestedSlots : input.nextSlots.length ? input.nextSlots : input.todaySlots;
    const slots = primary.length ? primary : input.nextSlots;
    if (!slots.length) return { action: "handoff", reason: "no_availability" };
    return {
      action: "offer_slots",
      slots,
      todayWasFull: input.todaySlots.length === 0,
      requestedLabel: intent.requestedDate ?? null,
    };
  }

  if (!intent.requestedDate && !intent.requestedDateEnd) {
    return { action: "ask", missing: intent.missingField === "service" ? "service" : "date" };
  }
  if (intent.missingField === "daypart" || intent.missingField === "service") {
    return { action: "ask", missing: intent.missingField };
  }

  const slots = input.requestedSlots.length ? input.requestedSlots : input.nextSlots;
  if (slots.length === 1) {
    return input.canAutoBook
      ? { action: "book", date: slots[0]!.date, windowId: slots[0]!.windowId }
      : { action: "suggest", date: slots[0]!.date, windowId: slots[0]!.windowId };
  }
  if (slots.length > 1) {
    return {
      action: "offer_slots",
      slots,
      todayWasFull: Boolean(intent.requestedDate && intent.requestedDate !== input.todayKey && input.todaySlots.length === 0),
      requestedLabel: intent.requestedDate ?? null,
    };
  }
  if (input.previous) return { action: "handoff", reason: "no_availability" };
  return { action: "ask", missing: "date" };
}
