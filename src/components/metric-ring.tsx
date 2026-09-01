import Link from "next/link";

export function MetricRing({
  label,
  value,
  context,
  href,
  progress,
}: {
  label: string;
  value: string;
  context: string;
  href: string;
  progress: number | null;
}) {
  const pct = progress == null ? null : Math.max(0, Math.min(100, progress));
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const dash = pct == null ? 0 : (pct / 100) * circ;
  return (
    <Link
      href={href}
      className="flex min-w-[9.5rem] flex-1 items-center gap-3 rounded-2xl border border-[var(--border)] bg-white p-3 md:min-w-0"
    >
      <svg viewBox="0 0 88 88" className="size-16 shrink-0" aria-hidden="true">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--cy-gray)" strokeWidth="8" />
        {pct != null ? (
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke="var(--cy-orange)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            transform="rotate(-90 44 44)"
          />
        ) : (
          <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--cy-navy)" strokeWidth="8" opacity="0.25" />
        )}
      </svg>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">{label}</p>
        <p className="mt-0.5 truncate text-xl font-semibold tabular-nums text-[var(--cy-navy)]">{value}</p>
        <p className="truncate text-xs text-[var(--muted-foreground)]">{context}</p>
      </div>
    </Link>
  );
}
