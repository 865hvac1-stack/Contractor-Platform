import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { AttentionCardActions } from "@/components/attention-card-actions";
import {
  DASHBOARD_ATTENTION_LIMIT,
  attentionFilterCounts,
  type RankedAttention,
} from "@/lib/attention-priority";

const COUNTERS = [
  { id: "critical", label: "Critical" },
  { id: "sales", label: "Sales" },
  { id: "money", label: "Money" },
  { id: "dispatch", label: "Dispatch" },
  { id: "memberships", label: "Memberships" },
  { id: "other", label: "Other" },
] as const;

const priorityTone: Record<string, string> = {
  CRITICAL: "bg-rose-50 text-rose-800",
  HIGH: "bg-[var(--cy-orange-muted)] text-[#9A3412]",
  MEDIUM: "bg-sky-50 text-sky-800",
  LOW: "bg-slate-100 text-slate-600",
};

export function AttentionSummary({ items }: { items: RankedAttention[] }) {
  const counts = attentionFilterCounts(items);
  const top = items.slice(0, DASHBOARD_ATTENTION_LIMIT);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Needs your attention</h2>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--cy-navy)]">{items.length}</span> items
          </p>
        </div>
        <Link href="/attention" className="text-sm font-medium text-[var(--cy-orange)]">
          View all {items.length} in Action Center →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {COUNTERS.map((item) => {
          const count = counts[item.id];
          if (item.id === "other" && count === 0) return null;
          return (
            <Link
              key={item.id}
              href={`/attention?filter=${item.id === "other" ? "customers" : item.id}`}
              className="rounded-xl bg-[var(--cy-gray)] px-2 py-2 text-center"
            >
              <p className="text-lg font-semibold tabular-nums text-[var(--cy-navy)]">{count}</p>
              <p className="text-[11px] text-[var(--muted-foreground)]">{item.label}</p>
            </Link>
          );
        })}
      </div>
      {top.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">Nothing needs you right now.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((item) => {
            const money = item.amountCents != null && item.amountCents > 0 ? formatMoney(item.amountCents) : null;
            return (
              <li key={item.id} className="rounded-xl bg-[var(--cy-gray)]/70 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">
                      {item.title}
                    </p>
                    <p className="mt-0.5 truncate font-medium text-[var(--cy-navy)]">
                      {item.customerName || item.description}
                      {money ? ` · ${money}` : ""}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{item.recommendedAction}</p>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${priorityTone[item.priority]}`}>
                    {item.priority}
                  </span>
                </div>
                <AttentionCardActions type={item.type} entityId={item.entityId} href={item.href} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
