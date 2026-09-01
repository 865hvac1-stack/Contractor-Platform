import { formatMoney } from "@/lib/money";

export type OfficeIntelligenceItem = {
  id: string;
  label: string;
  summary: string;
  href: string;
  actionLabel: string;
  askQuestion: string;
};

export function buildOfficeIntelligence(input: {
  followUpCount: number;
  followUpValueCents: number;
  approvedNotScheduled: number;
  approvedValueCents: number;
  overdueBalanceCents: number;
  overdueCount: number;
  unansweredLeads: number;
}): OfficeIntelligenceItem[] {
  const rows: OfficeIntelligenceItem[] = [];

  if (input.followUpCount > 0 && input.followUpValueCents > 0) {
    rows.push({
      id: "sales_opportunity",
      label: "Sales opportunity",
      summary: `${input.followUpCount} estimate${input.followUpCount === 1 ? "" : "s"} totaling ${formatMoney(input.followUpValueCents)} need follow-up.`,
      href: "/attention?filter=follow_ups&type=estimate_not_followed_up",
      actionLabel: "Prepare follow-ups",
      askQuestion: "Which estimates should we call?",
    });
  }

  if (input.approvedNotScheduled > 0) {
    rows.push({
      id: "scheduling_opportunity",
      label: "Scheduling opportunity",
      summary:
        input.approvedValueCents > 0
          ? `${input.approvedNotScheduled} approved estimate${input.approvedNotScheduled === 1 ? "" : "s"} (${formatMoney(input.approvedValueCents)}) have not been scheduled.`
          : `${input.approvedNotScheduled} approved estimate${input.approvedNotScheduled === 1 ? "" : "s"} have not been scheduled.`,
      href: "/estimates?status=approved",
      actionLabel: "Schedule",
      askQuestion: "What approved work needs scheduling?",
    });
  }

  if (input.overdueCount > 0 && input.overdueBalanceCents > 0) {
    rows.push({
      id: "collection_risk",
      label: "Collection risk",
      summary: `${formatMoney(input.overdueBalanceCents)} is overdue across ${input.overdueCount} invoice${input.overdueCount === 1 ? "" : "s"}.`,
      href: "/invoices?status=overdue",
      actionLabel: "Review",
      askQuestion: "Who owes us money?",
    });
  }

  if (input.unansweredLeads > 0) {
    rows.push({
      id: "customer_response",
      label: "Customer response",
      summary: `${input.unansweredLeads} lead${input.unansweredLeads === 1 ? "" : "s"} have not received a response.`,
      href: "/marketing/leads?status=NEW",
      actionLabel: "Respond",
      askQuestion: "Which leads have not been answered?",
    });
  }

  return rows.slice(0, 4);
}
