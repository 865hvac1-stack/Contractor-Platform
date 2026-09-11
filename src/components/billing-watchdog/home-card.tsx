import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { BillingWatchdogSummary } from "@/lib/billing-watchdog/types";

export function BillingWatchdogHomeCard({ summary }: { summary: BillingWatchdogSummary }) {
  if (summary.openCount === 0) {
    return (
      <Link
        href="/billing-watchdog"
        className="block rounded-2xl border border-[var(--border)] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(11,18,32,0.04)] transition hover:border-[var(--cy-orange)]/40"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Billing Watchdog</p>
        <h2 className="mt-2 font-display text-2xl tracking-tight text-[var(--cy-navy)]">All clear</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">No billing issues detected.</p>
      </Link>
    );
  }

  const chips = [
    summary.unbilledJobs ? `${summary.unbilledJobs} Unbilled` : null,
    summary.unsentInvoices ? `${summary.unsentInvoices} Unsent` : null,
    summary.checkoutIssues ? `${summary.checkoutIssues} Checkout` : null,
    summary.overdueInvoices ? `${summary.overdueInvoices} Overdue` : null,
    summary.contactIssues ? `${summary.contactIssues} Contact` : null,
    summary.paymentIssues ? `${summary.paymentIssues} Payments` : null,
  ].filter(Boolean);

  return (
    <Link
      href="/billing-watchdog"
      className="block rounded-2xl border border-[var(--border)] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(11,18,32,0.04)] transition hover:border-[var(--cy-orange)]/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Billing Watchdog</p>
          <p className="mt-2 font-display text-3xl tracking-tight text-[var(--cy-navy)] tabular-nums">
            {summary.verifiedAtRiskCents > 0 ? formatMoney(summary.verifiedAtRiskCents) : "Amounts unknown"}
          </p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Revenue needing attention · {summary.openCount} item{summary.openCount === 1 ? "" : "s"}
            {summary.unknownAmountCount ? ` · ${summary.unknownAmountCount} unknown` : ""}
          </p>
        </div>
        <span className="rounded-full bg-[var(--cy-navy)] px-3 py-1.5 text-sm font-medium text-white">
          Review {summary.openCount} item{summary.openCount === 1 ? "" : "s"}
        </span>
      </div>
      {chips.length ? (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm text-[var(--cy-navy)]">
          {chips.map((chip) => (
            <li key={chip} className="rounded-full bg-[var(--cy-gray)] px-3 py-1">
              {chip}
            </li>
          ))}
        </ul>
      ) : null}
    </Link>
  );
}
