import { differenceInBusinessDays, endOfMonth, startOfMonth } from "date-fns";
import { formatMoney } from "@/lib/money";
import { explainBusinessHealth, type HealthExplanation } from "@/lib/intelligence/health-explain";
import type { BusinessContext } from "@/lib/intelligence/operating-context";
import type { OpportunityItem } from "@/lib/intelligence/opportunities";
import type { HealthScore } from "@/lib/health-score";

export type NoticeKind =
  | "opportunity"
  | "risk"
  | "trend"
  | "anomaly"
  | "positive"
  | "goal_progress"
  | "operating_issue"
  | "customer_experience"
  | "cash"
  | "sales"
  | "team"
  | "marketing";

export type NoticeSeverity = "info" | "watch" | "urgent";

export type IntelligenceNotice = {
  id: string;
  kind: NoticeKind;
  title: string;
  what: string;
  why: string;
  dataUsed: string;
  period: string;
  severity: NoticeSeverity;
  href?: string;
  ask?: string;
  prepareHref?: string;
  prepareLabel?: string;
};

export type OpportunitySummary = {
  id: string;
  title: string;
  count: number;
  valueCents: number | null;
  reason: string;
  href: string;
  reviewLabel: string;
  prepareHref?: string;
  prepareLabel?: string;
};

export type RecommendedAction = {
  id: string;
  rank: number;
  title: string;
  detail: string;
  count?: number;
  valueCents?: number | null;
  href: string;
  prepareHref?: string;
  prepareLabel?: string;
  ask?: string;
};

export type GoalProgressCard = {
  id: string;
  title: string;
  currentLabel: string;
  targetLabel: string;
  percent: number | null;
  remainingLabel?: string;
  projection?: string | null;
  trend?: string | null;
};

export type OwnerBrief = {
  greeting: string;
  facts: string[];
  biggestOpportunity: { title: string; detail: string } | null;
  biggestRisk: { title: string; detail: string } | null;
};

export type IntelligenceFacts = {
  firstName: string;
  companyName: string;
  generatedAt: Date;
  health: HealthScore;
  today: {
    jobsToday: number;
    completedJobs: number;
    runningBehind: number;
    unassignedJobs: number;
  };
  sales: {
    openEstimates: number;
    estimateValue: number;
    closeRate: number | null;
    opportunities: { customerName: string; amountCents: number }[];
  };
  money: {
    revenueThisMonth: number;
    lastMonthRevenue: number;
    revenueChangePercent: number | null;
    overdueBalance: number;
    overdueInvoices: number;
    outstandingBalance: number;
    aging: { current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number };
    revenueGoalCents: number | null;
    closeRateGoal: number | null;
    grossMarginPercent: number | null;
  };
  memberships: {
    active: number;
    renewalsDue: number;
    soldThisMonth: number;
    goal: number | null;
  };
  reviews: { month: number; average: number | null };
  marketing: {
    leadsThisMonth: number;
    bookedLeads: number;
    bestSource: { source: string; booked: number; leads: number } | null;
  };
  operations: { callbacks: number; unassignedJobs: number; completedThisMonth: number };
  team: { insights: string[]; averageTicketCents: number | null };
  followUp: { estimatesNeedingFollowUp: number };
  goals: {
    revenueCents: number | null;
    closeRate: number | null;
    memberships: number | null;
    marginPercent: number | null;
  };
};

const MIN_TREND_SAMPLE = 8;

export function remainingBusinessDays(now = new Date()) {
  const end = endOfMonth(now);
  const start = now > end ? end : now;
  return Math.max(0, differenceInBusinessDays(end, start));
}

export function projectMonthlyRevenue(revenueThisMonth: number, now = new Date()) {
  const elapsed = Math.max(1, now.getDate());
  const daysInMonth = endOfMonth(now).getDate();
  if (revenueThisMonth <= 0 || elapsed < 5) return null;
  return Math.round((revenueThisMonth / elapsed) * daysInMonth);
}

