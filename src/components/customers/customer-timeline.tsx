"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "jobs", label: "Jobs" },
  { id: "sales", label: "Sales" },
  { id: "money", label: "Money" },
  { id: "communications", label: "Communications" },
  { id: "memberships", label: "Memberships" },
  { id: "property", label: "Property" },
] as const;

export function CustomerTimeline({
  events,
}: {
  events: { id: string; at: Date; kind: string; title: string; href?: string }[];
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const visible = useMemo(
    () => (filter === "all" ? events : events.filter((event) => event.kind === filter || (filter === "property" && event.kind === "customer"))),
    [events, filter]
  );

  return (
    <section>
      <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Complete timeline</h2>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === item.id ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">No recorded events in this filter.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visible.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-white px-4 py-2 text-sm ring-1 ring-[var(--border)]"
            >
              {event.href ? (
                <Link href={event.href} className="font-medium text-[var(--cy-navy)] hover:underline">
                  {event.title}
                </Link>
              ) : (
                <span className="text-[var(--cy-navy)]">{event.title}</span>
              )}
              <span className="text-[var(--cy-text-muted)]">{format(event.at, "MMM d, yyyy")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
