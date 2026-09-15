"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Turn = { role: "REGINA" | "CUSTOMER"; text: string; wouldDo?: string };

export function TestConversation({ firstMessage, goal, allowedActions = [] }: { firstMessage: string; goal: string | null; allowedActions?: string[] }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [turns, setTurns] = useState<Turn[]>([{ role: "REGINA", text: firstMessage }]);
  const [pending, setPending] = useState(false);

  async function sendReply() {
    const text = reply.trim();
    if (!text || pending) return;
    const next = [...turns, { role: "CUSTOMER" as const, text }];
    setTurns(next);
    setReply("");
    setPending(true);
    try {
      const response = await fetch("/api/automations/simulate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: goal || "FOLLOW_UP_COMPLETED_JOB", allowedActions, customerMessage: text, history: next }),
      });
      const result = await response.json();
      if (response.ok) setTurns((current) => [...current, { role: "REGINA", text: result.response, wouldDo: result.wouldDo }]);
    } finally {
      setPending(false);
    }
  }

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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">Test mode · safe simulation</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            No message is sent and no customer, schedule, or job is changed.
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        {turns.map((turn, index) => <div key={`${turn.role}-${index}`} className="space-y-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{turn.role === "REGINA" ? "Regina" : "Test customer"}</p><div className={`max-w-lg rounded-2xl px-4 py-3 text-sm ${turn.role === "REGINA" ? "bg-[var(--cy-navy)] text-white" : "ml-auto border bg-white"}`}>{turn.text}</div>{turn.wouldDo ? <div className="max-w-lg rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"><strong>REGINA WOULD:</strong> {turn.wouldDo}. No action was executed.</div> : null}</div>)}
        <div className="flex gap-2"><Input value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void sendReply(); } }} placeholder='Act like the customer: "Thursday afternoon works better."' /><Button type="button" onClick={sendReply} disabled={pending}>{pending ? "Thinking…" : "Send test reply"}</Button></div>
      </div>
    </section>
  );
}
