import Link from "next/link";

export function CommandHero({
  greeting,
  firstName,
  dateLabel,
  metrics,
  needsYouTotal,
}: {
  greeting: string;
  firstName: string;
  dateLabel: string;
  metrics: Array<{
    label: string;
    value: string;
    href: string;
    context?: string | null;
  }>;
  needsYouTotal: number;
}) {
  const status =
    needsYouTotal === 0
      ? "Nothing needs you right now"
      : needsYouTotal === 1
        ? "1 item needs your attention"
        : `${needsYouTotal} items need your attention`;

  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[var(--cy-navy)] px-5 py-6 text-white shadow-[0_18px_50px_rgba(11,18,32,0.22)] md:px-8 md:py-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(248,112,0,0.16),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_42%)]" />
      <div className="relative flex min-h-[188px] flex-col justify-between gap-6 md:min-h-[220px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-tight md:text-4xl">
              {greeting}, {firstName}.
            </h1>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
              Here&apos;s your business today
            </p>
            <p className="mt-1 text-sm text-white/55">{dateLabel}</p>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Today&apos;s status</p>
            <p className="flex items-center gap-2 text-sm text-white/85">
              <span
                className={`size-2 rounded-full ${needsYouTotal > 0 ? "bg-[var(--cy-orange)]" : "bg-emerald-400"}`}
              />
              {status}
            </p>
            <Link
              href="/dispatch"
              className="text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              View Dispatch →
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-4">
          {metrics.map((metric) => (
            <Link
              key={metric.label}
              href={metric.href}
              className="bg-white/4 px-4 py-4 transition hover:bg-white/8 focus-visible:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cy-orange)]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{metric.label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{metric.value}</p>
              {metric.context ? <p className="mt-1 text-xs text-white/50">{metric.context}</p> : null}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
