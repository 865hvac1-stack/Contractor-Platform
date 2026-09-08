import { formatMoney } from "@/lib/money";

export type OfficeIntelligenceItem = {
  id: string;
  label: string;
  summary: string;
  href: string;
  actionHref: string;
  actionLabel: string;
  askQuestion: string;
  count: number;
  amountCents: number | null;
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
      href: "/estimates?status=followup&source=hub&view=followup",
      actionHref: "/attention?filter=follow_ups&type=estimate_not_followed_up",
      actionLabel: "Prepare follow-ups",
      askQuestion: "Why are these estimates considered follow-up opportunities?",
      count: input.followUpCount,
      amountCents: input.followUpValueCents,
    });
  }

  if (input.approvedNotScheduled > 0) {
    rows.push({
      id: "scheduling_opportunity",
      label: "Scheduling opportunity",
      summary:
        input.approvedValueCents > 0
          ? `${input.approvedNotScheduled} approved estimate${input.approvedNotScheduled === 1 ? "" : "s"} totaling ${formatMoney(input.approvedValueCents)} have not been scheduled.`
          : `${input.approvedNotScheduled} approved estimate${input.approvedNotScheduled === 1 ? "" : "s"} have not been scheduled.`,
      href: "/estimates?status=approved&source=hub&view=schedule",
      actionHref: "/dispatch",
      actionLabel: "Schedule",
      askQuestion: "Why do these approved estimates still need scheduling?",
      count: input.approvedNotScheduled,
      amountCents: input.approvedValueCents > 0 ? input.approvedValueCents : null,
    });
  }

  if (input.overdueCount > 0 && input.overdueBalanceCents > 0) {
    rows.push({
      id: "collection_risk",
      label: "Collection risk",
      summary: `${formatMoney(input.overdueBalanceCents)} overdue across ${input.overdueCount} invoice${input.overdueCount === 1 ? "" : "s"}.`,
      href: "/invoices?status=overdue&source=hub&view=overdue",
      actionHref: "/invoices?status=overdue&source=hub&view=overdue",
      actionLabel: "Review",
      askQuestion: "Why is this overdue A/R a collection risk?",
      count: input.overdueCount,
      amountCents: input.overdueBalanceCents,
    });
  }

  if (input.unansweredLeads > 0) {
    rows.push({
      id: "customer_response",
      label: "Customer response",
      summary: `${input.unansweredLeads} lead${input.unansweredLeads === 1 ? "" : "s"} have not received a response.`,
      href: "/marketing/leads?needsResponse=1",
      actionHref: "/marketing/communications?filter=needs-response",
      actionLabel: "Respond",
      askQuestion: "Why have these leads not received a response?",
      count: input.unansweredLeads,
      amountCents: null,
    });
  }

  return rows.slice(0, 4);
}
