import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { AttentionCardActions } from "@/components/attention-card-actions";
import type { RankedAttention } from "@/lib/attention-priority";
import { HOME_ATTENTION_LIMIT } from "@/lib/attention-priority";

const priorityTone: Record<string, string> = {
  CRITICAL: "bg-rose-50 text-rose-800",
  HIGH: "bg-[var(--cy-orange-muted)] text-[#9A3412]",
  MEDIUM: "bg-sky-50 text-sky-800",
  LOW: "bg-slate-100 text-slate-600",
};

export function KpiCard({
  label,
  value,
  context,
  href,
}: {
  label: string;
  value: string;
  context: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-[var(--border)] bg-white p-5 transition hover:border-[var(--cy-navy)]/15 hover:shadow-sm"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--cy-text-secondary)]">{label}</p>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-[var(--cy-navy)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{context}</p>
    </Link>
  );
}

export function AttentionCard({ item, compact = false }: { item: RankedAttention; compact?: boolean }) {
  const money = item.amountCents != null && item.amountCents > 0 ? formatMoney(item.amountCents) : null;
  return (
    <li>
      <div
        className={`border border-[var(--border)] bg-white transition hover:border-[var(--cy-navy)]/15 ${
          compact ? "rounded-xl px-3 py-2.5" : "rounded-2xl p-4"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">
              {item.priority} · {item.title}
            </p>
            <p className="mt-0.5 font-medium text-[var(--cy-navy)]">
              {item.customerName || item.description}
            </p>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
              {[money, item.description, item.ageDays > 0 ? `${item.ageDays} day${item.ageDays === 1 ? "" : "s"}` : "Today"]
                .filter(Boolean)
                .slice(0, 2)
                .join(" · ")}
            </p>
            {!compact ? <p className="mt-2 text-sm text-[var(--cy-navy)]">{item.recommendedAction}</p> : null}
          </div>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${priorityTone[item.priority]}`}>
            {item.priority}
          </span>
        </div>
        <AttentionCardActions type={item.type} entityId={item.entityId} href={item.href} />
      </div>
    </li>
  );
}

export function SnapshotCard({
  title,
  href,
  cta,
  metrics,
  items,
  insight,
}: {
  title: string;
  href: string;
  cta: string;
  metrics: { label: string; value: string }[];
  items?: { href: string; title: string; detail: string }[];
  insight?: string | null;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">{title}</h2>
        <Link href={href} className="text-sm font-medium text-[var(--cy-orange)]">
          {cta}
        </Link>
      </div>
      {metrics.length > 0 ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt className="text-xs text-[var(--muted-foreground)]">{metric.label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--cy-navy)]">{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {insight ? <p className="mt-4 text-sm text-[var(--muted-foreground)]">{insight}</p> : null}
      {items && items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.href + item.title}>
              <Link href={item.href} className="block rounded-xl px-1 py-1.5 hover:bg-[var(--cy-gray)]">
                <p className="text-sm font-medium text-[var(--cy-navy)]">{item.title}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{item.detail}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function TodayJobs({
  jobs,
}: {
  jobs: Array<{
    id: string;
    status: string;
    jobType: string | null;
    jobNumber: string;
    scheduledStart: Date | null;
    customer: { firstName: string; lastName: string };
    assignments: Array<{ user: { firstName: string; lastName: string } }>;
  }>;
}) {
  if (jobs.length === 0) {
    return <p className="mt-4 text-sm text-[var(--muted-foreground)]">Nothing meaningful left on today&apos;s board.</p>;
  }
  return (
    <ul className="mt-4 space-y-2">
      {jobs.map((job) => {
        const tech = job.assignments[0]?.user;
        return (
          <li key={job.id}>
            <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3 rounded-xl px-1 py-1.5 hover:bg-[var(--cy-gray)]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--cy-navy)]">
                  {job.scheduledStart ? format(job.scheduledStart, "h:mm a") : "TBD"} · {job.customer.firstName}{" "}
                  {job.customer.lastName}
                </p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">
                  {job.jobType || job.jobNumber}
                  {tech ? ` · ${tech.firstName} ${tech.lastName}` : " · Unassigned"}
                </p>
              </div>
              <StatusBadge status={job.status} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function attentionCountLabel(total: number) {
  return total <= HOME_ATTENTION_LIMIT ? null : `View all ${total} items`;
}

export function relativeWhen(date: Date) {
  return formatDistanceToNow(date, { addSuffix: true });
}
