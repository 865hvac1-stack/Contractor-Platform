import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { homeRangeHref } from "@/lib/finance/hrefs";
import { FINANCE_RANGES, type FinanceRange } from "@/lib/finance/period";
import { financialKpiRow } from "@/lib/finance/kpis";
import type { FinancialSnapshot } from "@/lib/finance/snapshot";
import { RevenueCollectionsChart, RevenueMixChart } from "@/components/home/finance-charts";

const RANGE_LABELS: Record<FinanceRange, string> = {
  month: "This month",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

export function BusinessSnapshot({
  snapshot,
  canReports,
  canCosts = false,
}: {
  snapshot: FinancialSnapshot;
  canReports: boolean;
  canCosts?: boolean;
}) {
  if (!snapshot.hasData) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(11,18,32,0.04)] md:px-6">
        <Header snapshot={snapshot} canReports={canReports} />
        <div className="mt-4 rounded-xl bg-[var(--cy-gray)] px-4 py-5">
          <p className="font-medium text-[var(--cy-navy)]">We&apos;re building your business picture.</p>
          <p className="mt-1 text-sm text-[var(--cy-text-secondary)]">
            Revenue, collections, A/R and open work will appear here as verified data becomes available.
          </p>
          <Link href="/money" className="mt-3 inline-flex text-sm font-medium text-[var(--cy-orange)]">
            View Money →
          </Link>
        </div>
      </section>
    );
  }

  const kpis = financialKpiRow(snapshot, canCosts);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(11,18,32,0.04)] md:px-6">
      <Header snapshot={snapshot} canReports={canReports} />

      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Kpi key={kpi.key} label={kpi.label} value={kpi.value} href={kpi.href} muted={kpi.muted} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-navy)]">
            Revenue & collections
          </h3>
          <div className="mt-3">
            <RevenueCollectionsChart points={snapshot.trend} />
          </div>
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-navy)]">Revenue mix</h3>
          <div className="mt-3">
            <RevenueMixChart slices={snapshot.mix} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-4 lg:grid-cols-4">
        <Kpi
          compact
          label="Open estimates"
          value={formatMoney(snapshot.openEstimateCents)}
          href={snapshot.hrefs.openEstimates}
        />
        <Kpi
          compact
          label="Overdue A/R"
          value={formatMoney(snapshot.overdueArCents)}
          href={snapshot.hrefs.overdueAr}
        />
        <Kpi
          compact
          label="Average ticket"
          value={snapshot.averageTicketCents == null ? "—" : formatMoney(snapshot.averageTicketCents)}
          href={snapshot.hrefs.averageTicket}
        />
        {snapshot.readyToInvoiceCount > 0 ? (
          <Kpi
            compact
            label="Ready to invoice"
            value={`${snapshot.readyToInvoiceCount} job${snapshot.readyToInvoiceCount === 1 ? "" : "s"}`}
            href={snapshot.hrefs.readyToInvoice}
          />
        ) : null}
      </div>
    </section>
  );
}

function Header({ snapshot, canReports }: { snapshot: FinancialSnapshot; canReports: boolean }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Business snapshot
        </h2>
        <p className="mt-1 text-sm text-[var(--cy-text-secondary)]">{snapshot.period.label}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-[var(--cy-gray)] p-0.5">
          {FINANCE_RANGES.map((range) => (
            <Link
              key={range}
              href={homeRangeHref(range)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                snapshot.period.range === range
                  ? "bg-white text-[var(--cy-navy)] shadow-sm"
                  : "text-[var(--cy-text-secondary)] hover:text-[var(--cy-navy)]"
              }`}
            >
              {RANGE_LABELS[range]}
            </Link>
          ))}
        </div>
        <Link href={snapshot.hrefs.money} className="text-sm font-medium text-[var(--cy-orange)]">
          View Money →
        </Link>
        {canReports ? (
          <Link href={snapshot.hrefs.reports} className="text-sm font-medium text-[var(--cy-navy)]">
            View Reports →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  href,
  compact,
  muted,
}: {
  label: string;
  value: string;
  href: string;
  compact?: boolean;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={`View ${label}`}
      className={`group cursor-pointer rounded-xl border border-[var(--border)] bg-white text-left transition hover:-translate-y-0.5 hover:border-[var(--cy-orange)]/40 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy-navy)] ${
        compact ? "px-3 py-3" : "px-4 py-3.5"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">{label}</p>
      <p
        className={`mt-1 flex items-center justify-between gap-2 font-semibold tabular-nums text-[var(--cy-navy)] ${
          compact ? "text-lg" : "text-2xl"
        } ${muted ? "text-[var(--cy-text-secondary)]" : ""}`}
      >
        <span className="truncate">{value}</span>
        <ChevronRight className="size-4 shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--cy-orange)]" />
      </p>
      <p className="mt-1 text-[11px] font-medium text-[var(--cy-orange)]">View →</p>
    </Link>
  );
}