export function summarizeOpportunities(
  items: OpportunityItem[],
  membershipName = "membership"
): OpportunitySummary[] {
  const groups = new Map<string, OpportunityItem[]>();
  for (const item of items) {
    const list = groups.get(item.type) ?? [];
    list.push(item);
    groups.set(item.type, list);
  }

  const summaries: OpportunitySummary[] = [];
  const stale = groups.get("estimate_follow_up") ?? [];
  if (stale.length > 0) {
    const value = stale.reduce((sum, row) => sum + (row.valueCents ?? 0), 0);
    summaries.push({
      id: "estimate_follow_up",
      title: "Estimate follow-up",
      count: stale.length,
      valueCents: value,
      reason: "Open estimates have had no close after more than 3 days.",
      href: "/estimates",
      reviewLabel: `Review ${stale.length}`,
      prepareHref: "/intelligence?ask=Take%20care%20of%20my%20estimate%20follow-ups.",
      prepareLabel: "Prepare follow-ups",
    });
  }

  const membership = groups.get("membership_opportunity") ?? [];
  if (membership.length > 0) {
    const recorded = Number(membership[0]?.title.match(/\d+/)?.[0] ?? membership.length);
    summaries.push({
      id: "membership_opportunity",
      title: `${membershipName === "membership" ? "Membership" : membershipName} opportunity`,
      count: recorded,
      valueCents: null,
      reason: `Repeat service history with no active ${membershipName}.`,
      href: "/memberships",
      reviewLabel: "Review customers",
    });
  }

  const leads = groups.get("lead_not_booked") ?? [];
  if (leads.length > 0) {
    summaries.push({
      id: "lead_not_booked",
      title: "Unbooked leads",
      count: leads.length,
      valueCents: null,
      reason: "Leads received more than 3 days ago that have not booked.",
      href: "/marketing/leads",
      reviewLabel: `Review ${leads.length}`,
    });
  }

  const inactive = groups.get("inactive_customer") ?? [];
  if (inactive.length > 0) {
    summaries.push({
      id: "inactive_customer",
      title: "Inactive customers",
      count: inactive.length,
      valueCents: null,
      reason: "Past customers with no completed job in the last 180 days.",
      href: "/customers",
      reviewLabel: "Review customers",
    });
  }

  return summaries;
}

export function buildOwnerBrief(facts: IntelligenceFacts, opportunities: OpportunitySummary[]): OwnerBrief {
  const hour = facts.generatedAt.getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const lines: string[] = [];
  if (facts.today.jobsToday > 0) {
    lines.push(`${facts.today.jobsToday} job${facts.today.jobsToday === 1 ? "" : "s"} scheduled`);
  }
  if (facts.today.runningBehind > 0) {
    lines.push(`${facts.today.runningBehind} currently running behind`);
  }
  if (facts.sales.estimateValue > 0) {
    lines.push(`${formatMoney(facts.sales.estimateValue)} in open estimates`);
  }
  if (facts.money.overdueBalance > 0) {
    lines.push(`${formatMoney(facts.money.overdueBalance)} overdue`);
  }
  if (facts.memberships.renewalsDue > 0) {
    lines.push(`${facts.memberships.renewalsDue} membership renewal${facts.memberships.renewalsDue === 1 ? "" : "s"} due`);
  }
  const estimateOpp = opportunities.find((row) => row.id === "estimate_follow_up");
  if (estimateOpp) {
    lines.push(`${estimateOpp.count} high-value opportunit${estimateOpp.count === 1 ? "y needs" : "ies need"} follow-up`);
  }
  if (lines.length === 0) {
    lines.push("Not enough recorded activity today to brief yet.");
  }

  const biggestOpportunity = estimateOpp
    ? {
        title: "Biggest opportunity",
        detail: `${formatMoney(estimateOpp.valueCents ?? 0)} in estimates have gone more than 3 days without action.`,
      }
    : opportunities[0]
      ? { title: "Biggest opportunity", detail: `${opportunities[0].title}: ${opportunities[0].reason}` }
      : null;

  const biggestRisk =
    facts.money.overdueBalance > 0
      ? { title: "Biggest risk", detail: `${formatMoney(facts.money.overdueBalance)} in A/R is overdue.` }
      : facts.today.runningBehind > 0
        ? {
            title: "Biggest risk",
            detail: `${facts.today.runningBehind} job${facts.today.runningBehind === 1 ? " is" : "s are"} running behind today.`,
          }
        : null;

  return {
    greeting: `${hello}, ${facts.firstName}.`,
    facts: lines,
    biggestOpportunity,
    biggestRisk,
  };
}

