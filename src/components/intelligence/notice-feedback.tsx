"use client";

import { useState } from "react";

export function NoticeFeedback({ noticeId }: { noticeId: string }) {
  const [choice, setChoice] = useState<"helpful" | "not_useful" | "dismissed" | null>(null);
  if (choice === "dismissed") return null;
  if (choice) {
    return <p className="mt-3 text-xs text-[var(--cy-text-muted)]">Thanks — that stays on this notice only.</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-notice={noticeId}>
      <button
        type="button"
        onClick={() => setChoice("helpful")}
        className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 text-[11px] text-[var(--cy-navy)] hover:bg-[var(--cy-navy)]/8"
      >
        Helpful
      </button>
      <button
        type="button"
        onClick={() => setChoice("not_useful")}
        className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 text-[11px] text-[var(--cy-navy)] hover:bg-[var(--cy-navy)]/8"
      >
        Not useful
      </button>
      <button
        type="button"
        onClick={() => setChoice("dismissed")}
        className="rounded-full px-2.5 py-1 text-[11px] text-[var(--cy-text-muted)] hover:text-[var(--cy-navy)]"
      >
        Dismiss
      </button>
    </div>
  );
}
