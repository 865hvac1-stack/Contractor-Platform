import { parseCountHint, parseDaysHint, parseMoneyHint } from "@/lib/actions/eligibility";
import type { LastResultSet } from "@/lib/actions/types";

export type PlannedStep = { key: string; input: Record<string, unknown> };

export type ActionPlan = {
  handled: boolean;
  excludeName?: string;
  sendExisting?: boolean;
  steps: PlannedStep[];
  answerOnly?: boolean;
};

export function planFromQuestion(question: string, lastResult?: LastResultSet | null): ActionPlan {
  const q = question.toLowerCase().trim();
  const minCents = parseMoneyHint(question);
  const minDays = parseDaysHint(question, 3);

  const exclude = q.match(/take\s+([a-z][a-z' -]{1,40})\s+off|remove\s+([a-z][a-z' -]{1,40})|drop\s+([a-z][a-z' -]{1,40})/i);
  if (exclude) {
    const name = (exclude[1] || exclude[2] || exclude[3] || "").replace(/\b(the|rest|list)\b/gi, "").trim();
    if (name) return { handled: true, excludeName: name, steps: [] };
  }

  if (/\b(send|approve)\b/.test(q) && /\b(them|those|rest|follow-?ups?|reminders?)\b/.test(q)) {
    return { handled: true, sendExisting: true, steps: [] };
  }

  if (/take care|handle|follow up with|follow-ups for today|today's estimate follow/.test(q) && /estimate/.test(q)) {
    return {
      handled: true,
      steps: [
        { key: "estimate.identify_followups", input: { minCents: minCents ?? 0, minDays } },
        { key: "estimate.draft_followup", input: { minCents: minCents ?? 0, minDays } },
      ],
    };
  }
  if (/draft/.test(q) && /estimate|follow-?up|those|them|messages/.test(q) && !/invoice|membership|review|facebook|social/.test(q)) {
    return {
      handled: true,
      steps: [
        {
          key: "estimate.draft_followup",
          input: {
            minCents: minCents ?? 0,
            minDays,
            recordIds: lastResult?.kind === "ESTIMATE" ? lastResult.ids : undefined,
          },
        },
      ],
    };
  }
  if (/which estimates|estimates need follow|show me every estimate|open estimates/.test(q)) {
    return {
      handled: true,
      steps: [{ key: "estimate.identify_followups", input: { minCents: minCents ?? 0, minDays } }],
    };
  }

  if (/handle overdue|take care of overdue|overdue invoices/.test(q) && /draft|remind|handle|take care|send/.test(q)) {
    return {
      handled: true,
      steps: [
        { key: "invoice.identify_overdue", input: { minDays: parseDaysHint(question, 1) } },
        { key: "invoice.draft_payment_reminder", input: { minDays: parseDaysHint(question, 1) } },
      ],
    };
  }
  if (/draft/.test(q) && /invoice|payment reminder|who owes/.test(q)) {
    return {
      handled: true,
      steps: [{ key: "invoice.draft_payment_reminder", input: { minDays: parseDaysHint(question, 1) } }],
    };
  }
  if (/who owes|overdue invoice|outstanding invoice/.test(q)) {
    return {
      handled: true,
      steps: [{ key: "invoice.identify_overdue", input: { minDays: parseDaysHint(question, 1) } }],
    };
  }

  if (/membership/.test(q) && /expir|renew/.test(q) && /draft|follow|take care|prepare|handle/.test(q)) {
    return {
      handled: true,
      steps: [
        { key: "membership.identify_renewals", input: { withinDays: /month/.test(q) ? 31 : 30 } },
        { key: "membership.draft_renewal", input: { withinDays: /month/.test(q) ? 31 : 30 } },
      ],
    };
  }
  if (/membership/.test(q) && /expir|renew/.test(q)) {
    return {
      handled: true,
      steps: [{ key: "membership.identify_renewals", input: { withinDays: /month/.test(q) ? 31 : 30 } }],
    };
  }

  if (/review/.test(q) && /happy|this week|ask .*customer/.test(q) && /draft|ask|prepare|request/.test(q)) {
    return {
      handled: true,
      steps: [
        { key: "review.identify_candidates", input: { withinDays: 7 } },
        { key: "review.draft_request", input: {} },
      ],
    };
  }

  if (/facebook|instagram|social post|tune-up|promotion/.test(q) && /post|draft|schedule/.test(q)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return {
      handled: true,
      steps: [
        {
          key: "social.create_draft",
          input: {
            topic: /tune-?up|maintenance|promotion/.test(q) ? question.replace(/^(create|draft|post|schedule)\s+/i, "").slice(0, 180) : "seasonal maintenance",
            channel: /instagram/.test(q) ? "INSTAGRAM" : "FACEBOOK",
            scheduledAt: /tomorrow/.test(q) ? tomorrow.toISOString() : undefined,
          },
        },
      ],
    };
  }

  if (
    /unassigned|who should take|who can take|fix tomorrow|dispatch|no-?cooling|emergency call|has room|available technician/.test(q) &&
    /job|call|technician|assign|room|unassigned|dispatch/.test(q)
  ) {
    return {
      handled: true,
      steps: [{ key: "job.propose_assignment", input: { when: /tomorrow/.test(q) ? "tomorrow" : "today" } }],
    };
  }

  if (/running late|late customer|prepare.*customer update|message.*late|text.*late/.test(q) && /message|text|sms|prepare|update|draft/.test(q)) {
    return {
      handled: true,
      steps: [
        {
          key: "communication.draft_sms",
          input: {
            purpose: "Your technician is running behind. We will update you as soon as we have a new arrival window.",
          },
        },
      ],
    };
  }

  if (/create tasks?|task list/.test(q)) {
    const name = question.match(/for\s+([A-Z][a-z]+)/)?.[1];
    return {
      handled: true,
      steps: [
        {
          key: "task.prepare_bulk",
          input: {
            assigneeQuery: name,
            limit: parseCountHint(question, 5),
            recordType: "ESTIMATE",
          },
        },
      ],
    };
  }

  if (lastResult?.ids.length && /take the (three|3|two|2)\b|three biggest|biggest three/.test(q)) {
    const n = /\b(two|2)\b/.test(q) && !/\b(three|3)\b/.test(q) ? 2 : 3;
    const ids = lastResult.ids.slice(0, n);
    const key =
      lastResult.kind === "INVOICE"
        ? "invoice.identify_overdue"
        : lastResult.kind === "MEMBERSHIP"
          ? "membership.identify_renewals"
          : "estimate.identify_followups";
    return { handled: true, steps: [{ key, input: { recordIds: ids } }] };
  }

  if (/business health|why is (my|our) (business )?health|health only \d/.test(q)) {
    return { handled: true, steps: [{ key: "report.business_health", input: {} }] };
  }
  if (/what should I do|highest-impact|do about (it|that|health)|focus on today/.test(q)) {
    return { handled: true, steps: [{ key: "report.recommended_actions", input: {} }] };
  }
  if (/what changed|changed in (my|our|the) business|this month compared/.test(q)) {
    return { handled: true, steps: [{ key: "report.what_changed", input: { period: "month" } }] };
  }
  if (/why.*(leave|left|skip|out)|why.*(high-?value|owner follow|rule)/.test(q)) {
    return { handled: true, steps: [{ key: "report.operating_rules", input: {} }] };
  }

  if (/lost money|losing money|job profitability|which jobs lost/.test(q)) {
    return { handled: true, steps: [{ key: "report.job_profitability", input: {} }] };
  }
  if (/sales summary|how are we doing|close rate/.test(q) && /sales|sold|estimate/.test(q)) {
    return { handled: true, steps: [{ key: "report.sales_summary", input: { period: "month" } }] };
  }
  if (/money summary|collected|outstanding/.test(q) && /report|this month|summary/.test(q)) {
    return { handled: true, steps: [{ key: "report.money_summary", input: { period: "month" } }] };
  }
  if (/technician|callbacks|team performance|scorecard/.test(q) && /most|who|team|callback/.test(q)) {
    return { handled: true, steps: [{ key: "report.team_performance", input: { period: "this_month" } }] };
  }

  if (/^search |find customer|look up/.test(q) && /customer/.test(q)) {
    const query = question.replace(/search|find customer|look up|customers?/gi, "").trim();
    return { handled: true, steps: [{ key: "customer.search", input: { query } }] };
  }

  return { handled: false, steps: [] };
}
