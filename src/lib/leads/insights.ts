import { formatMoney } from "@/lib/money";
import { formatDurationMinutes, formatLeadStamp, leadDisplayName, leadSourceLabel } from "@/lib/leads/format";
import { followUpLabel, leadNeedsFollowUp, type LeadFollowUpReason } from "@/lib/leads/follow-up";
import type { LeadSource, LeadStatus } from "@prisma/client";

export type LeadInsightFact = {
  id: string;
  text: string;
};

export type LeadVerifiedFacts = {
  id: string;
  firstName: string;
  lastName: string;
  status: LeadStatus;
  source: LeadSource;
  receivedAt: Date;
  firstRespondedAt?: Date | null;
  lastContactAt?: Date | null;
  nextAction?: string | null;
  nextActionAt?: Date | null;
  assignedName?: string | null;
  opportunityCents?: number | null;
  customerName?: string | null;
  estimateNumber?: string | null;
  estimateStatus?: string | null;
  estimateUpdatedAt?: Date | null;
  inboundUnanswered?: boolean;
  lastInboundPreview?: string | null;
};

export function buildLeadInsights(facts: LeadVerifiedFacts, now = new Date()): LeadInsightFact[] {
  const insights: LeadInsightFact[] = [];
  const reason = leadNeedsFollowUp(facts, now);
  if (reason === "no_contact") {
    const ageMs = now.getTime() - facts.receivedAt.getTime();
    insights.push({
      id: "no_contact",
      text: `No contact attempt recorded in ${formatDurationMinutes(ageMs)}.`,
    });
  }
  if (reason === "estimate_no_followup") {
    const since = facts.lastContactAt ?? facts.estimateUpdatedAt ?? facts.receivedAt;
    insights.push({
      id: "estimate_followup",
      text: `Estimate${facts.estimateNumber ? ` ${facts.estimateNumber}` : ""} was sent with no follow-up recorded since ${formatLeadStamp(since)}.`,
    });
  }
  if (reason === "customer_replied") {
    insights.push({
      id: "replied",
      text: facts.lastInboundPreview
        ? `Customer replied: "${facts.lastInboundPreview.slice(0, 140)}"`
        : "Customer replied and no response is recorded.",
    });
  }
  if (reason === "next_action_overdue" && facts.nextActionAt) {
    insights.push({
      id: "overdue",
      text: `Next action is overdue${facts.nextAction ? `: ${facts.nextAction}` : ""}.`,
    });
  }

  insights.push({
    id: "source",
    text: `This lead came from ${leadSourceLabel(facts.source)}.`,
  });

  return insights;
}

export function summarizeLeadFacts(facts: LeadVerifiedFacts, now = new Date()) {
  const name = leadDisplayName(facts);
  const age = formatDurationMinutes(now.getTime() - facts.receivedAt.getTime());
  const sentences = [
    `${name} submitted a ${leadSourceLabel(facts.source)} lead ${age} ago.`,
  ];
  const reason = leadNeedsFollowUp(facts, now);
  if (reason === "no_contact") sentences.push("No contact attempt is recorded.");
  else if (facts.firstRespondedAt) sentences.push(`First response was recorded on ${formatLeadStamp(facts.firstRespondedAt)}.`);
  else if (facts.lastContactAt) sentences.push(`Last contact was recorded on ${formatLeadStamp(facts.lastContactAt)}.`);
  if (facts.assignedName) sentences.push(`Assigned to ${facts.assignedName}.`);
  if (facts.opportunityCents != null) {
    sentences.push(`Opportunity value is ${formatMoney(facts.opportunityCents)}.`);
  }
  if (facts.customerName) sentences.push(`Linked customer: ${facts.customerName}.`);
  if (facts.estimateNumber) {
    sentences.push(
      `Estimate ${facts.estimateNumber}${facts.estimateStatus ? ` is ${facts.estimateStatus.replaceAll("_", " ").toLowerCase()}` : ""}.`
    );
  }
  if (facts.nextAction) sentences.push(`Next action: ${facts.nextAction}.`);
  if (reason && reason !== "no_contact") sentences.push(`${followUpLabel(reason)}.`);
  return sentences.join(" ");
}

export function buildVerifiedLeadNotes(facts: LeadVerifiedFacts, now = new Date()) {
  return [
    `Lead name: ${leadDisplayName(facts)}`,
    `Status: ${facts.status}`,
    `Source: ${leadSourceLabel(facts.source)}`,
    `Created: ${formatLeadStamp(facts.receivedAt)}`,
    facts.firstRespondedAt ? `First response: ${formatLeadStamp(facts.firstRespondedAt)}` : "First response: none recorded",
    facts.lastContactAt ? `Last contact: ${formatLeadStamp(facts.lastContactAt)}` : "Last contact: none recorded",
    facts.assignedName ? `Assigned: ${facts.assignedName}` : "Assigned: unassigned",
    facts.opportunityCents != null ? `Opportunity: ${formatMoney(facts.opportunityCents)}` : "Opportunity: unknown",
    facts.customerName ? `Customer: ${facts.customerName}` : "Customer: not linked",
    facts.estimateNumber
      ? `Estimate: ${facts.estimateNumber}${facts.estimateStatus ? ` (${facts.estimateStatus})` : ""}`
      : "Estimate: none",
    facts.nextAction ? `Next action: ${facts.nextAction}` : "Next action: none set",
    facts.lastInboundPreview ? `Last inbound message: ${facts.lastInboundPreview}` : "Last inbound message: none recorded",
    `Factual summary: ${summarizeLeadFacts(facts, now)}`,
    "Unknown details must stay unknown. Do not invent intent, budget, equipment, diagnosis, pricing, or appointments.",
  ].join("\n");
}

export function followUpReasonForFacts(facts: LeadVerifiedFacts, now = new Date()): LeadFollowUpReason | null {
  return leadNeedsFollowUp(facts, now);
}
