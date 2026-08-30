import Link from "next/link";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  context,
  href,
}: {
  label: string;
  value: string;
  context?: string;
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--cy-text-secondary)]">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-[var(--cy-navy)]">
        {value}
      </p>
      {context ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{context}</p> : null}
    </>
  );

  const className = cn(
    "rounded-2xl border border-[var(--border)] bg-white p-5",
    href && "transition hover:border-[var(--cy-navy)]/15 hover:shadow-sm"
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}
