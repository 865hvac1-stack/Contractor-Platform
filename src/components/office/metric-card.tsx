import Link from "next/link";
import type { OfficeScorecardTone } from "@/lib/office/hub";
import { cn } from "@/lib/utils";

const TONE_BAR: Record<OfficeScorecardTone, string> = {
  neutral: "bg-[var(--cy-navy)]",
  opportunity: "bg-[var(--cy-orange)]",
  money: "bg-amber-500",
  urgent: "bg-red-500",
  positive: "bg-emerald-500",
  schedule: "bg-slate-500",
};

export function OfficeMetricCard({
  label,
  value,
  context,
  period,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string;
  context?: string;
  period?: string;
  href: string;
  tone?: OfficeScorecardTone;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative min-w-[10.75rem] shrink-0 snap-start overflow-hidden rounded-2xl border border-[var(--border)] bg-white p-4",
        "transition-[border-color,box-shadow,background-color] duration-200",
        "hover:border-[var(--cy-navy)]/20 hover:bg-[var(--cy-gray)]/40 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]/40",
        "motion-reduce:transition-none md:min-w-0"
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-0.5", TONE_BAR[tone])} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-text-secondary)]">
          {label}
        </p>
        {period ? (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--cy-text-muted)]">
            {period}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[1.65rem] font-semibold leading-none tabular-nums tracking-tight text-[var(--cy-navy)]">
        {value}
      </p>
      {context ? <p className="mt-2 text-xs leading-snug text-[var(--muted-foreground)]">{context}</p> : null}
      <span className="mt-3 inline-flex items-center text-[11px] font-medium text-[var(--cy-navy)]/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--cy-orange)] motion-reduce:transform-none">
        Open →
      </span>
    </Link>
  );
}
