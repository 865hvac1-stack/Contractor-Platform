"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

type Hit = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  company: string | null;
};

export function CustomerSearchTypeahead({
  hrefPrefix = "/customers",
  placeholder = "Search name, phone, email, address, or company…",
}: {
  hrefPrefix?: string;
  placeholder?: string;
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
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex min-h-16 w-full flex-col items-start px-4 py-3 text-left"
                onClick={() => router.push(`${hrefPrefix}/${item.id}`)}
              >
                <span className="font-medium text-[var(--cy-navy)]">{item.name}</span>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {[item.phone, item.address, item.company].filter(Boolean).join(" · ") ||
                    item.email ||
                    "Open customer"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
