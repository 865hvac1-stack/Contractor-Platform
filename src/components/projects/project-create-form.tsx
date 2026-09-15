"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProjectAction } from "@/server/actions/projects";
import { PROJECT_PHASE_TEMPLATES, PROJECT_TYPES, friendlyProject } from "@/lib/projects/core";

type CustomerOption = {
  id: string;
  label: string;
  phone: string | null;
  properties: Array<{ id: string; label: string }>;
};

export function ProjectCreateForm({ customers, managers }: { customers: CustomerOption[]; managers: Array<{ id: string; label: string }> }) {
  const [type, setType] = useState<(typeof PROJECT_TYPES)[number]>("NEW_CONSTRUCTION");
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [phases, setPhases] = useState<string[]>(PROJECT_PHASE_TEMPLATES.NEW_CONSTRUCTION);
  const selected = useMemo(() => customers.find((customer) => customer.id === customerId), [customers, customerId]);

  function chooseType(next: (typeof PROJECT_TYPES)[number]) {
    setType(next);
    setPhases([...PROJECT_PHASE_TEMPLATES[next]]);
  }
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= phases.length) return;
    setPhases((current) => {
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  return (
    <ActionForm action={createProjectAction} className="space-y-8">
      <section className="rounded-2xl border bg-white p-5">
        <Step number="1" title="Project type" help="This only suggests a starting structure. Every project uses the same engine." />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PROJECT_TYPES.map((value) => <button key={value} type="button" onClick={() => chooseType(value)} className={`rounded-xl border p-3 text-left text-sm font-medium ${type === value ? "border-[var(--cy-orange)] bg-orange-50 text-[var(--cy-navy)]" : "bg-white"}`}>{friendlyProject(value)}</button>)}</div>
        <input type="hidden" name="type" value={type} />
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <Step number="2" title="Project information" help="Create quickly. Add details progressively in Project 360." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Project name"><Input name="name" required placeholder="Smith Residence — Lot 42" /></Field>
          <Field label="Customer / Builder / GC"><select name="customerId" value={customerId} onChange={(event) => setCustomerId(event.target.value)} className={selectClass}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}</select></Field>
          <Field label="Property / project address"><select name="propertyId" className={selectClass}>{selected?.properties.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}</select></Field>
          <Field label="Builder / GC name"><Input name="builderName" placeholder="ABC Builders" /></Field>
          <Field label="Primary contact"><Input name="primaryContactName" /></Field>
          <Field label="Contact phone"><Input name="primaryContactPhone" /></Field>
          <Field label="Project manager"><select name="projectManagerId" className={selectClass}><option value="">Unassigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.label}</option>)}</select></Field>
          <Field label="Original contract / sold value"><Input name="originalContract" type="number" min="0" step="0.01" placeholder="18750.00" /></Field>
          <Field label="Estimated start"><Input name="estimatedStart" type="date" /></Field>
          <Field label="Target completion"><Input name="targetCompletion" type="date" /></Field>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <Step number="3" title="Phases" help="Suggested from project type. Rename, add, remove, or reorder." />
        <div className="mt-4 space-y-2">{phases.map((phase, index) => <div key={`${index}-${phase}`} className="flex items-center gap-2"><Input name="phases" value={phase} onChange={(event) => setPhases((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><Button type="button" size="sm" variant="outline" onClick={() => move(index, -1)} disabled={index === 0}>↑</Button><Button type="button" size="sm" variant="outline" onClick={() => move(index, 1)} disabled={index === phases.length - 1}>↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => setPhases((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}</div>
        <Button type="button" variant="outline" className="mt-3" onClick={() => setPhases((current) => [...current, "New Phase"])}>+ Add phase</Button>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <Step number="4" title="Initial budget" help="Optional planning values. Currency is stored in integer cents." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Labor hours"><Input name="laborBudgetHours" type="number" min="0" step="0.25" /></Field>
          <Field label="Labor cost"><Input name="laborBudgetCost" type="number" min="0" step="0.01" /></Field>
          <Field label="Equipment"><Input name="equipmentBudget" type="number" min="0" step="0.01" /></Field>
          <Field label="Materials"><Input name="materialsBudget" type="number" min="0" step="0.01" /></Field>
          <Field label="Other costs"><Input name="otherBudget" type="number" min="0" step="0.01" /></Field>
        </div>
      </section>
      <section className="flex flex-col gap-3 rounded-2xl border border-[var(--cy-orange)] bg-orange-50 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-[var(--cy-navy)]">Ready to create the operational record?</p><p className="text-sm text-[var(--muted-foreground)]">No visits, messages, invoices, or inventory movements happen automatically.</p></div><Button type="submit" size="lg">Create Project</Button></section>
    </ActionForm>
  );
}

function Step({ number, title, help }: { number: string; title: string; help: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--cy-orange)]">Step {number}</p><h2 className="mt-1 text-lg font-semibold text-[var(--cy-navy)]">{title}</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">{help}</p></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}
const selectClass = "h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm";
