import { differenceInCalendarDays } from "date-fns";

const OPT_OUT_TAGS = new Set(["opt-out", "optout", "do-not-text", "donottext", "sms-opt-out", "do not text"]);

export function customerDisplayName(customer: {
  firstName: string;
  lastName: string;
  businessName?: string | null;
}) {
  const person = `${customer.firstName} ${customer.lastName}`.trim();
  return customer.businessName?.trim() || person || "Customer";
}

export function firstNameOf(customer: { firstName: string; businessName?: string | null }) {
  return customer.firstName.trim() || customer.businessName?.trim() || "there";
}

export function daysSince(date: Date | null | undefined, now = new Date()) {
  if (!date) return 0;
  return Math.max(0, differenceInCalendarDays(now, date));
}

export function daysUntil(date: Date | null | undefined, now = new Date()) {
  if (!date) return null;
  return differenceInCalendarDays(date, now);
}

export function isSmsOptedOut(customer: { tags?: string[]; preferredContactMethod?: string | null }) {
  const tags = (customer.tags ?? []).map((tag) => tag.trim().toLowerCase());
  if (tags.some((tag) => OPT_OUT_TAGS.has(tag))) return true;
  return false;
}

export function smsRecipient(customer: { phone?: string | null; secondaryPhone?: string | null }) {
  return customer.phone?.trim() || customer.secondaryPhone?.trim() || null;
}

export function estimateStillOpen(status: string) {
  return status === "SENT" || status === "VIEWED";
}

export function invoiceStillCollectible(status: string, balanceCents: number) {
  if (balanceCents <= 0) return false;
  return status === "SENT" || status === "PARTIALLY_PAID" || status === "OVERDUE";
}

export function parseMoneyHint(question: string) {
  const match = question.match(/\$\s*([\d,]+)(?:\.\d+)?|\bover\s+([\d,]+)\b/i);
  const raw = (match?.[1] || match?.[2] || "").replaceAll(",", "");
  if (!raw) return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 50) return null;
  return Math.round(dollars * 100);
}

export function parseDaysHint(question: string, fallback: number) {
  const match = question.match(/(\d+)\s+days?/i);
  if (!match) return fallback;
  const days = Number(match[1]);
  return Number.isFinite(days) ? Math.min(365, Math.max(0, days)) : fallback;
}

export function parseCountHint(question: string, fallback: number) {
  const match = question.match(/\b(five|5|six|6|ten|10|three|3)\b/i);
  if (!match) return fallback;
  const word = match[1].toLowerCase();
  if (word === "five" || word === "5") return 5;
  if (word === "six" || word === "6") return 6;
  if (word === "ten" || word === "10") return 10;
  if (word === "three" || word === "3") return 3;
  return fallback;
}
