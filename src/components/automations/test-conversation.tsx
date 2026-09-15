"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TestConversation({ firstMessage, goal }: { firstMessage: string; goal: string | null }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Test conversation
      </Button>
    );
  }

  return (
    <section className="rounded-2xl border border-dashed border-[var(--cy-orange)] bg-orange-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">Safe simulation</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            No message is sent and no customer, schedule, or job is changed.
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        <div className="max-w-lg rounded-2xl bg-[var(--cy-navy)] px-4 py-3 text-sm text-white">{firstMessage}</div>
        <Input value={reply} onChange={(event) => setReply(event.target.value)} placeholder='Try: "Thursday works."' />
        {reply ? (
          <div className="max-w-lg rounded-2xl border bg-white px-4 py-3 text-sm">
            <p className="font-medium text-[var(--cy-navy)]">What Regina would do</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Continue the {goal?.toLowerCase().replaceAll("_", " ") || "configured"} goal, load only relevant
              ContractorYou context, and validate any action before confirming it.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
