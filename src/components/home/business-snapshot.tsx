import Link from "next/link";
import { formatMoney } from "@/lib/money";

export function BusinessSnapshot({
  snapshot,
  canReports,
}: {
  snapshot: {
    revenueCents: number;
    collectedCents: number;
    arCents: number;
    openEstimateCents: number;
    revenueTrend: number | null;
    sparkline: number[] | null;
  } | null;
  canReports: boolean;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(11,18,32,0.04)] md:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Business snapshot
          </h2>
          <p className="mt-1 text-sm text-[var(--cy-text-secondary)]">This month</p>
        </div>
        <div className="flex gap-3 text-sm font-medium">
          <Link href="/money" className="text-[var(--cy-orange)]">
            View Money →
          </Link>
          {canReports ? (
            <Link href="/reports" className="text-[var(--cy-navy)]">
              View Reports →
            </Link>
          ) : null}
        </div>
      </div>

      {snapshot ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Revenue"
              value={formatMoney(snapshot.revenueCents)}
              trend={snapshot.revenueTrend}
            />
            <Stat label="Collected" value={formatMoney(snapshot.collectedCents)} />
            <Stat label="A/R" value={formatMoney(snapshot.arCents)} />
            <Stat label="Open estimates" value={formatMoney(snapshot.openEstimateCents)} />
          </dl>
          {snapshot.sparkline ? <Sparkline values={snapshot.sparkline} /> : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-[var(--cy-gray)] px-4 py-5">
          <p className="font-medium text-[var(--cy-navy)]">We&apos;re building your business picture.</p>
          <p className="mt-1 text-sm text-[var(--cy-text-secondary)]">
            Revenue, collections, A/R and open work will appear here as verified data becomes available.
          </p>
          <Link href="/money" className="mt-3 inline-flex text-sm font-medium text-[var(--cy-orange)]">
            View Money →
          </Link>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, trend }: { label: string; value: string; trend?: number | null }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--cy-navy)]">{value}</dd>
      {trend != null ? (
        <p className={`mt-1 text-xs ${trend >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}% vs last month
        </p>
      ) : null}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const width = 160;
  const height = 48;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - (value / max) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="hidden items-end lg:flex">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <polyline fill="none" stroke="#f87000" strokeWidth="2" points={points} />
      </svg>
    </div>
  );
}
