"use client";

import { useMemo, useState, useTransition } from "react";
import { addPricebookItemToEstimateAction } from "@/server/actions/estimate-options";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = {
  id: string;
  name: string;
  sku: string | null;
  type: string;
  category: string;
  customerDescription: string | null;
  technicianNotes: string | null;
  standardPriceCents: number;
  memberPriceCents: number | null;
  unitPriceCents: number;
  memberEligible: boolean;
  unit: string;
};

export function PricebookPicker({
  estimateId,
  optionId,
  customerId,
  initialItems,
}: {
  estimateId: string;
  optionId?: string | null;
  customerId: string;
  initialItems: Item[];
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(initialItems);
  const [quantity, setQuantity] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [item.name, item.sku, item.customerDescription, item.category, item.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [items, query]);

  async function searchRemote(value: string) {
    setQuery(value);
    if (value.trim().length < 2) return;
    const response = await fetch(
      `/api/pricebook/search?q=${encodeURIComponent(value)}&customerId=${encodeURIComponent(customerId)}`
    );
    if (!response.ok) return;
    const data = (await response.json()) as { items: Item[] };
    setItems(data.items);
  }

  function add(item: Item) {
    startTransition(async () => {
      const form = new FormData();
      form.set("estimateId", estimateId);
      form.set("itemId", item.id);
      if (optionId) form.set("optionId", optionId);
      form.set("quantity", quantity[item.id] || "1");
      const result = await addPricebookItemToEstimateAction(null, form);
      setMessage(result.ok ? `Added ${item.name}` : result.error);
    });
  }

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(event) => searchRemote(event.target.value)}
        placeholder="Search capacitor, drain, maintenance…"
        className="h-11"
      />
      {message ? <p className="text-sm text-[var(--muted-foreground)]">{message}</p> : null}
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-white px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
          No Pricebook items match that search.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li key={item.id} className="rounded-xl border border-[var(--border)] bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--cy-navy)]">{item.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {item.category} · {item.type.replaceAll("_", " ")}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </p>
                  {item.customerDescription ? (
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">{item.customerDescription}</p>
                  ) : null}
                  <p className="mt-2 text-sm tabular-nums">
                    {formatMoney(item.unitPriceCents)}
                    {item.memberEligible ? (
                      <span className="ml-2 text-xs text-emerald-700">Member price</span>
                    ) : (
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                        {formatMoney(item.standardPriceCents)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Input
                    className="h-9 w-16"
                    inputMode="decimal"
                    value={quantity[item.id] ?? "1"}
                    onChange={(event) =>
                      setQuantity((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                  <Button type="button" size="sm" disabled={pending} onClick={() => add(item)}>
                    Add
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
