"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";

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
  timeZone,
}: {
  events: { id: string; at: Date | string; kind: string; title: string; href?: string }[];
  timeZone?: string | null;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(
    () =>
      filter === "all"
        ? events
        : events.filter((event) => event.kind === filter || (filter === "property" && event.kind === "customer")),
    [events, filter]
  );
  const shown = expanded ? visible : visible.slice(0, 5);

  return (
    <section id="timeline">
      <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Complete timeline</h2>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
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
        <ul className="mt-3 space-y-1.5">
          {shown.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-[var(--border)]"
            >
              {event.href ? (
                <Link href={event.href} className="font-medium text-[var(--cy-navy)] hover:underline">
                  {event.title}
                </Link>
              ) : (
                <span className="text-[var(--cy-navy)]">{event.title}</span>
              )}
              <span className="text-xs text-[var(--cy-text-muted)]">{formatDateTime(event.at, timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
      {visible.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-sm font-medium text-[var(--cy-orange)] hover:underline"
        >
          {expanded ? "Show less" : "View full timeline →"}
        </button>
      ) : null}
    </section>
  );
}
