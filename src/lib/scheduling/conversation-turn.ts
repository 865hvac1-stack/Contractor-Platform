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

export type SlotSelectionResult =
  | { kind: "match"; slot: OfferedSlot }
  | { kind: "ambiguous"; candidates: OfferedSlot[] }
  | { kind: "none" };

export type SchedulingTurnAction =
  | { action: "ignore" }
  | { action: "close" }
  | { action: "handoff"; reason: string }
  | { action: "ask"; missing: NonNullable<SchedulingIntent["missingField"]> }
  | { action: "offer_slots"; slots: OfferedSlot[]; todayWasFull: boolean; requestedLabel: string | null }
  | { action: "clarify_slots"; slots: OfferedSlot[] }
  | { action: "unmatched_slot" }
  | { action: "book"; date: string; windowId: string }
  | { action: "suggest"; date: string; windowId: string };

const AVAILABILITY_QUESTION =
  /\b(when do you (have|got)|when are you|what days?( are open| do you have)?|what day do you have|what times?( do you have)?|what do you have|do you have (anything|any|an opening|availability|available)|what(?:'s| is) (your )?(next opening|soonest)|next opening|soonest appointment|when can (you|someone|anybody|a tech)|any (openings?|availability)|what(?:'s| is) available|days? (are )?open|this week)\b/;

const DECLINE_SESSION =
  /\b(never mind|nevermind|don'?t schedule|do not schedule|don'?t need it( anymore)?|i('ll| will) call back|stop scheduling|i changed my mind)\b/;

const REJECT_OFFERED =
  /\b(none of (those|them|these)|neither|something else|different (day|time|one)|what else|any others?|later than that|another (day|time)|not those)\b/;

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

export function isRejectOfferedSlots(text: string) {
  return REJECT_OFFERED.test(text.trim().toLowerCase());
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
  text?: string;
}) {
  if (input.intent.declineIntent || input.intent.cancelIntent || input.intent.humanRequested) return false;
  if (input.intent.availabilityAsk || input.intent.availabilitySearchRequested) return true;
  if (input.text && isRejectOfferedSlots(input.text)) return true;
  if (input.previousMissing === "slot_selection") return false;
  if (input.previousMissing === "name" || input.previousMissing === "address" || input.previousMissing === "property") {
    return false;
  }
  if (input.intent.requestedDate || input.intent.requestedWindowId || input.intent.requestedStartMinutes != null) {
    return false;
  }
  return input.previousMissing === "date";
}

export function shouldFetchNextAvailability(input: {
  intent: SchedulingIntent;
  previousMissing?: string | null;
  offeredSlots?: OfferedSlot[];
  text?: string;
  selectedSlot?: OfferedSlot | null;
}) {
  if (input.selectedSlot) return false;
  if (input.previousMissing === "name" || input.previousMissing === "address" || input.previousMissing === "property") {
    return false;
  }
  if (input.previousMissing === "slot_selection" && (input.offeredSlots?.length ?? 0) > 0) {
    if (input.intent.availabilityAsk || input.intent.availabilitySearchRequested) return true;
    if (input.text && isRejectOfferedSlots(input.text)) return true;
    return false;
  }
  return shouldSearchAvailability(input);
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

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function clockToMinutes(hours: number, minutes: number, period?: string | null) {
  let value = hours;
  const suffix = (period || "").toLowerCase();
  if (suffix === "pm" && value < 12) value += 12;
  if (suffix === "am" && value === 12) value = 0;
  if (!suffix && value >= 1 && value <= 7) value += 12;
  return value * 60 + minutes;
}

function parseDayNumber(value: string) {
  const day = Number(value);
  return day >= 1 && day <= 31 ? day : null;
}

function filterByCalendarDate(offers: OfferedSlot[], text: string) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const key = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return offers.filter((slot) => slot.date === key);
  }
  const monthNames = Object.keys(MONTH_INDEX).sort((a, b) => b.length - a.length).join("|");
  const monthDay = text.match(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (monthDay) {
    const month = MONTH_INDEX[monthDay[1]!];
    const day = parseDayNumber(monthDay[2]!);
    if (month && day) {
      return offers.filter((slot) => {
        const [, slotMonth, slotDay] = slot.date.split("-").map(Number);
        return slotMonth === month && slotDay === day;
      });
    }
  }
  const ordinal = text.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (ordinal) {
    const day = parseDayNumber(ordinal[1]!);
    if (day) {
      const byDay = offers.filter((slot) => Number(slot.date.slice(-2)) === day);
      if (byDay.length) return byDay;
    }
  }
  return offers;
}

function filterByWeekday(offers: OfferedSlot[], text: string) {
  const weekdayHits = Object.entries(WEEKDAY_INDEX).filter(([name]) => new RegExp(`\\b${name}\\b`).test(text));
  if (weekdayHits.length !== 1) return offers;
  const weekday = weekdayHits[0]![1];
  return offers.filter((slot) => weekdayFromDateKey(slot.date) === weekday);
}

function filterByDaypart(offers: OfferedSlot[], text: string) {
  const hasClock = /\b\d{1,2}(?::\d{2})?\s*(am|pm)?\b/.test(text) && /\b(to|-|–|—|from)\b/.test(text);
  if (/\b(morning)\b/.test(text) && !hasClock) {
    return offers.filter((slot) => slot.startMinutes < 12 * 60);
  }
  if (/\b(afternoon|evening)\b/.test(text) && !hasClock) {
    return offers.filter((slot) => slot.startMinutes >= 12 * 60);
  }
  return offers;
}

function filterByWindow(offers: OfferedSlot[], text: string) {
  const range = text.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!range) return offers;
  const start = clockToMinutes(Number(range[1]), Number(range[2] ?? 0), range[3] || range[6]);
  const end = clockToMinutes(Number(range[4]), Number(range[5] ?? 0), range[6] || range[3]);
  const byWindow = offers.filter((slot) => {
    const startMatch = slot.startMinutes === start || (start >= slot.startMinutes && start < slot.endMinutes);
    const endMatch = !end || slot.endMinutes === end || Math.abs(slot.endMinutes - end) <= 60;
    return startMatch && endMatch;
  });
  return byWindow.length ? byWindow : offers;
}

