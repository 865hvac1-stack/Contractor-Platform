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
  const stages: OfficePipelineStage[] = [];

  if (input.newLeads > 0) {
    stages.push({
      id: "new_leads",
      label: "New leads",
      count: input.newLeads,
      href: "/marketing/leads?status=NEW",
    });
  }
  if (input.contactedLeads > 0) {
    stages.push({
      id: "contacted",
      label: "Contacted",
      count: input.contactedLeads,
      href: "/marketing/leads?status=CONTACTED",
    });
  }
  if (input.bookedLeads > 0) {
    stages.push({
      id: "booked",
      label: "Booked",
      count: input.bookedLeads,
      href: "/marketing/leads?status=BOOKED",
    });
  }
  if (input.estimateFollowUp > 0) {
    stages.push({
      id: "estimate_follow_up",
      label: "Estimate follow-up",
      count: input.estimateFollowUp,
      href: "/attention?filter=sales",
    });
  }
  if (input.approvedNotScheduled > 0) {
    stages.push({
      id: "approved_scheduling",
      label: "Approved / needs scheduling",
      count: input.approvedNotScheduled,
      href: "/estimates?status=approved",
    });
  }
  if (input.paymentFollowUp > 0) {
    stages.push({
      id: "payment_follow_up",
      label: "Payment follow-up",
      count: input.paymentFollowUp,
      href: "/invoices?status=overdue",
    });
  }

  return stages;
}
