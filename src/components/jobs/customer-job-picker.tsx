"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  CustomerSearchCombobox,
  type CustomerSearchSelection,
} from "@/components/customers/search-combobox";

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

export function CustomerJobPicker({
  defaultCustomer,
  defaultPropertyId,
  canCreateCustomer = false,
}: {
  defaultCustomer?: JobPickerCustomer | null;
  defaultPropertyId?: string;
  canCreateCustomer?: boolean;
}) {
  const [selected, setSelected] = useState<JobPickerCustomer | null>(defaultCustomer ?? null);
  const [propertyId, setPropertyId] = useState(
    defaultPropertyId && defaultCustomer?.properties.some((property) => property.id === defaultPropertyId)
      ? defaultPropertyId
      : defaultCustomer?.properties[0]?.id ?? ""
  );

  async function choose(hit: CustomerSearchSelection) {
    const response = await fetch(`/api/customers/${hit.id}/job-context`);
    if (response.ok) {
      const detail = (await response.json()) as JobPickerCustomer;
      setSelected({ ...detail, address: hit.address ?? detail.address });
      setPropertyId(detail.properties.length === 1 ? detail.properties[0]!.id : "");
      return;
    }
    setSelected({ ...hit, properties: [] });
    setPropertyId("");
  }

  function clear() {
    setSelected(null);
    setPropertyId("");
  }

  return (
    <div className="space-y-4">
      <CustomerSearchCombobox
        selected={selected}
        onSelect={(hit) => void choose(hit)}
        onClear={clear}
        customerHrefPrefix="/office/customers"
        createHref={canCreateCustomer ? "/customers/new?returnTo=/jobs/new" : undefined}
        canCreate={canCreateCustomer}
        inputId="customer-search"
      />

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
