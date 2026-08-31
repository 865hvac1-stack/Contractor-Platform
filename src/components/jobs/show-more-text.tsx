"use client";

import { useState } from "react";

export function ShowMoreText({
  text,
  limit = 420,
}: {
  text: string;
  limit?: number;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  const body = open || !long ? text : `${text.slice(0, limit).trimEnd()}…`;
  return (
    <div>
      <p className="whitespace-pre-wrap text-sm leading-6">{body}</p>
      {long ? (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-[var(--cy-navy)] underline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
