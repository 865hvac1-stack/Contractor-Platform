import { formatClockMinutes, formatLocalDateShort, formatWindowChip } from "@/lib/scheduling/time";
import type { SchedulingPolicyView } from "@/lib/scheduling/types";

function applyVars(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

export function confirmationMessage(input: {
  policy: SchedulingPolicyView;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  technicianName?: string | null;
  timeZone: string;
}) {
  const window = `${formatClockMinutes(input.startMinutes)}–${formatClockMinutes(input.endMinutes)}`;
  const when = formatLocalDateShort(input.dateKey, input.timeZone);
  const vars = {
    when,
    window,
    technician: input.technicianName || "",
  };
  if (input.policy.confirmationTemplate) return applyVars(input.policy.confirmationTemplate, vars);
  if (input.policy.showTechnicianName && input.technicianName) {
    return `You’re all set with ${input.technicianName} for ${when} between ${window}. We’ll text you when your technician is on the way.`;
  }
  return `You’re all set for ${when} between ${window}. We’ll text you when your technician is on the way.`;
}

export function noAvailabilityMessage(input: {
  policy: SchedulingPolicyView;
  requestedLabel: string;
  alternatives: Array<{ dateKey: string; startMinutes: number; endMinutes: number; timeZone: string }>;
}) {
  const alts = input.alternatives
    .map((row) => `${formatLocalDateShort(row.dateKey, row.timeZone)} ${formatClockMinutes(row.startMinutes)}–${formatClockMinutes(row.endMinutes)}`)
    .join(" or ");
  if (input.policy.noAvailabilityTemplate) {
    return applyVars(input.policy.noAvailabilityTemplate, { requested: input.requestedLabel, alternatives: alts });
  }
  if (!alts) {
    return `We’re full ${input.requestedLabel}. I don’t see another open window that matches your request yet — an office teammate can help find the next opening.`;
  }
  return `We’re full ${input.requestedLabel}, but we have ${alts} available. Would either work?`;
}

export function clarificationMessage(input: {
  policy: SchedulingPolicyView;
  missing: "date" | "daypart" | "window" | "appointment" | "service" | "slot_selection" | "name" | "address" | "property";
}) {
  if (input.policy.clarificationTemplate && !["name", "address", "property", "slot_selection"].includes(input.missing)) {
    return input.policy.clarificationTemplate;
  }
  if (input.missing === "daypart") return "Absolutely. Do you prefer morning or afternoon?";
  if (input.missing === "date") return "Happy to get you on the calendar. What day works best?";
  if (input.missing === "slot_selection") return "Which of those openings works best?";
  if (input.missing === "name") return "Absolutely. What’s your name?";
  if (input.missing === "address") return "What’s the service address?";
  if (input.missing === "property") return "Which property is this service call for?";
  if (input.missing === "appointment") return "You have more than one upcoming appointment. Which one should we change?";
  if (input.missing === "service") return "I can schedule that. Is this a service call or a maintenance visit?";
  return "I want to get this right — what day and time window works for you?";
}

export function askNameMessage() {
  return "Absolutely. What’s your name?";
}

export function askNameBeforeFinishingSchedule() {
  return "Absolutely. Before I finish scheduling that, what's your name?";
}

export function contractorYouBookingConfirmation(input: { appointmentDisplay: string; propertyAddress?: string | null }) {
  const address = input.propertyAddress?.trim();
  if (address) return `Perfect — you're scheduled for ${input.appointmentDisplay} at ${address}.`;
  return `Perfect — you're scheduled for ${input.appointmentDisplay}.`;
}

export function thanksNameAskAddressMessage(firstName: string) {
  return `Thanks, ${firstName}. What’s the service address?`;
}

export function askAddressMessage() {
  return "What’s the address for the service call?";
}

export function askWhichPropertyMessage(labels: string[]) {
  if (labels.length === 2) return `Is this for ${labels[0]} or ${labels[1]}?`;
  if (labels.length > 2) return `Which property is this for — ${labels.join(", ")}?`;
  return "Which property is this service call for?";
}

export function clarifyOfferedSlotsMessage(input: {
  slots: Array<{ dateKey: string; startMinutes: number; endMinutes: number; timeZone: string }>;
}) {
  const labeled = input.slots.map(
    (row) => `${formatLocalDateShort(row.dateKey, row.timeZone)} ${formatClockMinutes(row.startMinutes)}–${formatClockMinutes(row.endMinutes)}`
  );
  if (labeled.length === 1) return `Just to confirm — would you like ${labeled[0]}?`;
  if (labeled.length === 2) {
    return `I have two openings that match — ${labeled[0]} or ${labeled[1]}. Which one would you like?`;
  }
  return `Which of these works: ${labeled.join(", ")}?`;
}

export function unmatchedOfferedSlotMessage() {
  return "I didn’t catch which opening you wanted. What day and time works for you?";
}

export function slotTakenMessage() {
  return "Sorry, that one was just taken. Let me grab the next available options for you.";
}

export function maintenanceDuplicateMessage(input: {
  policy: SchedulingPolicyView;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  timeZone: string;
}) {
  const when = `${formatLocalDateShort(input.dateKey, input.timeZone)} between ${formatClockMinutes(input.startMinutes)}–${formatClockMinutes(input.endMinutes)}`;
  if (input.policy.maintenanceDuplicateTemplate) {
    return applyVars(input.policy.maintenanceDuplicateTemplate, { when });
  }
  return `You already have a maintenance visit scheduled for ${when}. Would you like to keep that appointment or change it?`;
}

export function noPlanMessage(input: { policy: SchedulingPolicyView }) {
  if (input.policy.noPlanTemplate) return input.policy.noPlanTemplate;
  return "You don’t currently have a maintenance plan on file. Would you like information about setting one up?";
}

export function suggestedBookingMessage(input: {
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  timeZone: string;
}) {
  const when = formatLocalDateShort(input.dateKey, input.timeZone);
  const window = `${formatClockMinutes(input.startMinutes)}–${formatClockMinutes(input.endMinutes)}`;
  return `I found an opening ${when} between ${window}. An office teammate will confirm that appointment shortly.`;
}

export function cancelConfirmationMessage(when: string) {
  return `Your appointment for ${when} has been canceled. If you want to reschedule, just text us a day and time that works.`;
}

export function officeReviewMessage() {
  return "I’ve asked the office to take a look at your request. Someone from our team will text you back shortly.";
}

export function offerSlotsMessage(input: {
  slots: Array<{ dateKey: string; startMinutes: number; endMinutes: number; timeZone: string }>;
  todayKey: string;
  todayWasFull?: boolean;
  keepGoing?: boolean;
}) {
  const labeled = input.slots.map((row) => ({
    ...row,
    chip: formatWindowChip(row.startMinutes, row.endMinutes),
    day: formatLocalDateShort(row.dateKey, row.timeZone),
  }));
  const prefix = input.keepGoing ? "I can finish getting you scheduled. " : "";
  if (!labeled.length) {
    return `${prefix}I don’t see an open window that matches that request yet. I’ll have the office help find the next opening.`;
  }
  const sameDay = labeled.every((row) => row.dateKey === labeled[0]?.dateKey);
  if (sameDay && labeled[0]?.dateKey === input.todayKey) {
    return `${prefix}We have ${labeled.map((row) => row.chip).join(" or ")} available today. Which works better?`;
  }
  if (sameDay && input.todayWasFull) {
    return `${prefix}We’re full today, but I have ${labeled.map((row) => row.chip).join(" or ")} ${labeled[0]?.day}. Would either work?`;
  }
  if (sameDay) {
    return `${prefix}I have ${labeled.map((row) => row.chip).join(" or ")} available ${labeled[0]?.day}. Which works better?`;
  }
  return `${prefix}I have ${labeled.map((row) => `${row.day} ${row.chip}`).join(" or ")} available. Which works better?`;
}

export function sessionClosedMessage() {
  return "No problem — I won’t schedule anything. Text us when you want to get on the calendar.";
}

export function noOpenWindowsMessage() {
  return "I don’t see an open service window right now. I’ll have the office help with scheduling.";
}
