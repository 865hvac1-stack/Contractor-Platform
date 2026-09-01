import type { AttentionItem, AttentionSeverity } from "@/lib/attention";

export const HOME_ATTENTION_LIMIT = 10;
export const DASHBOARD_ATTENTION_LIMIT = 3;

export type AttentionPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type AttentionCategory = "sales" | "money" | "customers" | "operations" | "team" | "memberships";
export type AttentionFilter =
  | "all"
  | "critical"
  | "sales"
  | "money"
  | "dispatch"
  | "customers"
  | "memberships"
  | "team"
  | "operations"
  | "follow_ups";

export const OFFICE_FOLLOW_UP_TYPES = new Set([
  "estimate_not_followed_up",
  "approved_estimate_not_scheduled",
  "lead_unanswered",
  "missed_call_no_follow_up",
  "membership_needs_review",
  "invoice_awaiting_payment",
  "invoice_overdue",
  "job_missing_technician",
]);
export type AttentionSort = "priority" | "dollars" | "age" | "newest";

export type RankedAttention = AttentionItem & {
  priority: AttentionPriority;
  score: number;
  category: AttentionCategory;
  amountCents: number | null;
  customerName: string | null;
  recommendedAction: string;
  ageDays: number;
};

const TYPE_BASE: Record<string, number> = {
  invoice_overdue: 38,
  payment_failed: 50,
  estimate_not_followed_up: 22,
  approved_estimate_not_scheduled: 28,
  lead_unanswered: 30,
  job_missing_technician: 36,
  job_running_behind: 42,
  missed_call_no_follow_up: 28,
  job_missing_invoice: 24,
  job_missing_completion: 18,
  playbook_required_remaining: 16,
  invoice_awaiting_payment: 20,
  compensation_needs_approval: 12,
  membership_needs_review: 14,
  receipt_missing_category: 8,
  expense_not_assigned_to_job: 8,
};

const TYPE_CATEGORY: Record<string, AttentionCategory> = {
  invoice_overdue: "money",
  payment_failed: "money",
  invoice_awaiting_payment: "money",
  estimate_not_followed_up: "sales",
  approved_estimate_not_scheduled: "sales",
  lead_unanswered: "sales",
  job_missing_technician: "operations",
  job_running_behind: "operations",
  job_missing_invoice: "operations",
  job_missing_completion: "operations",
  playbook_required_remaining: "operations",
  missed_call_no_follow_up: "customers",
  membership_needs_review: "memberships",
  compensation_needs_approval: "team",
  receipt_missing_category: "operations",
  expense_not_assigned_to_job: "operations",
};

const TYPE_ACTION: Record<string, string> = {
  invoice_overdue: "Contact the customer about payment.",
  payment_failed: "Review the failed payment and retry or collect another way.",
  invoice_awaiting_payment: "Collect outstanding balances.",
  estimate_not_followed_up: "Follow up on this estimate.",
  approved_estimate_not_scheduled: "Schedule the approved work.",
  lead_unanswered: "Contact this lead today.",
  job_missing_technician: "Assign a technician.",
  job_running_behind: "Check dispatch and the next appointment.",
  job_missing_invoice: "Create the invoice for completed work.",
  job_missing_completion: "Confirm whether this job is finished.",
  playbook_required_remaining: "Finish the remaining playbook items.",
  missed_call_no_follow_up: "Return the missed call.",
  membership_needs_review: "Review pending memberships.",
  compensation_needs_approval: "Review pending incentives.",
  receipt_missing_category: "Review the receipt.",
  expense_not_assigned_to_job: "Assign the expense to a job.",
};

const PRIORITY_ORDER: Record<AttentionPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function ageDays(createdAt: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000));
}

