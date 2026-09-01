import { formatMoney } from "@/lib/money";

export type CommandObservation = {
  text: string;
  sources: string[];
  ask: string;
};

export function buildCommandObservations(input: {
  revenueThisMonth: number;
  lastMonthRevenue: number;
  overdueBalance: number;
  lastMonthOverdue?: number;
  openEstimateValue: number;
  estimatesNeedingFollowUp: number;
  topTechName: string | null;
  topTechRevenueCents: number | null;
  runningLate: number;
}): CommandObservation[] {
  const rows: CommandObservation[] = [];
  if (input.lastMonthRevenue > 0) {
    const delta = Math.round(((input.revenueThisMonth - input.lastMonthRevenue) / input.lastMonthRevenue) * 100);
    const direction = delta > 0 ? "ahead of" : delta < 0 ? "behind" : "even with";
    rows.push({
      text: `Revenue is pacing ${Math.abs(delta)}% ${direction} last month${
        input.overdueBalance > 0 ? `, and overdue A/R is ${formatMoney(input.overdueBalance)}.` : "."
      }`,
      sources: ["invoices", "payments"],
      ask: "How are we doing this month?",
    });
  } else if (input.overdueBalance > 0) {
    rows.push({
      text: `Overdue invoices total ${formatMoney(input.overdueBalance)}.`,
      sources: ["invoices"],
      ask: "Who owes us money?",
    });
  }
  if (input.topTechName && input.topTechRevenueCents && input.topTechRevenueCents > 0) {
    rows.push({
      text: `${input.topTechName} leads the team today in completed revenue (${formatMoney(input.topTechRevenueCents)}).`,
      sources: ["jobs", "invoices"],
      ask: "Who is my top tech today?",
    });
  }
  if (input.estimatesNeedingFollowUp > 0 && input.openEstimateValue > 0) {
    rows.push({
      text: `${input.estimatesNeedingFollowUp} estimate${input.estimatesNeedingFollowUp === 1 ? "" : "s"} totaling ${formatMoney(input.openEstimateValue)} still need follow-up.`,
      sources: ["estimates", "needs_attention"],
      ask: "Which estimates need follow-up?",
    });
  } else if (input.runningLate > 0) {
    rows.push({
      text: `${input.runningLate} job${input.runningLate === 1 ? " is" : "s are"} running behind today.`,
      sources: ["jobs", "needs_attention"],
      ask: "What needs me today?",
    });
  }
  return rows.slice(0, 3);
}
