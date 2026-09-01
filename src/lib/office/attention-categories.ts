import { formatMoney } from "@/lib/money";
import type { RankedAttention } from "@/lib/attention-priority";

export type OfficeAttentionCategory = {
  id: string;
  label: string;
  count: number;
  customerCount: number;
  amountCents: number | null;
  summary: string;
  href: string;
  actionLabel: string;
  prepareType?: string;
  askQuestion?: string;
  priority: number;
};

const OFFICE_ATTENTION_TYPES = new Set([
  "estimate_not_followed_up",
  "approved_estimate_not_scheduled",
  "lead_unanswered",
  "missed_call_no_follow_up",
  "invoice_overdue",
  "invoice_awaiting_payment",
]);

const CATEGORY_DEFS: Record<
  string,
  Omit<OfficeAttentionCategory, "count" | "customerCount" | "amountCents" | "summary" | "priority">
> = {
  estimate_follow_up: {
    id: "estimate_follow_up",
    label: "Estimate follow-up",
    href: "/attention?filter=follow_ups&type=estimate_not_followed_up",
    actionLabel: "Review",
    prepareType: "estimate_not_followed_up",
    askQuestion: "Which estimates should we call?",
  },
  approved_not_scheduled: {
    id: "approved_not_scheduled",
    label: "Approved — not scheduled",
    href: "/estimates?status=approved",
    actionLabel: "Schedule work",
    prepareType: "approved_estimate_not_scheduled",
    askQuestion: "What approved work needs scheduling?",
  },
  overdue_invoices: {
    id: "overdue_invoices",
    label: "Overdue invoices",
    href: "/invoices?status=overdue",
    actionLabel: "Review",
    prepareType: "invoice_overdue",
    askQuestion: "Who owes us money?",
  },
  unanswered_leads: {
    id: "unanswered_leads",
    label: "Unanswered leads",
    href: "/marketing/leads?status=NEW",
    actionLabel: "Respond",
    askQuestion: "Which leads have not been answered?",
  },
  missed_calls: {
    id: "missed_calls",
    label: "Missed calls",
    href: "/marketing/communications?filter=missed",
    actionLabel: "Respond",
    askQuestion: "Who needs a callback?",
  },
};

const TYPE_TO_CATEGORY: Record<string, string> = {
  estimate_not_followed_up: "estimate_follow_up",
  approved_estimate_not_scheduled: "approved_not_scheduled",
  invoice_overdue: "overdue_invoices",
  invoice_awaiting_payment: "overdue_invoices",
  lead_unanswered: "unanswered_leads",
  missed_call_no_follow_up: "missed_calls",
};

const PRIORITY_ORDER: Record<string, number> = {
  estimate_follow_up: 0,
  approved_not_scheduled: 1,
  overdue_invoices: 2,
  unanswered_leads: 3,
  missed_calls: 4,
};

export function officeAttentionTypes() {
  return OFFICE_ATTENTION_TYPES;
}

export function buildOfficeAttentionCategories(items: RankedAttention[]): OfficeAttentionCategory[] {
  const buckets = new Map<
    string,
    { items: RankedAttention[]; customers: Set<string>; amountCents: number }
  >();

  for (const item of items) {
    if (!OFFICE_ATTENTION_TYPES.has(item.type)) continue;
    const categoryId = TYPE_TO_CATEGORY[item.type];
    if (!categoryId) continue;
    const bucket = buckets.get(categoryId) ?? { items: [], customers: new Set<string>(), amountCents: 0 };
    bucket.items.push(item);
    if (item.customerName) bucket.customers.add(item.customerName);
    if (item.amountCents && item.amountCents > 0) bucket.amountCents += item.amountCents;
    buckets.set(categoryId, bucket);
  }

  return [...buckets.entries()]
    .map(([categoryId, bucket]) => {
      const def = CATEGORY_DEFS[categoryId];
      const customerCount = bucket.customers.size || bucket.items.length;
      const amountCents = bucket.amountCents > 0 ? bucket.amountCents : null;
      let summary = `${customerCount} customer${customerCount === 1 ? "" : "s"}`;
      if (amountCents != null) {
        summary =
          categoryId === "overdue_invoices"
            ? `${bucket.items.length} invoice${bucket.items.length === 1 ? "" : "s"} · ${formatMoney(amountCents)} overdue`
            : `${customerCount} customer${customerCount === 1 ? "" : "s"} · ${formatMoney(amountCents)}`;
      } else if (categoryId === "missed_calls") {
        summary = `${bucket.items.length} call${bucket.items.length === 1 ? "" : "s"}`;
      }
      return {
        ...def,
        count: bucket.items.length,
        customerCount,
        amountCents,
        summary,
        priority: PRIORITY_ORDER[categoryId] ?? 99,
      };
    })
    .sort((a, b) => a.priority - b.priority);
}