export function buildNotices(facts: IntelligenceFacts, context: BusinessContext | null): IntelligenceNotice[] {
  const notices: IntelligenceNotice[] = [];
  const monthLabel = facts.generatedAt.toLocaleString("en-US", { month: "long" });

  if (
    facts.money.lastMonthRevenue > 0 &&
    facts.money.revenueChangePercent != null &&
    Math.abs(facts.money.revenueChangePercent) >= 3
  ) {
    const up = facts.money.revenueChangePercent > 0;
    notices.push({
      id: "revenue-momentum",
      kind: up ? "positive" : "trend",
      title: "Revenue momentum",
      what: `Revenue is pacing ${Math.abs(facts.money.revenueChangePercent)}% ${up ? "higher" : "lower"} than last month (${formatMoney(facts.money.revenueThisMonth)} collected).`,
      why: "ContractorYou compared this month's collected payments with the previous calendar month.",
      dataUsed: "Paid invoices",
      period: `${monthLabel} vs previous month`,
      severity: up ? "info" : "watch",
      href: "/reports",
      ask: "What changed in the last 30 days?",
    });
  }

  if (facts.sales.closeRate != null && facts.goals.closeRate && facts.sales.closeRate < facts.goals.closeRate) {
    notices.push({
      id: "sales-risk",
      kind: "sales",
      title: "Sales risk",
      what: `Estimate close rate is ${facts.sales.closeRate}% against a ${facts.goals.closeRate}% target.`,
      why: "Decided estimates (approved, declined, or expired) are below the company close-rate goal.",
      dataUsed: "Estimates",
      period: "All decided estimates on file",
      severity: "watch",
      href: "/estimates",
      ask: "Which estimates should I follow up on?",
      prepareHref: "/intelligence?ask=Take%20care%20of%20my%20estimate%20follow-ups.",
      prepareLabel: "Prepare follow-ups",
    });
  }

  const over30 = facts.money.aging.d31to60 + facts.money.aging.d61to90 + facts.money.aging.d90plus;
  if (facts.money.outstandingBalance > 0 && over30 > 0) {
    const share = Math.round((over30 / facts.money.outstandingBalance) * 100);
    notices.push({
      id: "collection-risk",
      kind: "cash",
      title: "Collection risk",
      what: `${formatMoney(over30)} of your ${formatMoney(facts.money.outstandingBalance)} outstanding balance is more than 30 days old.`,
      why:
        share >= 20
          ? `${share}% of outstanding receivables are now more than 30 days old.`
          : "A/R aging crossed 30 days on recorded unpaid invoices.",
      dataUsed: "Unpaid invoices",
      period: "Current open invoices",
      severity: share >= 40 ? "urgent" : "watch",
      href: "/invoices",
      ask: "Who owes us the most money?",
      prepareHref: "/intelligence?ask=Handle%20overdue%20invoices.",
      prepareLabel: "Prepare reminders",
    });
  } else if (facts.money.overdueBalance > 0) {
    notices.push({
      id: "collection-risk",
      kind: "cash",
      title: "Collection risk",
      what: `${formatMoney(facts.money.overdueBalance)} is overdue across ${facts.money.overdueInvoices} invoice${facts.money.overdueInvoices === 1 ? "" : "s"}.`,
      why: "Invoices past their due date still have an open balance.",
      dataUsed: "Unpaid invoices",
      period: "Current open invoices",
      severity: "watch",
      href: "/invoices",
      ask: "Who owes us the most money?",
      prepareHref: "/intelligence?ask=Handle%20overdue%20invoices.",
      prepareLabel: "Prepare reminders",
    });
  }

  if (facts.today.runningBehind > 0) {
    notices.push({
      id: "running-late",
      kind: "operating_issue",
      title: "Jobs running behind",
      what: `${facts.today.runningBehind} job${facts.today.runningBehind === 1 ? " is" : "s are"} running behind today.`,
      why: context?.notes.some((note) => note.id === "running-late")
        ? "Your company rule prepares a customer update after 20 minutes late."
        : "Scheduled jobs have passed their expected window without completion.",
      dataUsed: "Today's jobs",
      period: "Today",
      severity: "watch",
      href: "/dispatch",
      ask: "Ask ContractorYou to recommend assignments",
    });
  }

  if (facts.operations.callbacks >= 3) {
    notices.push({
      id: "callback-trend",
      kind: "team",
      title: "Callback trend",
      what: `${facts.operations.callbacks} callback${facts.operations.callbacks === 1 ? "" : "s"} recorded this month.`,
      why: "Jobs tagged or described as callbacks are above a quiet month.",
      dataUsed: "Completed jobs",
      period: monthLabel,
      severity: "watch",
      href: "/team/performance",
      ask: "Which technicians have the most callbacks?",
    });
  }

  for (const insight of facts.team.insights.slice(0, 2)) {
    const callback = insight.match(/^(.+) has (\d+) callbacks/i);
    if (callback && Number(callback[2]) >= 3) {
      notices.push({
        id: `tech-callback-${callback[1]}`,
        kind: "team",
        title: "Callback trend",
        what: `${callback[1]} has ${callback[2]} callbacks this month.`,
        why: "ContractorYou only reports callbacks stored on completed jobs.",
        dataUsed: "Jobs, technician scorecards",
        period: monthLabel,
        severity: "watch",
        href: "/team/performance",
        ask: "Which technicians have the most callbacks?",
      });
    } else if (/average ticket/i.test(insight)) {
      notices.push({
        id: "ticket-leader",
        kind: "positive",
        title: "Team trend",
        what: insight,
        why: "Average ticket is completed-job revenue divided by completed jobs.",
        dataUsed: "Jobs, invoices",
        period: monthLabel,
        severity: "info",
        href: "/team/performance",
      });
    }
  }

  if (facts.marketing.bestSource && facts.marketing.leadsThisMonth >= MIN_TREND_SAMPLE && facts.marketing.bestSource.leads >= 3) {
    notices.push({
      id: "lead-source",
      kind: "marketing",
      title: "Marketing trend",
      what: `${facts.marketing.bestSource.source} is the strongest recorded lead source this month (${facts.marketing.bestSource.booked} booked of ${facts.marketing.bestSource.leads}).`,
      why: "Booking rate is booked leads divided by recorded leads for that source. Sources with tiny samples are ignored.",
      dataUsed: "Leads",
      period: monthLabel,
      severity: "info",
      href: "/marketing/leads",
      ask: "Where are our best leads coming from?",
    });
  }

  if (facts.today.jobsToday > 0) {
    const rate = Math.round((facts.today.completedJobs / facts.today.jobsToday) * 100);
    if (rate >= 70) {
      notices.push({
        id: "today-completion",
        kind: "positive",
        title: "Today's work",
        what: `Your team completed ${rate}% of today's scheduled work (${facts.today.completedJobs} of ${facts.today.jobsToday}).`,
        why: "Completed jobs today compared with jobs scheduled today.",
        dataUsed: "Jobs",
        period: "Today",
        severity: "info",
        href: "/dispatch",
      });
    }
  }

  if (facts.reviews.average && facts.reviews.month > 0) {
    notices.push({
      id: "reviews-positive",
      kind: "positive",
      title: "Customer experience",
      what: `Average review rating is ${facts.reviews.average.toFixed(1)} from ${facts.reviews.month} review${facts.reviews.month === 1 ? "" : "s"} this month.`,
      why: "Only imported or recorded reviews are counted.",
      dataUsed: "Reviews",
      period: monthLabel,
      severity: "info",
      href: "/marketing/reviews",
    });
  }

  if (facts.goals.memberships && facts.memberships.soldThisMonth >= facts.goals.memberships) {
    notices.push({
      id: "membership-goal",
      kind: "goal_progress",
      title: "Membership sales",
      what: `${context?.membershipName || "Membership"} sales are ahead of goal (${facts.memberships.soldThisMonth} vs ${facts.goals.memberships}).`,
      why: "Sold memberships this month compared with the company membership goal.",
      dataUsed: "Memberships",
      period: monthLabel,
      severity: "info",
      href: "/memberships",
    });
  }

  if (facts.goals.revenueCents && facts.money.revenueThisMonth > facts.goals.revenueCents) {
    notices.push({
      id: "revenue-ahead",
      kind: "goal_progress",
      title: "Revenue pace",
      what: `Revenue is ahead of the ${formatMoney(facts.goals.revenueCents)} monthly target.`,
      why: "Collected payments this month versus the company revenue goal.",
      dataUsed: "Payments",
      period: monthLabel,
      severity: "info",
      href: "/reports",
    });
  }

  return notices;
}

