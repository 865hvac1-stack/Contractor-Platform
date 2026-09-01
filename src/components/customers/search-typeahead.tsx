"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { Input } from "@/components/ui/input";

type PropertyHit = {
  id: string;
  label: string;
};

type Hit = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  company: string | null;
  propertyId: string | null;
  matchedProperty: PropertyHit | null;
  properties: PropertyHit[];
  openEstimate: { id: string; label: string; totalCents: number } | null;
  membershipPlan: string | null;
};

function customerHref(prefix: string, customerId: string, propertyId?: string | null) {
  const base = `${prefix}/${customerId}`;
  return propertyId ? `${base}?propertyId=${propertyId}` : base;
}

export function CustomerSearchTypeahead({
  hrefPrefix = "/customers",
  placeholder = "Search name, phone, email, address, or company…",
  showActions = false,
}: {
  hrefPrefix?: string;
  placeholder?: string;
  showActions?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const response = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`);
      const data = (await response.json()) as { items?: Hit[] };
      setItems(data.items ?? []);
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="Search customers"
          className="h-12"
          autoComplete="off"
          inputMode="search"
        />
        {query ? (
          <button
            type="button"
            className="h-12 shrink-0 rounded-xl border border-[var(--border)] px-3 text-sm"
            onClick={() => {
              setQuery("");
              setItems([]);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {loading ? <p className="text-sm text-[var(--muted-foreground)]">Searching…</p> : null}
      {query.trim().length >= 2 && !loading && items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--muted-foreground)]">
          No customers match that search.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
          {items.map((item) => {
            const propertyId = item.propertyId ?? item.matchedProperty?.id ?? null;
            const displayAddress = item.matchedProperty?.label ?? item.address;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex min-h-[4.5rem] w-full flex-col items-start px-4 py-3 text-left transition hover:bg-[var(--cy-gray)]/60"
                  onClick={() => router.push(customerHref(hrefPrefix, item.id, propertyId))}
                >
                  <span className="font-medium text-[var(--cy-navy)]">{item.name}</span>
                  {displayAddress ? (
                    <span className="text-sm text-[var(--muted-foreground)]">{displayAddress}</span>
                  ) : null}
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {[item.phone, item.company].filter(Boolean).join(" · ") || item.email || "Open customer"}
                  </span>
                  {item.openEstimate ? (
                    <span className="mt-1 text-sm text-[var(--cy-orange)]">
                      {item.openEstimate.label} · {formatMoney(item.openEstimate.totalCents)}
                    </span>
                  ) : null}
                  {item.membershipPlan ? (
                    <span className="mt-1 inline-flex rounded-full bg-[var(--cy-orange-muted)] px-2 py-0.5 text-[11px] font-medium text-[#9A3412]">
                      {item.membershipPlan}
                    </span>
                  ) : null}
                </button>
                {showActions ? (
                  <div className="flex flex-wrap gap-2 border-t border-[var(--border)] px-4 py-2">
                    {item.phone ? (
                      <a href={`tel:${item.phone.replace(/\D/g, "")}`} className="text-xs font-medium text-[var(--cy-navy)] hover:underline">
                        Call
                      </a>
                    ) : null}
                    {item.phone ? (
                      <Link href={`/marketing/communications`} className="text-xs font-medium text-[var(--cy-navy)] hover:underline">
                        Text
                      </Link>
                    ) : null}
                    <Link href={`/office/jobs/new?customerId=${item.id}${propertyId ? `&propertyId=${propertyId}` : ""}`} className="text-xs font-medium text-[var(--cy-navy)] hover:underline">
                      New job
                    </Link>
                    <Link href="/dispatch" className="text-xs font-medium text-[var(--cy-navy)] hover:underline">
                      Schedule
                    </Link>
                    <Link href={`/estimates/new?customerId=${item.id}`} className="text-xs font-medium text-[var(--cy-navy)] hover:underline">
                      New estimate
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
