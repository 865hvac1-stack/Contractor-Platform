"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/** Converts HTML date (YYYY-MM-DD) into ISO datetime for zod .datetime() validators. */
export function IsoDateField({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${name}-visible`}>{label}</Label>
      <Input
        id={`${name}-visible`}
        type="date"
        required={required}
        onChange={(e) => {
          const hidden = e.currentTarget.form?.elements.namedItem(name);
          if (hidden && hidden instanceof HTMLInputElement) {
            hidden.value = e.target.value ? `${e.target.value}T00:00:00.000Z` : "";
          }
        }}
      />
      <input type="hidden" name={name} defaultValue="" />
    </div>
  );
}