export function buildRisks(notices: IntelligenceNotice[]) {
  return notices.filter((row) => row.kind === "risk" || row.kind === "cash" || row.kind === "sales" || row.kind === "operating_issue" || (row.kind === "trend" && row.severity !== "info") || row.kind === "team");
}

export function buildPositives(notices: IntelligenceNotice[]) {
  return notices.filter((row) => row.kind === "positive" || row.kind === "goal_progress");
}

export function buildRecommendations(
  facts: IntelligenceFacts,
  opportunities: OpportunitySummary[]
): RecommendedAction[] {
  const rows: RecommendedAction[] = [];
  const estimates = opportunities.find((row) => row.id === "estimate_follow_up");
  if (estimates) {
    rows.push({
      id: "follow-estimates",
      rank: rows.length + 1,
      title: "Follow up on high-value estimates",
      detail: `${estimates.count} estimate${estimates.count === 1 ? "" : "s"} · ${formatMoney(estimates.valueCents ?? 0)} opportunity.`,
      count: estimates.count,
      valueCents: estimates.valueCents,
      href: "/estimates",
      prepareHref: estimates.prepareHref,
      prepareLabel: "Prepare follow-ups",
      ask: "Take care of my estimate follow-ups.",
    });
  }
  if (facts.money.overdueBalance > 0) {
    rows.push({
      id: "collect-overdue",
      rank: rows.length + 1,
      title: "Address oldest receivables",
      detail: `${facts.money.overdueInvoices} invoice${facts.money.overdueInvoices === 1 ? "" : "s"} · ${formatMoney(facts.money.overdueBalance)} overdue.`,
      count: facts.money.overdueInvoices,
      valueCents: facts.money.overdueBalance,
      href: "/invoices",
      prepareHref: "/intelligence?ask=Handle%20overdue%20invoices.",
      prepareLabel: "Prepare payment reminders",
      ask: "Handle overdue invoices.",
    });
  }
  if (facts.today.unassignedJobs > 0 || facts.operations.unassignedJobs > 0) {
    const count = Math.max(facts.today.unassignedJobs, facts.operations.unassignedJobs);
    rows.push({
      id: "dispatch-unassigned",
      rank: rows.length + 1,
      title: "Review today's dispatch",
      detail: `${count} unassigned job${count === 1 ? "" : "s"}.`,
      count,
      href: "/dispatch",
      ask: "Ask ContractorYou to recommend assignments",
    });
  }
  if (facts.memberships.renewalsDue > 0) {
    rows.push({
      id: "membership-renewals",
      rank: rows.length + 1,
      title: "Review membership renewals",
      detail: `${facts.memberships.renewalsDue} renewal${facts.memberships.renewalsDue === 1 ? "" : "s"} coming due.`,
      count: facts.memberships.renewalsDue,
      href: "/memberships",
      prepareHref: "/intelligence?ask=Follow%20up%20with%20memberships%20expiring%20this%20month.",
      prepareLabel: "Prepare renewals",
    });
  }
  return rows.slice(0, 4);
}

