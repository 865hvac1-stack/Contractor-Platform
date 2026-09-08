import type { AppointmentDaypart } from "@prisma/client";
import type { SchedulingIntent } from "@/lib/scheduling/types";

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
  /\b(when do you have|when are you|what times?( do you have)?|what do you have|do you have (anything|any|an opening|availability)|what(?:'s| is) (your )?next opening|next opening|when can you (get|come|send)|can anyone come|any (openings?|availability)|what(?:'s| is) available)\b/;

const DECLINE_SESSION =
  /\b(never mind|nevermind|don'?t schedule|do not schedule|don'?t need it( anymore)?|i('ll| will) call back|stop scheduling|i changed my mind)\b/;

export function isAvailabilityQuestion(text: string) {
  return AVAILABILITY_QUESTION.test(text.trim().toLowerCase());
}

export function isDeclineScheduling(text: string) {
  return DECLINE_SESSION.test(text.trim().toLowerCase());
}

export function isSchedulingTurn(intent: SchedulingIntent) {
  return Boolean(
    intent.availabilityAsk ||
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

export function shouldOfferSlots(intent: SchedulingIntent, matchingCount: number) {
  if (intent.declineIntent || intent.humanRequested || intent.cancelIntent) return false;
  if (intent.availabilityAsk && !intent.requestedWindowId) return true;
  if (!intent.requestedDate && !intent.requestedWindowId) return false;
  if (intent.requestedWindowId && intent.requestedDate) return false;
  return matchingCount !== 1;
}

export function resolveSchedulingTurn(input: {
  previous: { status: string; paused: boolean } | null;
  intent: SchedulingIntent;
  canAutoBook: boolean;
  todayKey: string;
  todaySlots: OfferedSlot[];
  requestedSlots: OfferedSlot[];
  nextSlots: OfferedSlot[];
}): SchedulingTurnAction {
  const intent = input.intent;
  if (intent.declineIntent && !intent.cancelIntent) return { action: "close" };
  if (intent.humanRequested) return { action: "handoff", reason: "human_requested" };

  if (intent.requestedWindowId && intent.requestedDate) {
    const stillOpen = input.requestedSlots.some(
      (slot) => slot.windowId === intent.requestedWindowId && slot.date === intent.requestedDate
    );
    if (!stillOpen) {
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
    return {
      action: "offer_slots",
      slots: input.nextSlots,
      todayWasFull: input.todaySlots.length === 0,
      requestedLabel: null,
    };
  }

  if (intent.availabilityAsk || (input.previous && !intent.requestedDate && !intent.requestedDaypart)) {
    const primary = intent.requestedDate ? input.requestedSlots : input.todaySlots;
    const slots = primary.length ? primary : input.nextSlots;
    if (slots.length === 1 && intent.requestedDate && !intent.availabilityAsk) {
      return input.canAutoBook
        ? { action: "book", date: slots[0].date, windowId: slots[0].windowId }
        : { action: "suggest", date: slots[0].date, windowId: slots[0].windowId };
    }
    if (slots.length) {
      return {
        action: "offer_slots",
        slots,
        todayWasFull: input.todaySlots.length === 0,
        requestedLabel: intent.requestedDate ?? null,
      };
    }
    return {
      action: "offer_slots",
      slots: [],
      todayWasFull: input.todaySlots.length === 0,
      requestedLabel: intent.requestedDate ?? "right now",
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
      ? { action: "book", date: slots[0].date, windowId: slots[0].windowId }
      : { action: "suggest", date: slots[0].date, windowId: slots[0].windowId };
  }
  if (slots.length > 1) {
    return {
      action: "offer_slots",
      slots,
      todayWasFull: Boolean(intent.requestedDate && intent.requestedDate !== input.todayKey && input.todaySlots.length === 0),
      requestedLabel: intent.requestedDate ?? null,
    };
  }
  return {
    action: "offer_slots",
    slots: input.nextSlots,
    todayWasFull: input.todaySlots.length === 0,
    requestedLabel: intent.requestedDate ?? null,
  };
}
