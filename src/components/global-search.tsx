"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

type Hit = { type: string; href: string; title: string; detail: string };

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const results = loading || items.length > 0 || query.trim().length >= 2;

  return (
    <>
      <button
        type="button"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--cy-navy)] md:hidden"
        aria-label="Search ContractorYou"
        onClick={() => setMobileOpen(true)}
      >
        <Search className="h-5 w-5" />
      </button>

      {mobileOpen ? (
        <div className="fixed inset-x-0 top-14 z-40 border-b border-[var(--border)] bg-white p-3 shadow-md md:hidden">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cy-text-muted)]" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customers, jobs…"
                aria-label="Search ContractorYou"
                className="h-11 border-transparent bg-[var(--cy-gray)] pl-9 text-sm"
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-lg"
              aria-label="Close search"
              onClick={() => {
                setMobileOpen(false);
                setQuery("");
                setItems([]);
              }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {results ? (
            <div className="mt-2 max-h-[50vh] overflow-y-auto">
              <SearchResults
                loading={loading}
                query={query}
                items={items}
                onPick={(href) => {
                  setQuery("");
                  setItems([]);
                  setMobileOpen(false);
                  router.push(href);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative hidden min-w-0 flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cy-text-muted)]" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customers, jobs, invoices, estimates…"
          aria-label="Search ContractorYou"
          className="h-9 border-transparent bg-[var(--cy-gray)] pl-9 text-sm"
          autoComplete="off"
        />
        {results ? (
          <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
            <SearchResults
              loading={loading}
              query={query}
              items={items}
              onPick={(href) => {
                setQuery("");
                setItems([]);
                router.push(href);
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function SearchResults({
  loading,
  query,
  items,
  onPick,
}: {
  loading: boolean;
  query: string;
  items: Hit[];
  onPick: (href: string) => void;
}) {
  return (
    <>
      {loading ? <p className="px-3 py-2 text-sm text-[var(--muted-foreground)]">Searching…</p> : null}
      {!loading && query.trim().length >= 2 && items.length === 0 ? (
        <p className="px-3 py-2 text-sm text-[var(--muted-foreground)]">No records match that search.</p>
      ) : null}
      {items.map((item) => (
        <button
          key={`${item.type}-${item.href}`}
          type="button"
          className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-[var(--muted)]"
          onClick={() => onPick(item.href)}
        >
          <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{item.type}</span>
          <span className="text-sm font-medium">{item.title}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{item.detail}</span>
        </button>
      ))}
    </>
  );
}
