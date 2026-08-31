"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Hit = { type: string; href: string; title: string; detail: string };

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setItems([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = (await response.json()) as { items?: Hit[] };
      setItems(data.items ?? []);
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cy-text-muted)]" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search customers, jobs, invoices, estimates…"
        aria-label="Search ContractorYou"
        className="h-9 border-transparent bg-[var(--cy-gray)] pl-9 text-sm"
        autoComplete="off"
      />
      {loading || items.length > 0 || query.trim().length >= 2 ? (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
          {loading ? <p className="px-3 py-2 text-sm text-[var(--muted-foreground)]">Searching…</p> : null}
          {!loading && query.trim().length >= 2 && items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--muted-foreground)]">No records match that search.</p>
          ) : null}
          {items.map((item) => (
            <button
              key={`${item.type}-${item.href}`}
              type="button"
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-[var(--muted)]"
              onClick={() => {
                setQuery("");
                setItems([]);
                router.push(item.href);
              }}
            >
              <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{item.type}</span>
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{item.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
