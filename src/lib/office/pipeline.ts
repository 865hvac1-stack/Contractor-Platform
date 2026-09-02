export type OfficePipelineStage = {
  id: string;
  label: string;
  count: number;
  href: string;
};

export function buildOfficePipeline(input: {
  newLeads: number;
  contactedLeads: number;
  bookedLeads: number;
  estimateFollowUp: number;
  approvedNotScheduled: number;
  paymentFollowUp: number;
}): OfficePipelineStage[] {
  return [
    {
      id: "new_leads",
      label: "New leads",
      count: input.newLeads,
      href: "/marketing/leads?status=NEW",
    },
    {
      id: "contacted",
      label: "Contacted",
      count: input.contactedLeads,
      href: "/marketing/leads?status=CONTACTED",
    },
    {
      id: "booked",
      label: "Booked",
      count: input.bookedLeads,
      href: "/marketing/leads?status=BOOKED",
    },
    {
      id: "estimate_follow_up",
      label: "Estimate follow-up",
      count: input.estimateFollowUp,
      href: "/attention?filter=follow_ups&type=estimate_not_followed_up",
    },
    {
      id: "approved_scheduling",
      label: "Approved / needs scheduling",
      count: input.approvedNotScheduled,
      href: "/estimates?status=approved",
    },
    {
      id: "payment_follow_up",
      label: "Payment follow-up",
      count: input.paymentFollowUp,
      href: "/invoices?status=overdue",
    },
  ];
}
