import { formatMoney } from "@/lib/money";
import type { FinancialSnapshot } from "@/lib/finance/snapshot";

export type FinancialKpi = {
  key: "revenue" | "collected" | "grossProfit" | "ar";
  label: string;
  value: string;
  href: string;
  muted?: boolean;
};

export function financialKpiRow(snapshot: FinancialSnapshot, canCosts: boolean): FinancialKpi[] {
  const grossAvailable = Boolean(canCosts && snapshot.grossProfitAvailable && snapshot.grossProfitCents != null);
  return [
    {
      key: "revenue",
      label: "Revenue",
      value: formatMoney(snapshot.revenueCents),
      href: snapshot.hrefs.revenue,
    },
    {
      key: "collected",
      label: "Collected",
      value: formatMoney(snapshot.collectedCents),
      href: snapshot.hrefs.collected,
    },
    {
      key: "grossProfit",
      label: "Gross profit",
      value: !canCosts
        ? "Restricted"
        : grossAvailable
          ? formatMoney(snapshot.grossProfitCents as number)
          : "Not enough cost data",
      href: snapshot.hrefs.grossProfit,
      muted: !grossAvailable,
    },
    {
      key: "ar",
      label: "A/R",
      value: formatMoney(snapshot.arCents),
      href: snapshot.hrefs.ar,
    },
  ];
}
