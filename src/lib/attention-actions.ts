export type AttentionCta = {
  label: string;
  href?: string;
  ask?: string;
  prepare?: boolean;
};

export function attentionCardActions(type: string, entityId: string): AttentionCta[] {
  if (type === "estimate_not_followed_up") {
    return [
      { label: "Review", href: `/estimates/${entityId}` },
      { label: "Prepare follow-ups", prepare: true },
      { label: "Ask AI", ask: "Take care of my estimate follow-ups." },
    ];
  }
  if (type === "approved_estimate_not_scheduled") {
    return [
      { label: "Review", href: `/estimates/${entityId}` },
      { label: "Schedule", href: `/estimates?status=needs_scheduling` },
      { label: "Prepare follow-ups", prepare: true },
    ];
  }
  if (type === "lead_unanswered") {
    return [
      { label: "Respond", href: `/marketing/leads/${entityId}` },
      { label: "Review", href: `/marketing/leads/${entityId}` },
    ];
  }
  if (type === "missed_call_no_follow_up") {
    return [
      { label: "Respond", href: "/marketing/communications?filter=missed" },
      { label: "Review", href: "/marketing/communications?filter=missed" },
    ];
  }
  if (type === "invoice_overdue" || type === "invoice_awaiting_payment") {
    return [
      { label: "Review", href: `/invoices/${entityId}` },
      { label: "Prepare reminder", prepare: true },
      { label: "Ask AI", ask: "Who owes us money?" },
    ];
  }
  if (type === "job_missing_technician") {
    return [
      { label: "Ask AI", ask: "Fix tomorrow's unassigned jobs." },
      { label: "Recommend technician", prepare: true },
      { label: "View", href: `/jobs/${entityId}` },
    ];
  }
  if (type === "job_running_behind") {
    return [
      { label: "Ask AI", ask: "Who is running late?" },
      { label: "View Dispatch", href: "/dispatch" },
      { label: "View", href: `/jobs/${entityId}` },
    ];
  }
  if (type === "membership_needs_review") {
    return [
      { label: "Ask AI", ask: "Follow up with memberships expiring this month." },
      { label: "Draft renewal", prepare: true },
      { label: "View", href: `/memberships` },
    ];
  }
  return [{ label: "View", href: undefined }];
}
