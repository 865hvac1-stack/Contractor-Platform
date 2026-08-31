import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { getReportsSummary } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { getCompanyProfitability, getVehicleExpenseTotals } from "@/lib/costing/reporting";
import Link from "next/link";

export default async function ReportsPage() {
  const ctx = await requirePermission("reports:view");
  const summary = await getReportsSummary(ctx.company.id);
  const showProfit = can(ctx.role, "job_costs:view");
  const [profit, vehicles] = showProfit
    ? await Promise.all([getCompanyProfitability(ctx.company.id), getVehicleExpenseTotals(ctx.company.id)])
    : [null, []];

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

      {profit ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-display text-2xl">Job profit</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Calculated from verified invoices and confirmed costs. Unreviewed receipts are left out.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-white p-5">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Average gross margin</p>
              <p className="mt-2 font-display text-3xl tabular-nums">
                {profit.averageGrossMarginPercent == null ? "—" : `${profit.averageGrossMarginPercent}%`}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-white p-5">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Average job cost</p>
              <p className="mt-2 font-display text-3xl tabular-nums">{formatMoney(profit.averageJobCostCents)}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-white p-5">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Jobs missing costs</p>
              <p className="mt-2 font-display text-3xl tabular-nums">{profit.missingCosts.length}</p>
            </div>
          </div>
          {profit.byJobType.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No job profit yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-white">
              {profit.byJobType.map((row) => (
                <li key={row.jobType} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-medium">{row.jobType}</span>
                  <span className="text-[var(--muted-foreground)]">
                    {row.jobs} jobs · {formatMoney(row.revenueCents)} revenue ·{" "}
                    {row.averageMarginPercent == null ? "—" : `${row.averageMarginPercent}%`} margin
                  </span>
                </li>
              ))}
            </ul>
          )}
          {profit.lowestMarginJobs.length > 0 ? (
            <div>
              <h3 className="font-medium">Lowest-margin jobs</h3>
              <ul className="mt-2 space-y-2">
                {profit.lowestMarginJobs.map((job) => (
                  <li key={job.jobId}>
                    <Link href={`/jobs/${job.jobId}`} className="text-sm hover:underline">
                      {job.jobNumber}
                      {job.jobType ? ` · ${job.jobType}` : ""} · {job.grossMarginPercent ?? "—"}%
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {vehicles.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-2xl">Truck spend this month</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Operational totals from confirmed receipts. This is not accounting-grade reporting.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="rounded-xl border border-[var(--border)] bg-white p-4">
                <p className="font-medium">
                  {vehicle.name}
                  {vehicle.unitNumber ? ` · ${vehicle.unitNumber}` : ""}
                </p>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  Fuel {formatMoney(vehicle.fuelCents)} · Maintenance {formatMoney(vehicle.maintenanceCents)} · Other{" "}
                  {formatMoney(vehicle.otherCents)}
                </p>
                <p className="mt-1 tabular-nums">{formatMoney(vehicle.totalCents)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
