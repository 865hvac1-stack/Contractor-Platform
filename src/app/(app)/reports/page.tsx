import { requirePermission } from "@/lib/tenant";
import { getReportsSummary } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";

export default async function ReportsPage() {
  const ctx = await requirePermission("reports:view");
  const summary = await getReportsSummary(ctx.company.id);

  const cards = [
    {
      label: "Revenue this month",
      value: formatMoney(summary.revenueCents),
      detail:
        summary.revenueCount === 0
          ? "No paid invoices this month"
          : `${summary.revenueCount} paid invoice${summary.revenueCount === 1 ? "" : "s"}`,
    },
    {
      label: "Open estimates",
      value: formatMoney(summary.openEstimatesValue),
      detail:
        summary.openEstimatesCount === 0
          ? "No open estimates"
          : `${summary.openEstimatesCount} open`,
    },
    {
      label: "Estimate conversion",
      value:
        summary.estimateConversionPercent === null
          ? "—"
          : `${summary.estimateConversionPercent}%`,
      detail:
        summary.estimateConversionPercent === null
          ? "Not enough decided estimates yet"
          : "Approved among decided estimates",
    },
    {
      label: "Outstanding invoices",
      value: formatMoney(summary.outstandingCents),
      detail:
        summary.outstandingCount === 0
          ? "Nothing outstanding"
          : `${summary.outstandingCount} invoice${summary.outstandingCount === 1 ? "" : "s"}`,
    },
    {
      label: "Jobs completed this month",
      value: String(summary.jobsCompletedThisMonth),
      detail:
        summary.jobsCompletedThisMonth === 0
          ? "No completions recorded this month"
          : "Completed jobs",
    },
    {
      label: "Expenses this month",
      value: formatMoney(summary.expensesCents),
      detail:
        summary.expensesCount === 0
          ? "No expenses this month"
          : `${summary.expensesCount} expense${summary.expensesCount === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Month-to-date snapshot from live company data. Zeros mean no activity yet.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[var(--border)] bg-white p-5"
          >
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              {card.label}
            </p>
            <p className="mt-2 font-display text-3xl tabular-nums tracking-tight">
              {card.value}
            </p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{card.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
