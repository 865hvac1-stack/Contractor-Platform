export type AttentionCta = {
  label: string;
  href?: string;
  ask?: string;
  prepare?: boolean;
};

export function attentionCardActions(type: string, entityId: string): AttentionCta[] {
  if (type === "estimate_not_followed_up") {
    return [
      { label: "Ask AI", ask: "Take care of my estimate follow-ups." },
      { label: "Draft follow-up", prepare: true },
      { label: "View", href: `/estimates/${entityId}` },
    ];
  }
  if (type === "invoice_overdue" || type === "invoice_awaiting_payment") {
    return [
      { label: "Ask AI", ask: "Who owes us money?" },
      { label: "Draft reminder", prepare: true },
      { label: "View", href: `/invoices/${entityId}` },
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
