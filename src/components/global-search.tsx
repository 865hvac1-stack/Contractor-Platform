"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { GlobalSearchGroup, GlobalSearchHit } from "@/lib/search/global";

type SearchResponse = {
  items?: GlobalSearchHit[];
  groups?: GlobalSearchGroup[];
  error?: string;
};

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<GlobalSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(0);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      setError(null);
      setLoading(false);
      setOpen(false);
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setOpen(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = (await response.json()) as SearchResponse;
        if (!response.ok || data.error) {
          setGroups([]);
          setError("Search unavailable. Try again.");
        } else {
          setGroups(data.groups ?? []);
          setActive(0);
        }
      } catch {
        setGroups([]);
        setError("Search unavailable. Try again.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (window.matchMedia("(max-width: 767px)").matches) {
          setMobileOpen(true);
          window.setTimeout(() => mobileInputRef.current?.focus(), 0);
        } else {
          inputRef.current?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pick(href: string) {
    setQuery("");
    setGroups([]);
    setOpen(false);
    setMobileOpen(false);
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setMobileOpen(false);
      (event.target as HTMLInputElement).blur();
      return;
    }
    if (!flat.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (value + 1) % flat.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (value - 1 + flat.length) % flat.length);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = flat[active];
      if (hit) pick(hit.href);
    }
  }

  const panel = query.trim().length >= 2 && (open || mobileOpen);

  return (
    <>
      <button
        type="button"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--cy-navy)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy-navy)] md:hidden"
        aria-label="Search ContractorYou"
        onClick={() => setMobileOpen(true)}
      >
        <Search className="h-5 w-5" />
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-white md:hidden">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cy-text-muted)]" />
              <Input
                ref={mobileInputRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search customers, jobs…"
                aria-label="Search ContractorYou"
                aria-controls={listId}
                aria-expanded={panel}
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
                setGroups([]);
              }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="max-h-[calc(100vh-4.5rem)] overflow-y-auto">
            <SearchResults
              id={listId}
              loading={loading}
              error={error}
              query={query}
              groups={groups}
              active={active}
              onHover={setActive}
              onPick={pick}
            />
          </div>
        </div>
      ) : null}

      <div className="relative hidden min-w-0 flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cy-text-muted)]" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Search customers, jobs, invoices, estimates…"
          aria-label="Search ContractorYou"
          aria-controls={listId}
          aria-expanded={panel}
          aria-autocomplete="list"
          className="h-9 border-transparent bg-[var(--cy-gray)] pl-9 pr-14 text-sm focus-visible:ring-2 focus-visible:ring-[var(--cy-navy)]"
          autoComplete="off"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)] lg:inline">
          ⌘K
        </kbd>
        {panel ? (
          <div className="absolute z-50 mt-1 max-h-[min(28rem,70vh)] w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-white shadow-[0_16px_40px_rgba(11,18,32,0.14)]">
            <SearchResults
              id={listId}
              loading={loading}
              error={error}
              query={query}
              groups={groups}
              active={active}
              onHover={setActive}
              onPick={pick}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function SearchResults({
  id,
  loading,
  error,
  query,
  groups,
  active,
  onHover,
  onPick,
}: {
  id: string;
  loading: boolean;
  error: string | null;
  query: string;
  groups: GlobalSearchGroup[];
  active: number;
  onHover: (index: number) => void;
  onPick: (href: string) => void;
}) {
  let offset = 0;
  return (
    <div id={id} role="listbox" className="py-1">
      {loading ? (
        <div className="space-y-2 px-3 py-3" aria-live="polite">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">Searching…</p>
          <div className="h-10 animate-pulse rounded-lg bg-[var(--cy-gray)]" />
          <div className="h-10 animate-pulse rounded-lg bg-[var(--cy-gray)]" />
        </div>
      ) : null}
      {!loading && error ? (
        <p className="px-3 py-3 text-sm text-[var(--cy-navy)]" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && query.trim().length >= 2 && groups.length === 0 ? (
        <p className="px-3 py-3 text-sm text-[var(--cy-navy)]">No results for “{query.trim()}”</p>
      ) : null}
      {!loading &&
        groups.map((group) => {
          const start = offset;
          offset += group.items.length;
          return (
            <div key={group.type} className="px-1 pb-1">
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
                {group.label}
              </p>
              {group.items.map((item, index) => {
                const flatIndex = start + index;
                return (
                  <button
                    key={`${item.type}-${item.href}`}
                    type="button"
                    role="option"
                    aria-selected={flatIndex === active}
                    className={`flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left ${
                      flatIndex === active ? "bg-[var(--cy-gray)]" : "hover:bg-[var(--cy-gray)]"
                    }`}
                    onMouseEnter={() => onHover(flatIndex)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(item.href)}
                  >
                    <span className="text-sm font-medium text-[var(--cy-navy)]">{item.title}</span>
                    <span className="text-xs text-[var(--cy-text-secondary)]">{item.detail}</span>
                  </button>
                );
              })}
              {group.moreHref ? (
                <button
                  type="button"
                  className="px-3 py-2 text-xs font-medium text-[var(--cy-orange)]"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(group.moreHref!)}
                >
                  View all results →
                </button>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}
