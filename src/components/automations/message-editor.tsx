"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renderFirstMessage } from "@/lib/conversations/personalization";

const tokens = [
  ["Customer First Name", "{{customer.firstName}}"],
  ["Company Name", "{{company.name}}"],
  ["Assistant Name", "{{assistant.name}}"],
  ["Appointment Window", "{{job.appointmentWindow}}"],
  ["Property Address", "{{property.address}}"],
  ["Technician First Name", "{{technician.firstName}}"],
  ["Promotion Offer", "{{promotion.offer}}"],
] as const;

export function MessageEditor({
  initialValue,
  companyName,
  assistantName,
}: {
  initialValue: string;
  companyName: string;
  assistantName: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [instruction, setInstruction] = useState("");
  const [writing, setWriting] = useState(false);
  const preview = useMemo(() => renderFirstMessage(value, {
    customerFirstName: "Sarah", companyName, assistantName, propertyAddress: "123 Main Street",
    appointmentWindow: "Tuesday between 1–3 PM", technicianFirstName: "JR",
  }), [value, companyName, assistantName]);

  async function rewrite() {
    if (!instruction.trim()) return;
    setWriting(true);
    try {
      const response = await fetch("/api/automations/write-message", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: value, instruction }),
      });
      const result = await response.json();
      if (response.ok && result.message) setValue(result.message);
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <Label htmlFor="firstMessage">First message</Label>
        <textarea id="firstMessage" name="firstMessage" value={value} onChange={(event) => setValue(event.target.value)} rows={5} className="w-full rounded-xl border px-3 py-2 text-sm" />
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-[var(--cy-orange)]">+ Personalize</summary>
          <div className="mt-2 flex flex-wrap gap-2">{tokens.map(([label, token]) => <Button key={token} type="button" size="sm" variant="outline" onClick={() => setValue((current) => `${current}${current.endsWith(" ") ? "" : " "}${token}`)}>{label}</Button>)}</div>
        </details>
        <div className="rounded-xl bg-[var(--cy-gray)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cy-navy)]">Write with Regina</p>
          <div className="mt-2 flex gap-2"><Input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Make this warmer and shorter." /><Button type="button" onClick={rewrite} disabled={writing}><Sparkles />{writing ? "Writing…" : "Rewrite"}</Button></div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">The suggestion stays in the editor for your review. It is never sent automatically.</p>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">Customer preview</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Sample data only. Nothing is sent.</p>
        <div className="mt-4 rounded-2xl bg-[var(--cy-navy)] px-4 py-3 text-sm text-white">{preview}</div>
      </div>
    </div>
  );
}
