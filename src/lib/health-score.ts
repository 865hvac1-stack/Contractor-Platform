export type HealthComponentId = "sales" | "cash" | "operations" | "customers" | "team" | "marketing";

export type HealthComponent = {
  id: HealthComponentId;
  label: string;
  score: number | null;
  reason: string;
};

export type HealthScore = {
  score: number | null;
  label: "Healthy" | "Watch" | "Needs attention" | null;
  components: HealthComponent[];
};

export type HealthScoreInput = {
  closeRate: number | null;
  openEstimateValue: number;
  estimatesNeedingFollowUp: number;
  revenueThisMonth: number;
  outstandingBalance: number;
  overdueBalance: number;
  jobsToday: number;
  runningLate: number;
  unassignedJobs: number;
  callbacks: number;
  completedThisMonth: number;
  activeMemberships: number;
  reviewsThisMonth: number;
  missedCallsOpen: number;
  averageTicketCents: number | null;
  teamCallbacks: number;
  leadsThisMonth: number;
  bookedLeads: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function salesScore(input: HealthScoreInput): HealthComponent {
  if (input.closeRate == null && input.openEstimateValue <= 0) {
    return { id: "sales", label: "Sales", score: null, reason: "Not enough estimate activity yet." };
  }
  let score = input.closeRate ?? 55;
  if (input.openEstimateValue > 0) score += 8;
  score -= Math.min(20, input.estimatesNeedingFollowUp * 4);
  const reason =
    input.closeRate == null
      ? `Open pipeline ${input.openEstimateValue > 0 ? "is recorded" : "is empty"}; close rate needs decided estimates.`
      : `${input.closeRate}% close rate` +
        (input.estimatesNeedingFollowUp > 0 ? ` · ${input.estimatesNeedingFollowUp} estimates waiting on follow-up.` : ".");
  return { id: "sales", label: "Sales", score: clamp(score), reason };
}

function cashScore(input: HealthScoreInput): HealthComponent {
  const working = input.revenueThisMonth + input.outstandingBalance;
  if (working <= 0) {
    return { id: "cash", label: "Cash", score: null, reason: "Not enough invoice activity yet." };
  }
  const collectedShare = input.revenueThisMonth / working;
  const overdueShare = input.outstandingBalance > 0 ? input.overdueBalance / input.outstandingBalance : 0;
  const score = collectedShare * 70 + (1 - overdueShare) * 30;
  const reason =
    input.overdueBalance > 0
      ? `Overdue A/R is on the books.`
      : "Collected revenue is keeping pace with open invoices.";
  return { id: "cash", label: "Cash", score: clamp(score), reason };
}

function operationsScore(input: HealthScoreInput): HealthComponent {
  if (input.jobsToday <= 0 && input.completedThisMonth <= 0) {
    return { id: "operations", label: "Operations", score: null, reason: "Not enough scheduled or completed jobs yet." };
  }
  const denom = Math.max(input.jobsToday, 1);
  const lateShare = Math.min(1, input.runningLate / denom);
  const unassignedShare = Math.min(1, input.unassignedJobs / denom);
  let score = 88 - lateShare * 40 - unassignedShare * 20 - Math.min(16, input.callbacks * 4);
  if (input.jobsToday === 0) score = 70 - Math.min(16, input.callbacks * 4);
  const reason =
    input.runningLate > 0
      ? `${input.runningLate} job${input.runningLate === 1 ? "" : "s"} running behind.`
      : input.unassignedJobs > 0
        ? `${input.unassignedJobs} unassigned job${input.unassignedJobs === 1 ? "" : "s"}.`
        : "Today's board is on track.";
  return { id: "operations", label: "Operations", score: clamp(score), reason };
}

function customersScore(input: HealthScoreInput): HealthComponent {
  if (input.activeMemberships <= 0 && input.reviewsThisMonth <= 0 && input.missedCallsOpen <= 0) {
    return { id: "customers", label: "Customers", score: null, reason: "Not enough customer activity yet." };
  }
  let score = 62;
  if (input.activeMemberships > 0) score += Math.min(18, 8 + Math.floor(input.activeMemberships / 8));
  if (input.reviewsThisMonth > 0) score += Math.min(14, input.reviewsThisMonth);
  score -= Math.min(24, input.missedCallsOpen * 6);
  const reason =
    input.missedCallsOpen > 0
      ? `${input.missedCallsOpen} missed call${input.missedCallsOpen === 1 ? "" : "s"} still open.`
      : input.activeMemberships > 0
        ? `${input.activeMemberships} active members on file.`
        : `${input.reviewsThisMonth} review${input.reviewsThisMonth === 1 ? "" : "s"} this month.`;
  return { id: "customers", label: "Customers", score: clamp(score), reason };
}

function teamScore(input: HealthScoreInput): HealthComponent {
  if (input.averageTicketCents == null && input.completedThisMonth <= 0) {
    return { id: "team", label: "Team", score: null, reason: "Not enough completed technician work yet." };
  }
  let score = 78;
  if (input.averageTicketCents != null) score += 6;
  score -= Math.min(24, input.teamCallbacks * 6);
  const reason =
    input.teamCallbacks >= 2
      ? `${input.teamCallbacks} callbacks recorded this month.`
      : "Completed work and ticket size are on file.";
  return { id: "team", label: "Team", score: clamp(score), reason };
}

function marketingScore(input: HealthScoreInput): HealthComponent {
  if (input.leadsThisMonth <= 0) {
    return { id: "marketing", label: "Marketing", score: null, reason: "Not enough attribution data yet." };
  }
  const bookingRate = input.bookedLeads / input.leadsThisMonth;
  const score = 40 + bookingRate * 60;
  return {
    id: "marketing",
    label: "Marketing",
    score: clamp(score),
    reason: `${input.bookedLeads} of ${input.leadsThisMonth} leads booked this month.`,
  };
}

export function labelForHealthScore(score: number): HealthScore["label"] {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Watch";
  return "Needs attention";
}

export function computeHealthScore(input: HealthScoreInput): HealthScore {
  const components = [
    salesScore(input),
    cashScore(input),
    operationsScore(input),
    customersScore(input),
    teamScore(input),
    marketingScore(input),
  ];
  const scored = components.filter((row): row is HealthComponent & { score: number } => row.score != null);
  if (scored.length === 0) {
    return { score: null, label: null, components };
  }
  const score = Math.round(scored.reduce((sum, row) => sum + row.score, 0) / scored.length);
  return { score, label: labelForHealthScore(score), components };
}

export function arAgingBuckets(
  invoices: Array<{ balanceCents: number; dueDate: Date | null }>,
  now = new Date()
) {
  const buckets = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
  for (const invoice of invoices) {
    const amount = invoice.balanceCents;
    if (!invoice.dueDate || invoice.dueDate >= now) {
      buckets.current += amount;
      continue;
    }
    const days = Math.floor((now.getTime() - invoice.dueDate.getTime()) / 86_400_000);
    if (days <= 30) buckets.d1to30 += amount;
    else if (days <= 60) buckets.d31to60 += amount;
    else if (days <= 90) buckets.d61to90 += amount;
    else buckets.d90plus += amount;
  }
  return buckets;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function bucketRevenueSeries(
  rows: Array<{ at: Date; amountCents: number }>,
  range: "30d" | "90d" | "12m",
  now = new Date()
) {
  const points: { key: string; label: string; revenueCents: number }[] = [];
  if (range === "12m") {
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      points.push({ key, label: date.toLocaleString("en-US", { month: "short" }), revenueCents: 0 });
    }
    for (const row of rows) {
      const key = `${row.at.getFullYear()}-${String(row.at.getMonth() + 1).padStart(2, "0")}`;
      const point = points.find((item) => item.key === key);
      if (point) point.revenueCents += row.amountCents;
    }
    return points;
  }
  const days = range === "90d" ? 90 : 30;
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    const key = localDateKey(date);
    points.push({
      key,
      label: date.toLocaleString("en-US", { month: "short", day: "numeric" }),
      revenueCents: 0,
    });
  }
  for (const row of rows) {
    const key = localDateKey(row.at);
    const point = points.find((item) => item.key === key);
    if (point) point.revenueCents += row.amountCents;
  }
  return points;
}
