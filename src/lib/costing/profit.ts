export type JobProfitInput = {
  invoiceTotalsCents: number[];
  confirmedCostCents: number[];
};

export type JobProfit = {
  revenueCents: number;
  directCostCents: number;
  grossProfitCents: number;
  grossMarginPercent: number | null;
};

export function calculateJobProfit(input: JobProfitInput): JobProfit {
  const revenueCents = input.invoiceTotalsCents.reduce((sum, value) => sum + value, 0);
  const directCostCents = input.confirmedCostCents.reduce((sum, value) => sum + value, 0);
  const grossProfitCents = revenueCents - directCostCents;
  return {
    revenueCents,
    directCostCents,
    grossProfitCents,
    grossMarginPercent: revenueCents === 0 ? null : Math.round((grossProfitCents / revenueCents) * 1000) / 10,
  };
}

export function authoritativeCosts(input: {
  jobCosts: { amountCents: number; confirmed: boolean; expenseId: string | null }[];
  expenses: { id: string; amountCents: number }[];
}): { confirmedCents: number; leftoverExpenseIds: string[] } {
  const ledger = input.jobCosts.filter((cost) => cost.confirmed);
  const usedExpenses = new Set(ledger.map((cost) => cost.expenseId).filter(Boolean) as string[]);
  const leftover = input.expenses.filter((expense) => !usedExpenses.has(expense.id));
  return {
    confirmedCents: ledger.reduce((sum, cost) => sum + cost.amountCents, 0) + leftover.reduce((sum, expense) => sum + expense.amountCents, 0),
    leftoverExpenseIds: leftover.map((expense) => expense.id),
  };
}
