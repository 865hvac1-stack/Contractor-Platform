"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  HOME_ATTENTION_LIMIT,
  attentionFilterCounts,
  filterAttention,
  type AttentionFilter,
  type RankedAttention,
} from "@/lib/attention-priority";
import { AttentionCard } from "@/components/command-center";

const FILTERS: { id: AttentionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "sales", label: "Sales" },
  { id: "money", label: "Money" },
  { id: "dispatch", label: "Dispatch" },
  { id: "customers", label: "Customers" },
  { id: "memberships", label: "Memberships" },
  { id: "team", label: "Team" },
];

export function AttentionFeed({
  items,
  initialFilter = "all",
  initialLimit = HOME_ATTENTION_LIMIT,
}: {
  items: RankedAttention[];
  initialFilter?: AttentionFilter;
  initialLimit?: number;
}) {
  const [filter, setFilter] = useState<AttentionFilter>(initialFilter);
  const [limit, setLimit] = useState(initialLimit);

  useEffect(() => {
    if (window.innerWidth < 768) setLimit(Math.min(5, initialLimit));
  }, [initialLimit]);
  const counts = useMemo(() => attentionFilterCounts(items), [items]);
  const visible = filterAttention(items, filter);
  const shown = visible.slice(0, limit);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Needs your attention</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--cy-navy)]">{items.length}</span> items · ranked by value, urgency, and risk
          </p>
        </div>
        <Link href={`/attention?filter=${filter}`} className="text-sm font-medium text-[var(--cy-orange)]">
          View all {items.length}
        </Link>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => {
          const count = item.id === "operations" ? counts.dispatch : counts[item.id];
          if (item.id !== "all" && item.id !== "critical" && count === 0) return null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setFilter(item.id);
                setLimit(initialLimit);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === item.id
                  ? "bg-[var(--cy-navy)] text-white"
                  : "bg-[var(--cy-gray)] text-[var(--cy-navy)]"
              }`}
            >
              {item.label} {count}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center">
          <p className="font-medium text-[var(--cy-navy)]">You&apos;re clear in this view</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Every recorded task is still available in All.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((item) => (
            <AttentionCard key={item.id} item={item} compact />
          ))}
        </ul>
      )}
      {visible.length > shown.length ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + HOME_ATTENTION_LIMIT)}
          className="mt-4 w-full rounded-xl border border-[var(--border)] py-2.5 text-sm font-medium text-[var(--cy-navy)]"
        >
          Load {Math.min(HOME_ATTENTION_LIMIT, visible.length - shown.length)} more · {visible.length - shown.length} remaining
        </button>
      ) : null}
    </section>
  );
}
