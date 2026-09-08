import type { LeadStatus } from "@prisma/client";

export type LeadFollowUpReason =
  | "no_contact"
  | "estimate_no_followup"
  | "customer_replied"
  | "next_action_overdue";

export type LeadFollowUpInput = {
  status: LeadStatus;
  receivedAt: Date;
  firstRespondedAt?: Date | null;
  lastContactAt?: Date | null;
  nextActionAt?: Date | null;
  estimateStatus?: string | null;
  estimateUpdatedAt?: Date | null;
  inboundUnanswered?: boolean;
};

const CLOSED: LeadStatus[] = ["WON", "LOST", "SPAM"];

export function leadNeedsFollowUp(input: LeadFollowUpInput, now = new Date()): LeadFollowUpReason | null {
  if (CLOSED.includes(input.status)) return null;

  if (input.nextActionAt && input.nextActionAt.getTime() < now.getTime()) {
    return "next_action_overdue";
  }

  if (input.inboundUnanswered) return "customer_replied";

  const noContact = !input.firstRespondedAt && !input.lastContactAt;
  if (noContact && (input.status === "NEW" || input.status === "CONTACTED")) {
    return "no_contact";
  }

  if (input.status === "ESTIMATE_SENT" || input.estimateStatus === "SENT") {
    const last = input.lastContactAt;
    const sentAt = input.estimateUpdatedAt;
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    if (!last) return "estimate_no_followup";
    if (sentAt && last.getTime() <= sentAt.getTime()) return "estimate_no_followup";
    if (now.getTime() - last.getTime() >= twoDays) return "estimate_no_followup";
  }

  return null;
}

export function followUpLabel(reason: LeadFollowUpReason) {
  switch (reason) {
    case "no_contact":
      return "No contact attempt";
    case "estimate_no_followup":
      return "Estimate needs follow-up";
    case "customer_replied":
      return "Customer replied";
    case "next_action_overdue":
      return "Next action overdue";
  }
}

export function followUpAsk(reason: LeadFollowUpReason, name: string) {
  switch (reason) {
    case "no_contact":
      return `Why does ${name} need a first contact attempt?`;
    case "estimate_no_followup":
      return `Why does ${name}'s estimate need a follow-up?`;
    case "customer_replied":
      return `Why does ${name} need a response?`;
    case "next_action_overdue":
      return `Why is the next action for ${name} overdue?`;
  }
}
