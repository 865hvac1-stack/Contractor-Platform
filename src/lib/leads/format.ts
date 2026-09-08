import { formatDistanceToNow } from "date-fns";
import { formatDateTime } from "@/lib/datetime";
import type { LeadSource, LeadStatus } from "@prisma/client";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/leads/sources";

export function leadDisplayName(lead: { firstName: string; lastName: string }) {
  return `${lead.firstName} ${lead.lastName}`.trim();
}

export function leadAgeLabel(receivedAt: Date) {
  return formatDistanceToNow(receivedAt, { addSuffix: false });
}

export function leadAgeShort(receivedAt: Date) {
  return `${leadAgeLabel(receivedAt)} old`;
}

export function formatLeadStamp(value: Date, timeZone?: string | null) {
  return formatDateTime(value, timeZone);
}

export function formatLeadDateTime(value: Date, timeZone?: string | null) {
  return formatDateTime(value, timeZone);
}

export function leadSourceLabel(source: LeadSource) {
  return LEAD_SOURCE_LABELS[source] ?? source;
}

export function leadStatusLabel(status: LeadStatus) {
  return LEAD_STATUS_LABELS[status] ?? status;
}

export function formatDurationMinutes(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
