import type { RankedAttention } from "@/lib/attention-priority";

const HEADLINES: Record<string, string> = {
  job_missing_technician: "Job needs technician",
  job_missing_invoice: "Completed job needs invoice",
  job_missing_completion: "Job may need completion",
  job_running_behind: "Job running behind",
  waiting_update_failed: "Customer update failed",
  waiting_ready_to_schedule: "Ready to schedule",
  waiting_expected_date_passed: "Part overdue",
  waiting_warranty_overdue: "Warranty response overdue",
  waiting_customer_replied: "Customer replied",
  waiting_too_long: "Waiting too long",
  estimate_not_followed_up: "Estimate follow-up",
  approved_estimate_not_scheduled: "Approved work not scheduled",
  invoice_overdue: "Overdue invoice",
  invoice_awaiting_payment: "Invoice awaiting payment",
  payment_failed: "Payment failed",
  lead_unanswered: "Lead needs a reply",
  missed_call_no_follow_up: "Missed call",
};

const ACTIONS: Record<string, string> = {
  job_missing_technician: "Assign Technician",
  waiting_update_failed: "Fix Now",
  waiting_ready_to_schedule: "Schedule",
  waiting_expected_date_passed: "Check Part",
  estimate_not_followed_up: "Follow Up",
  approved_estimate_not_scheduled: "Schedule",
  invoice_overdue: "Collect",
  invoice_awaiting_payment: "Collect",
  lead_unanswered: "Contact",
  missed_call_no_follow_up: "Call Back",
};

function looksLikeId(value: string) {
  return /^[A-Z0-9-]{6,}$/i.test(value.trim()) && !value.includes(" ");
}

function jobNumberLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("JOB") || trimmed.startsWith("#") ? trimmed : `Job #${trimmed}`;
}

export function presentAttentionItem(item: RankedAttention) {
  const headline = HEADLINES[item.type] ?? item.title.replace(/\s+/g, " ").trim();
  const rawWho = item.customerName?.trim() || "";
  const description = item.description?.trim() || "";
  const descriptionIsId = looksLikeId(description) && (!rawWho || rawWho === description);
  const who =
    rawWho && rawWho !== description
      ? rawWho
      : descriptionIsId
        ? jobNumberLabel(description)
        : rawWho || description.split("·")[0]?.trim() || "Needs attention";
  let why = description;
  if (descriptionIsId || why === who || why === rawWho) {
    why =
      item.type === "job_missing_technician"
        ? "Needs technician assignment"
        : item.recommendedAction?.replace(/\.$/, "") || "Open and take the next step";
  }
  if (why === headline || why.toLowerCase() === headline.toLowerCase()) {
    why = item.recommendedAction?.replace(/\.$/, "") || why;
  }
  const action = ACTIONS[item.type] ?? (item.recommendedAction || "Open").replace(/\.$/, "").split(" ").slice(0, 3).join(" ");
  return {
    id: item.id,
    href: item.href,
    headline,
    who,
    why,
    action,
    priority: item.priority,
    type: item.type,
  };
}

export type PresentedAttention = ReturnType<typeof presentAttentionItem>;
