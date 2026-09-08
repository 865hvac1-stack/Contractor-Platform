"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type CustomerSearchSelection = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  company?: string | null;
};

type SearchHit = CustomerSearchSelection & {
  email?: string | null;
  company?: string | null;
};

export function CustomerSearchCombobox({
  name = "customerId",
  required = true,
  label = "Customer",
  placeholder = "Search customer by name, phone, email, or address...",
  selected,
  onSelect,
  onClear,
  canCreate = false,
  createHref,
  customerHrefPrefix = "/office/customers",
  showContext = true,
  inputId,
}: {
  name?: string;
  required?: boolean;
  label?: string;
  placeholder?: string;
  selected?: CustomerSearchSelection | null;
  onSelect?: (customer: CustomerSearchSelection) => void;
  onClear?: () => void;
  canCreate?: boolean;
  createHref?: string;
  customerHrefPrefix?: string;
  showContext?: boolean;
  inputId?: string;
}) {
  const generatedId = useId();
  const fieldId = inputId ?? `customer-search-${generatedId}`;
  const listId = `${fieldId}-list`;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [value, setValue] = useState<CustomerSearchSelection | null>(selected ?? null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setValue(selected ?? null);
  }, [selected]);

  useEffect(() => {
    if (value || query.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const response = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`);
      const data = (await response.json()) as { items?: SearchHit[] };
      setItems(data.items ?? []);
      setActiveIndex(0);
      setOpen(true);
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, value]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function choose(hit: SearchHit) {
    const next = {
      id: hit.id,
      name: hit.name,
      phone: hit.phone,
      email: hit.email,
      address: hit.address,
      company: hit.company,
    };
    setValue(next);
    setQuery("");
    setItems([]);
    setOpen(false);
    onSelect?.(next);
  }

  function clear() {
    setValue(null);
    setQuery("");
    setItems([]);
    setOpen(false);
    onClear?.();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % items.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + items.length) % items.length);
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const hit = items[activeIndex];
      if (hit) choose(hit);
    }
  }

  const contextBits = [value?.address, value?.phone].filter(Boolean);
  const empty = query.trim().length >= 2 && !loading && items.length === 0 && !value;

  return (
    <div ref={rootRef} className="space-y-2">
      <input type="hidden" name={name} value={value?.id ?? ""} required={required} />
      <Label htmlFor={fieldId}>{label}</Label>
      {value ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-white px-3 py-3">
          <div className="min-w-0">
            <p className="font-medium text-[var(--cy-navy)]">{value.name}</p>
            {showContext && contextBits.length > 0 ? (
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{contextBits.join(" · ")}</p>
            ) : null}
            {showContext ? (
              <Link
                href={`${customerHrefPrefix}/${value.id}`}
                className="mt-1 inline-block text-sm font-medium text-[var(--cy-orange)] hover:underline"
              >
                View Customer →
              </Link>
            ) : null}
          </div>
          <button type="button" className="shrink-0 text-sm font-medium underline" onClick={clear}>
            Change
          </button>
        </div>
      ) : (
        <>
          <Input
            id={fieldId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && items[activeIndex] ? `${listId}-${items[activeIndex]!.id}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (items.length) setOpen(true);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            inputMode="search"
            className="h-12"
          />
          {loading ? <p className="text-sm text-[var(--muted-foreground)]">Searching…</p> : null}
          {empty ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3">
              <p className="text-sm text-[var(--muted-foreground)]">No customers match that search.</p>
              {canCreate && createHref ? (
                <Link href={createHref} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-[var(--cy-orange)]">
                  + Add new customer
                </Link>
              ) : null}
            </div>
          ) : null}
          {open && items.length > 0 ? (
            <ul id={listId} role="listbox" className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
              {items.map((item, index) => {
                const lines = [item.company, item.address, item.phone, item.email].filter(Boolean);
                return (
                  <li key={item.id} role="presentation">
                    <button
                      id={`${listId}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={cn(
                        "flex min-h-14 w-full flex-col items-start px-4 py-3 text-left",
                        index === activeIndex && "bg-[var(--cy-gray)]"
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(item)}
                    >
                      <span className="font-medium text-[var(--cy-navy)]">{item.name}</span>
                      {lines.map((line) => (
                        <span key={line} className="text-sm text-[var(--muted-foreground)]">
                          {line}
                        </span>
                      ))}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
