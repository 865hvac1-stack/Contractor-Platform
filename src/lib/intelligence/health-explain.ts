import { formatMoney } from "@/lib/money";
import type { HealthScore } from "@/lib/health-score";

export type HealthExplainInput = {
  health: HealthScore;
  sales: {
    closeRate: number | null;
    estimateValue: number;
    openEstimates: number;
  };
  followUp: { estimatesNeedingFollowUp: number };
  money: {
    overdueBalance: number;
    overdueInvoices: number;
    outstandingBalance: number;
    revenueThisMonth: number;
  };
  operations: { unassignedJobs: number };
  today: { runningBehind: number };
};

export type HealthDriver = {
  id: string;
  label: string;
  score: number | null;
  reason: string;
  facts: string[];
};

export type HealthExplanation = {
  score: number | null;
  label: string | null;
  narrative: string;
  drivers: HealthDriver[];
  missing: string[];
  cta: { label: string; href: string; ask?: string }[];
};

function salesFacts(input: HealthExplainInput) {
  const facts: string[] = [];
  if (input.sales.closeRate != null) facts.push(`close rate is ${input.sales.closeRate}%`);
  if (input.sales.estimateValue > 0) {
    facts.push(`${formatMoney(input.sales.estimateValue)} remains open across ${input.sales.openEstimates} estimate${input.sales.openEstimates === 1 ? "" : "s"}`);
  }
  if (input.followUp.estimatesNeedingFollowUp > 0) {
    facts.push(
      `${input.followUp.estimatesNeedingFollowUp} estimate${input.followUp.estimatesNeedingFollowUp === 1 ? "" : "s"} still need follow-up`
    );
  }
  return facts;
}

function cashFacts(input: HealthExplainInput) {
  const facts: string[] = [];
  if (input.money.overdueBalance > 0) {
    facts.push(`${formatMoney(input.money.overdueBalance)} is overdue across ${input.money.overdueInvoices} invoice${input.money.overdueInvoices === 1 ? "" : "s"}`);
  }
  if (input.money.outstandingBalance > 0) {
    facts.push(`${formatMoney(input.money.outstandingBalance)} is outstanding`);
  }
  if (input.money.revenueThisMonth > 0) {
    facts.push(`${formatMoney(input.money.revenueThisMonth)} collected this month`);
  }
  return facts;
}

export function explainBusinessHealth(input: HealthExplainInput): HealthExplanation {
  const { health } = input;
  const missing = health.components.filter((row) => row.score == null).map((row) => row.label);
  const scored = health.components
    .filter((row): row is typeof row & { score: number } => row.score != null)
    .sort((a, b) => a.score - b.score);

  const drivers: HealthDriver[] = health.components.map((row) => {
    const facts =
      row.id === "sales" ? salesFacts(input) : row.id === "cash" ? cashFacts(input) : row.reason ? [row.reason] : [];
    return {
      id: row.id,
      label: row.label,
      score: row.score,
      reason: row.reason,
      facts,
    };
  });

  if (health.score == null) {
    return {
      score: null,
      label: null,
      narrative:
        "Business Health does not have a score yet. ContractorYou needs recorded sales, cash, operations, team, or marketing activity before it can explain the number. This is the same Command Center health engine — Intelligence does not invent a second score.",
      drivers,
      missing,
      cta: [{ label: "Open Command Center", href: "/dashboard" }],
    };
  }

  const weakest = scored[0];
  const strongest = scored[scored.length - 1];
  const parts = [
    `Your Business Health is ${health.score}${health.label ? ` (${health.label})` : ""}.`,
    "That number comes from the Command Center health engine — Intelligence does not calculate a separate score.",
  ];
  if (weakest) {
    const extra =
      weakest.id === "sales"
        ? salesFacts(input)
        : weakest.id === "cash"
          ? cashFacts(input)
          : weakest.reason
            ? [weakest.reason]
            : [];
    parts.push(
      extra.length
        ? `The biggest drag is ${weakest.label} at ${weakest.score} because ${extra.join("; ")}.`
        : `The biggest drag is ${weakest.label} at ${weakest.score}.`
    );
  }
  if (strongest && strongest.id !== weakest?.id) {
    parts.push(`${strongest.label} is stronger at ${strongest.score}.`);
  }
  if (missing.length) {
    parts.push(`${missing.join(", ")} ${missing.length === 1 ? "does" : "do"} not have enough data to score yet.`);
  }

  const cta: HealthExplanation["cta"] = [];
  if (input.followUp.estimatesNeedingFollowUp > 0) {
    cta.push({
      label: "Review sales opportunities",
      href: "/estimates",
      ask: "Which estimates should I follow up on?",
    });
    cta.push({
      label: "Prepare follow-ups",
      href: "/intelligence?ask=Take%20care%20of%20my%20estimate%20follow-ups.",
      ask: "Take care of my estimate follow-ups.",
    });
  }
  if (input.money.overdueBalance > 0) {
    cta.push({
      label: "Review overdue invoices",
      href: "/invoices",
      ask: "Who owes us the most money?",
    });
  }
  if (input.today.runningBehind > 0 || input.operations.unassignedJobs > 0) {
    cta.push({ label: "Open dispatch", href: "/dispatch" });
  }

  return {
    score: health.score,
    label: health.label,
    narrative: parts.join(" "),
    drivers,
    missing,
    cta,
  };
}