export function buildGoalCards(facts: IntelligenceFacts, now = new Date()): GoalProgressCard[] {
  const cards: GoalProgressCard[] = [];
  const remaining = remainingBusinessDays(now);
  if (facts.goals.revenueCents && facts.goals.revenueCents > 0) {
    const percent = Math.round((facts.money.revenueThisMonth / facts.goals.revenueCents) * 100);
    const projected = projectMonthlyRevenue(facts.money.revenueThisMonth, now);
    cards.push({
      id: "revenue",
      title: "Monthly revenue",
      currentLabel: formatMoney(facts.money.revenueThisMonth),
      targetLabel: formatMoney(facts.goals.revenueCents),
      percent,
      remainingLabel: `${remaining} business day${remaining === 1 ? "" : "s"} remaining`,
      projection: projected ? `Current pace projects ${formatMoney(projected)}.` : null,
      trend:
        facts.money.revenueChangePercent != null
          ? `${facts.money.revenueChangePercent > 0 ? "+" : ""}${facts.money.revenueChangePercent}% vs last month`
          : null,
    });
  }
  if (facts.goals.closeRate && facts.sales.closeRate != null) {
    cards.push({
      id: "close_rate",
      title: "Estimate close rate",
      currentLabel: `${facts.sales.closeRate}%`,
      targetLabel: `${facts.goals.closeRate}%`,
      percent: Math.round((facts.sales.closeRate / facts.goals.closeRate) * 100),
    });
  }
  if (facts.goals.memberships) {
    cards.push({
      id: "memberships",
      title: "Memberships sold",
      currentLabel: String(facts.memberships.soldThisMonth),
      targetLabel: String(facts.goals.memberships),
      percent: Math.round((facts.memberships.soldThisMonth / facts.goals.memberships) * 100),
    });
  }
  if (facts.goals.marginPercent && facts.money.grossMarginPercent != null) {
    cards.push({
      id: "margin",
      title: "Gross margin",
      currentLabel: `${facts.money.grossMarginPercent}%`,
      targetLabel: `${facts.goals.marginPercent}%`,
      percent: Math.round((facts.money.grossMarginPercent / facts.goals.marginPercent) * 100),
    });
  }
  return cards;
}