function ordinalMatch(text: string, offers: OfferedSlot[]): OfferedSlot | null {
  if (/\b(earliest|soonest|first available|the earliest one)\b/.test(text)) return offers[0] ?? null;
  if (/\b(option\s*(1|one)|first( one| option)?|1st|that first one)\b/.test(text)) return offers[0] ?? null;
  if (/\b(option\s*(2|two)|second( one| option)?|2nd)\b/.test(text)) return offers[1] ?? null;
  if (/\b(option\s*(3|three)|third( one| option)?|3rd)\b/.test(text)) return offers[2] ?? null;
  if (/\b(option\s*(4|four)|fourth( one| option)?|4th|last one|the last)\b/.test(text)) {
    return offers[3] ?? offers[offers.length - 1] ?? null;
  }
  return null;
}

function finishSelection(matches: OfferedSlot[], original: OfferedSlot[]): SlotSelectionResult {
  if (matches.length === 1) return { kind: "match", slot: matches[0]! };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  return { kind: "none" };
}

export function resolveOfferedSlotSelection(text: string, offers: OfferedSlot[]): SlotSelectionResult {
  if (!offers.length) return { kind: "none" };
  const lower = text.trim().toLowerCase().replace(/[’']/g, "'");

  const ordinal = ordinalMatch(lower, offers);
  if (ordinal) return { kind: "match", slot: ordinal };

  const affirmation =
    /\b(that one|that works|sounds good|yes|yeah|yep|yup|sure|ok|okay|let'?s do (it|that)|book it|perfect|works for me|i('ll| will) take (it|that)|i would take that)\b/.test(
      lower
    );
  const hasSpecific =
    /\b(morning|afternoon|evening|sunday|monday|tuesday|wednesday|thursday|friday|saturday|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|\d{1,2}(?:st|nd|rd|th)?)\b/.test(
      lower
    );
  if (affirmation && !hasSpecific) {
    if (offers.length === 1) return { kind: "match", slot: offers[0]! };
    return { kind: "ambiguous", candidates: offers };
  }

  const byDate = filterByCalendarDate(offers, lower);
  const byWeekday = filterByWeekday(byDate, lower);
  const byDaypart = filterByDaypart(byWeekday, lower);
  const byWindow = filterByWindow(byDaypart, lower);
  return finishSelection(byWindow, offers);
}

export function matchOfferedSlot(text: string, offers: OfferedSlot[]): OfferedSlot | null {
  const result = resolveOfferedSlotSelection(text, offers);
  return result.kind === "match" ? result.slot : null;
}

function decideBookOrSuggest(canAutoBook: boolean, date: string, windowId: string): SchedulingTurnAction {
  return canAutoBook ? { action: "book", date, windowId } : { action: "suggest", date, windowId };
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
  const awaitingSlot = input.previous?.missingField === "slot_selection" && offered.length > 0;
  const selection = input.text ? resolveOfferedSlotSelection(input.text, offered) : { kind: "none" as const };
  const rejectOffered = Boolean(input.text && isRejectOfferedSlots(input.text));

  if (awaitingSlot && !intent.availabilityAsk && !intent.availabilitySearchRequested && !rejectOffered) {
    if (selection.kind === "match") return decideBookOrSuggest(input.canAutoBook, selection.slot.date, selection.slot.windowId);
    if (selection.kind === "ambiguous") return { action: "clarify_slots", slots: selection.candidates };
    if (selection.kind === "none") return { action: "unmatched_slot" };
  }

  if (selection.kind === "match") {
    return decideBookOrSuggest(input.canAutoBook, selection.slot.date, selection.slot.windowId);
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
    return decideBookOrSuggest(input.canAutoBook, intent.requestedDate, intent.requestedWindowId);
  }

  if (intent.requestedWindowId && !intent.requestedDate) {
    const match = [...input.todaySlots, ...input.nextSlots].find((slot) => slot.windowId === intent.requestedWindowId);
    if (match) return decideBookOrSuggest(input.canAutoBook, match.date, match.windowId);
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
    text: input.text,
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
    return decideBookOrSuggest(input.canAutoBook, slots[0]!.date, slots[0]!.windowId);
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
