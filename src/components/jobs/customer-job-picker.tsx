"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type JobPickerProperty = {
  id: string;
  label: string;
};

export type JobPickerCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  properties: JobPickerProperty[];
};

type SearchHit = JobPickerCustomer & {
  email?: string | null;
  company?: string | null;
};

export function CustomerJobPicker({
  defaultCustomer,
  defaultPropertyId,
}: {
  defaultCustomer?: JobPickerCustomer | null;
  defaultPropertyId?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<JobPickerCustomer | null>(defaultCustomer ?? null);
  const [propertyId, setPropertyId] = useState(
    defaultPropertyId && defaultCustomer?.properties.some((property) => property.id === defaultPropertyId)
      ? defaultPropertyId
      : defaultCustomer?.properties[0]?.id ?? ""
  );

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const response = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`);
      const data = (await response.json()) as { items?: SearchHit[] };
      setItems(data.items ?? []);
      setLoading(false);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, selected]);

  async function choose(hit: SearchHit) {
    let properties = hit.properties ?? [];
    if (properties.length === 0) {
      const response = await fetch(`/api/customers/${hit.id}/job-context`);
      if (response.ok) {
        const detail = (await response.json()) as JobPickerCustomer;
        properties = detail.properties;
        setSelected({ ...detail, properties });
        setPropertyId(properties.length === 1 ? properties[0]!.id : "");
        setQuery("");
        setItems([]);
        return;
      }
    }
    setSelected({ ...hit, properties });
    setPropertyId(properties.length === 1 ? properties[0]!.id : "");
    setQuery("");
    setItems([]);
  }

  function clear() {
    setSelected(null);
    setPropertyId("");
    setQuery("");
    setItems([]);
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="customerId" value={selected?.id ?? ""} required />
      <div className="space-y-2">
        <Label htmlFor="customer-search">Customer</Label>
        {selected ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-white px-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">{selected.name}</p>
              <p className="text-sm text-[var(--muted-foreground)]">
                {[selected.phone, selected.address].filter(Boolean).join(" · ") || "Customer selected"}
              </p>
            </div>
            <button type="button" className="text-sm font-medium underline" onClick={clear}>
              Change
            </button>
          </div>
        ) : (
          <>
            <Input
              id="customer-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a first or last name, phone, or address…"
              aria-label="Search customers by first or last name"
              autoComplete="off"
              inputMode="search"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              Start typing a first name or last name. You do not need the full name.
            </p>
            {loading ? <p className="text-sm text-[var(--muted-foreground)]">Searching…</p> : null}
            {query.trim().length >= 2 && !loading && items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--muted-foreground)]">
                No customers match that name.
              </p>
            ) : null}
            {items.length > 0 ? (
              <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex min-h-14 w-full flex-col items-start px-4 py-3 text-left"
                      onClick={() => void choose(item)}
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className="text-sm text-[var(--muted-foreground)]">
                        {[item.phone, item.address, item.company].filter(Boolean).join(" · ") || item.email}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="propertyId">Property</Label>
        <select
          id="propertyId"
          name="propertyId"
          required
          className={selectClassName}
          disabled={!selected}
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
        >
          <option value="">{selected ? "Select property…" : "Find a customer first"}</option>
          {(selected?.properties ?? []).map((property) => (
            <option key={property.id} value={property.id}>
              {property.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
