import Link from "next/link";
import { Sparkles, SlidersHorizontal } from "lucide-react";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createAutomationFromDescriptionAction,
  createManualAutomationAction,
} from "@/server/actions/custom-automations";
import { friendly, SUPPORTED_GOALS, SUPPORTED_TRIGGERS } from "@/lib/conversations/custom-automations";

export default async function CreateAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const ctx = await requirePermission("marketing:view");
  const canManage = can(ctx.role, "marketing:manage");
  const mode = (await searchParams).mode;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/marketing/automations" className="text-sm text-[var(--muted-foreground)] hover:underline">← Automations</Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--cy-orange)]">Create automation</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">What would you like ContractorYou to handle?</h1>
        <p className="mt-2 text-[var(--muted-foreground)]">Tell Regina what responsibility to take over. Nothing turns on until you review and approve it.</p>
      </header>

      {!mode ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Choice href="/marketing/automations/new?mode=describe" icon={<Sparkles />} title="Describe What You Want" subtitle="Tell ContractorYou what you want to happen in plain English." primary />
          <Choice href="/marketing/automations/new?mode=manual" icon={<SlidersHorizontal />} title="Build It Myself" subtitle="Choose the trigger, goal, audience, and Regina actions yourself." />
        </div>
      ) : mode === "manual" ? (
        <ActionForm action={createManualAutomationAction} className="space-y-6 rounded-2xl border bg-white p-6">
          <SectionHeader step="1" title="When should this start?" />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="Automation name" name="name" placeholder="6-Month Repair Follow-Up" />
            <SelectField label="When" name="trigger" options={SUPPORTED_TRIGGERS} />
            <InputField label="Wait (minutes)" name="delayMinutes" type="number" defaultValue="0" help="Examples: 1 day = 1440, 6 months = 259200." />
            <SelectField label="Who" name="audience" options={["EVENT_CUSTOMER", "RESIDENTIAL", "COMMERCIAL", "MAINTENANCE_MEMBERS", "NON_MEMBERS"]} />
          </div>
          <SectionHeader step="2" title="What should ContractorYou accomplish?" />
          <SelectField label="Business goal" name="goal" options={SUPPORTED_GOALS} />
          <SectionHeader step="3" title="What should Regina say first?" />
          <div className="space-y-2">
            <Label htmlFor="firstMessage">First message</Label>
            <textarea id="firstMessage" name="firstMessage" rows={4} required defaultValue="Hey {{customer.firstName}}, this is {{assistant.name}} with {{company.name}}. How can I help?" className={textareaClass} />
          </div>
          <label className="flex items-start gap-2 rounded-xl bg-[var(--cy-gray)] p-3 text-sm"><input type="checkbox" name="continueAnyway" value="true" className="mt-1" /> Continue even if a similar active automation exists.</label>
          <Button type="submit" disabled={!canManage}>Build draft for review</Button>
        </ActionForm>
      ) : (
        <ActionForm action={createAutomationFromDescriptionAction} className="space-y-5 rounded-2xl border bg-white p-6">
          <div className="flex items-center gap-2 text-[var(--cy-navy)]"><Sparkles className="text-[var(--cy-orange)]" /><h2 className="text-xl font-semibold">Describe what you want</h2></div>
          <div className="space-y-2">
            <Label htmlFor="request">Tell ContractorYou what you want handled...</Label>
            <textarea id="request" name="request" rows={7} required className={textareaClass} placeholder="When we finish an AC repair, wait 6 months and have Regina contact the customer about maintenance. If our tune-up promotion is active, mention it and try to get them booked." />
          </div>
          <div className="space-y-2 text-sm text-[var(--muted-foreground)]">
            <p className="font-medium text-[var(--cy-navy)]">Try describing:</p>
            <p>“When someone misses our call, have Regina text immediately and book a service call if possible.”</p>
            <p>“Follow up with open estimates after two days and create an office task if they want a person.”</p>
            <p>“Contact pool customers who haven’t had service in 90 days and try to schedule them again.”</p>
          </div>
          <label className="flex items-start gap-2 rounded-xl bg-[var(--cy-gray)] p-3 text-sm"><input type="checkbox" name="continueAnyway" value="true" className="mt-1" /> Continue anyway if ContractorYou finds an overlapping active automation.</label>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">ContractorYou will create a structured draft with least-privilege permissions. It will not activate automatically.</div>
          <Button type="submit" disabled={!canManage}><Sparkles /> Build my automation</Button>
        </ActionForm>
      )}
    </div>
  );
}

function Choice({ href, icon, title, subtitle, primary = false }: { href: string; icon: React.ReactNode; title: string; subtitle: string; primary?: boolean }) {
  return <Link href={href} className={`rounded-2xl border p-6 transition hover:-translate-y-0.5 hover:shadow-md ${primary ? "border-[var(--cy-orange)] bg-orange-50/40" : "bg-white"}`}><div className="text-[var(--cy-orange)]">{icon}</div><h2 className="mt-4 text-xl font-semibold text-[var(--cy-navy)]">{title}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{subtitle}</p><span className={`${buttonVariants({ variant: primary ? "default" : "outline" })} mt-5`}>Choose</span></Link>;
}
function SectionHeader({ step, title }: { step: string; title: string }) {
  return <div className="border-b pb-2"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--cy-orange)]">Step {step}</p><h2 className="font-semibold text-[var(--cy-navy)]">{title}</h2></div>;
}
function InputField({ label, name, help, ...props }: { label: string; name: string; help?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <div className="space-y-2"><Label htmlFor={name}>{label}</Label><input id={name} name={name} required className={inputClass} {...props} />{help ? <p className="text-xs text-[var(--muted-foreground)]">{help}</p> : null}</div>;
}
function SelectField({ label, name, options }: { label: string; name: string; options: readonly string[] }) {
  return <div className="space-y-2"><Label htmlFor={name}>{label}</Label><select id={name} name={name} className={inputClass}>{options.map((option) => <option key={option} value={option}>{friendly(option)}</option>)}</select></div>;
}
const inputClass = "h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm";
const textareaClass = "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";
