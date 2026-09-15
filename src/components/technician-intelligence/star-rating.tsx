"use client";

import { useState } from "react";

export function StarRating({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: number | null;
}) {
  const [value, setValue] = useState(defaultValue ?? 3);
  return (
    <fieldset className="flex items-center gap-0.5" aria-label="Skill rating">
      {[1, 2, 3, 4, 5].map((rating) => (
        <label key={rating} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={rating}
            checked={value === rating}
            onChange={() => setValue(rating)}
            className="sr-only"
          />
          <span
            aria-hidden="true"
            className={`text-2xl leading-none ${rating <= value ? "text-amber-400" : "text-slate-200"}`}
          >
            ★
          </span>
          <span className="sr-only">{rating} out of 5</span>
        </label>
      ))}
    </fieldset>
  );
}
