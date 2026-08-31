import type { CompensationRuleType } from "@prisma/client";

export function calculateCompensationAmount(input: {
  type: CompensationRuleType;
  amountCents?: number | null;
  percentBps?: number | null;
  saleCents: number;
  grossProfitCents?: number | null;
}): { amountCents: number; basis: string; supported: boolean } {
  if (input.type === "FLAT_AMOUNT") {
    const amount = input.amountCents ?? 0;
    return { amountCents: amount, basis: `Flat ${amount} cents`, supported: true };
  }
  if (input.type === "PERCENT_OF_SALE") {
    const bps = input.percentBps ?? 0;
    const amount = Math.round((input.saleCents * bps) / 10000);
    return { amountCents: amount, basis: `${bps / 100}% of sale ${input.saleCents}`, supported: true };
  }
  if (input.type === "PERCENT_OF_GROSS_PROFIT") {
    if (input.grossProfitCents == null) {
      return { amountCents: 0, basis: "Gross profit not available", supported: false };
    }
    const bps = input.percentBps ?? 0;
    const amount = Math.round((input.grossProfitCents * bps) / 10000);
    return { amountCents: amount, basis: `${bps / 100}% of gross profit ${input.grossProfitCents}`, supported: true };
  }
  return { amountCents: 0, basis: `${input.type} is foundation-ready and is not auto-calculated.`, supported: false };
}

export function compensationIsPaid(status: string) {
  return status === "PAID";
}

export function summarizeCompensation(rows: { amountCents: number; status: string }[]) {
  return {
    pendingCents: rows.filter((row) => row.status === "PENDING").reduce((sum, row) => sum + row.amountCents, 0),
    qualifiedCents: rows.filter((row) => row.status === "QUALIFIED").reduce((sum, row) => sum + row.amountCents, 0),
    approvedCents: rows.filter((row) => row.status === "APPROVED").reduce((sum, row) => sum + row.amountCents, 0),
    paidCents: rows.filter((row) => row.status === "PAID").reduce((sum, row) => sum + row.amountCents, 0),
  };
}