function parseAmountFromText(text: string) {
  const match = text.match(/\$[\d,]+(?:\.\d{2})?/);
  if (!match) return null;
  const dollars = Number(match[0].replace(/[$,]/g, ""));
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

function valuePoints(amountCents: number | null) {
  if (!amountCents || amountCents <= 0) return 0;
  return Math.min(24, Math.round(amountCents / 100 / 400));
}

export function priorityFromScore(score: number): AttentionPriority {
  if (score >= 72) return "CRITICAL";
  if (score >= 48) return "HIGH";
  if (score >= 28) return "MEDIUM";
  return "LOW";
}

export function categoryForAttention(item: AttentionItem): AttentionCategory {
  return item.category ?? TYPE_CATEGORY[item.type] ?? "operations";
}

export function scoreAttentionItem(item: AttentionItem, now = new Date()): RankedAttention {
  const amountCents = item.amountCents ?? parseAmountFromText(`${item.title} ${item.description}`);
  const days = ageDays(item.createdAt, now);
  const category = categoryForAttention(item);
  let score = TYPE_BASE[item.type] ?? 10;
  score += valuePoints(amountCents);

  if (item.type === "invoice_overdue") score += Math.min(20, days);
  else if (item.type === "estimate_not_followed_up" || item.type === "approved_estimate_not_scheduled") {
    score += Math.min(12, Math.floor(days / 2));
  } else if (item.type === "lead_unanswered") {
    score += Math.min(16, days * 2);
  } else if (item.type === "job_running_behind" || item.type === "job_missing_technician") {
    score += 8;
  } else {
    score += Math.min(8, Math.floor(days / 3));
  }

  if (item.severity === "critical") score += 6;
  if (item.severity === "info") score -= 4;

  const priority = priorityFromScore(score);
  return {
    ...item,
    priority,
    score,
    category,
    amountCents,
    customerName: item.customerName ?? null,
    recommendedAction: item.recommendedAction ?? TYPE_ACTION[item.type] ?? "Open this item and decide the next step.",
    ageDays: days,
  };
}

export function prioritizeAttention(items: AttentionItem[], now = new Date()): RankedAttention[] {
  return items
    .map((item) => scoreAttentionItem(item, now))
    .sort((a, b) => {
      const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (byPriority !== 0) return byPriority;
      if (b.score !== a.score) return b.score - a.score;
      return (b.amountCents ?? 0) - (a.amountCents ?? 0);
    });
}

export function homeAttentionItems(items: RankedAttention[], limit = HOME_ATTENTION_LIMIT): RankedAttention[] {
  const featured = items.filter((item) => item.priority === "CRITICAL" || item.priority === "HIGH");
  const pool = featured.length > 0 ? [...featured, ...items.filter((item) => !featured.includes(item))] : items;
  return pool.slice(0, limit);
}

export function filterAttention(
  items: RankedAttention[],
  filter: AttentionFilter,
  type?: string
): RankedAttention[] {
  let next = items;
  if (filter === "critical") next = next.filter((item) => item.priority === "CRITICAL");
  else if (filter === "follow_ups") next = next.filter((item) => OFFICE_FOLLOW_UP_TYPES.has(item.type));
  else if (filter === "dispatch" || filter === "operations") {
    next = next.filter((item) => item.category === "operations");
  } else if (filter !== "all") {
    next = next.filter((item) => item.category === filter);
  }
  if (type) next = next.filter((item) => item.type === type);
  return next;
}

export function attentionFilterCounts(items: RankedAttention[]) {
  return {
    all: items.length,
    critical: filterAttention(items, "critical").length,
    sales: filterAttention(items, "sales").length,
    money: filterAttention(items, "money").length,
    dispatch: filterAttention(items, "dispatch").length,
    customers: filterAttention(items, "customers").length,
    memberships: filterAttention(items, "memberships").length,
    team: filterAttention(items, "team").length,
    other: filterAttention(items, "customers").length + filterAttention(items, "team").length,
  };
}

export function sortAttention(items: RankedAttention[], sort: AttentionSort): RankedAttention[] {
  const copy = [...items];
  if (sort === "dollars") {
    return copy.sort((a, b) => (b.amountCents ?? 0) - (a.amountCents ?? 0) || b.score - a.score);
  }
  if (sort === "age") {
    return copy.sort((a, b) => b.ageDays - a.ageDays || b.score - a.score);
  }
  if (sort === "newest") {
    return copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  return copy.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.score - a.score);
}

export function parseAttentionFilter(value: string | undefined): AttentionFilter {
  const allowed: AttentionFilter[] = [
    "all",
    "critical",
    "sales",
    "money",
    "dispatch",
    "customers",
    "memberships",
    "team",
    "operations",
    "follow_ups",
  ];
  return allowed.includes(value as AttentionFilter) ? (value as AttentionFilter) : "all";
}

export function parseAttentionSort(value: string | undefined): AttentionSort {
  const allowed: AttentionSort[] = ["priority", "dollars", "age", "newest"];
  return allowed.includes(value as AttentionSort) ? (value as AttentionSort) : "priority";
}

export function severityFromPriority(priority: AttentionPriority): AttentionSeverity {
  if (priority === "CRITICAL") return "critical";
  if (priority === "HIGH") return "warning";
  return "info";
}