export function buildWhatChanged(facts: IntelligenceFacts) {
  const rows: { title: string; detail: string; period: string }[] = [];
  if (facts.money.lastMonthRevenue > 0 && facts.money.revenueChangePercent != null) {
    rows.push({
      title: "Collected revenue",
      detail: `${formatMoney(facts.money.revenueThisMonth)} this month vs ${formatMoney(facts.money.lastMonthRevenue)} last month (${facts.money.revenueChangePercent > 0 ? "+" : ""}${facts.money.revenueChangePercent}%).`,
      period: "Month vs previous month",
    });
  } else if (facts.money.revenueThisMonth > 0) {
    rows.push({
      title: "Collected revenue",
      detail: `${formatMoney(facts.money.revenueThisMonth)} collected this month. Last month does not have enough collected payments for a percentage comparison.`,
      period: startOfMonth(facts.generatedAt).toLocaleDateString("en-US", { month: "long" }),
    });
  }
  if (facts.sales.closeRate != null) {
    rows.push({
      title: "Estimate close rate",
      detail: `${facts.sales.closeRate}% on decided estimates${facts.goals.closeRate ? ` (target ${facts.goals.closeRate}%)` : ""}.`,
      period: "Decided estimates on file",
    });
  }
  if (facts.money.overdueBalance > 0) {
    rows.push({
      title: "Overdue A/R",
      detail: `${formatMoney(facts.money.overdueBalance)} is currently overdue.`,
      period: "Open invoices",
    });
  }
  if (facts.operations.completedThisMonth > 0) {
    rows.push({
      title: "Completed jobs",
      detail: `${facts.operations.completedThisMonth} job${facts.operations.completedThisMonth === 1 ? "" : "s"} completed this month${facts.operations.callbacks > 0 ? `, including ${facts.operations.callbacks} callback${facts.operations.callbacks === 1 ? "" : "s"}` : ""}.`,
      period: "This month",
    });
  }
  if (facts.marketing.leadsThisMonth > 0) {
    const booked = facts.marketing.bookedLeads;
    rows.push({
      title: "Leads",
      detail: `${booked} of ${facts.marketing.leadsThisMonth} leads booked this month.`,
      period: "This month",
    });
  }
  return rows;
}

export function assembleIntelligenceView(
  facts: IntelligenceFacts,
  opportunities: OpportunityItem[],
  context: BusinessContext | null
) {
  const opportunitySummaries = summarizeOpportunities(opportunities, context?.membershipName);
  const brief = buildOwnerBrief(facts, opportunitySummaries);
  const notices = buildNotices(facts, context);
  const health = explainBusinessHealth(facts);
  return {
    brief,
    notices,
    noticed: notices.filter((row) => row.kind !== "positive" && row.kind !== "goal_progress").slice(0, 8),
    positives: buildPositives(notices),
    risks: buildRisks(notices).slice(0, 6),
    opportunities: opportunitySummaries,
    recommendations: buildRecommendations(facts, opportunitySummaries),
    goals: buildGoalCards(facts),
    changed: buildWhatChanged(facts),
    health,
  };
}

export type AssembledIntelligence = ReturnType<typeof assembleIntelligenceView> & {
  health: HealthExplanation;
};
