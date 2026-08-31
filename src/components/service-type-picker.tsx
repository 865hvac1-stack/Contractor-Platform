"use client";

import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ServiceTypeOption = {
  id: string;
  name: string;
  description: string | null;
  playbookId: string | null;
};

const selectClassName =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ServiceTypePicker({
  types,
  defaultTypeId = "",
  descriptionName = "notes",
  defaultDescription = "",
  showPlaybookField = false,
  descriptionLabel = "Description",
}: {
  types: ServiceTypeOption[];
  defaultTypeId?: string;
  descriptionName?: string;
  defaultDescription?: string;
  showPlaybookField?: boolean;
  descriptionLabel?: string;
}) {
  const [selectedId, setSelectedId] = useState(defaultTypeId);
  const [description, setDescription] = useState(defaultDescription);
  const selected = useMemo(
    () => types.find((type) => type.id === selectedId) ?? null,
    [types, selectedId]
  );
  const chips = types.slice(0, 6);

  function applyType(id: string) {
    setSelectedId(id);
    const next = types.find((type) => type.id === id);
    if (next) setDescription(next.description || next.name);
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="serviceTypeId" value={selectedId} />
      <input type="hidden" name="jobType" value={selected?.name ?? ""} />
      {showPlaybookField ? (
        <input type="hidden" name="playbookId" value={selected?.playbookId ?? ""} />
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="serviceTypeSelect">Service type</Label>
        <select
          id="serviceTypeSelect"
          className={selectClassName}
          value={selectedId}
          onChange={(event) => applyType(event.target.value)}
        >
          <option value="">Select the kind of work…</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => applyType(type.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                selectedId === type.id
                  ? "border-[var(--cy-orange)] bg-[var(--cy-orange)]/10 text-[var(--foreground)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)]"
              }`}
            >
              {type.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={descriptionName}>{descriptionLabel}</Label>
        <Textarea
          id={descriptionName}
          name={descriptionName}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="You can edit this after choosing a service type."
        />
      </div>
    </div>
  );
}
