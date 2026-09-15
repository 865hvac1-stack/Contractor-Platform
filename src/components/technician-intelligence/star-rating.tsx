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
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Skill rating">
      <input type="hidden" name={name} value={value} />
      {[1, 2, 3, 4, 5].map((rating) => {
        const selected = rating === value;
        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${rating} out of 5`}
            data-rating={rating}
            onClick={() => setValue(rating)}
            className={`rounded px-0.5 text-2xl leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              rating <= value ? "text-amber-400" : "text-slate-200"
            }`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
