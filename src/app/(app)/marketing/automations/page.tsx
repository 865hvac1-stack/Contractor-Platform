import { requirePermission } from "@/lib/tenant";
import Link from "next/link";
import { can } from "@/lib/permissions";
import { loadAutomationDashboard } from "@/lib/conversations/automations";
import { toggleAutomationAction } from "@/server/actions/conversations";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { duplicateAutomationAction } from "@/server/actions/custom-automations";

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const ctx = await requirePermission("marketing:view");
  const { automations, metrics } = await loadAutomationDashboard(ctx.company.id);
  const canManage = can(ctx.role, "marketing:manage");
  const { q = "", filter = "all" } = await searchParams;
  const recommended = automations.filter((automation) => Boolean(automation.templateKey));
  const custom = automations.filter((automation) => !automation.templateKey).filter((automation) => {
    if (q && !automation.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "active" && !automation.enabled) return false;
    if (filter === "paused" && automation.enabled) return false;
    if (filter === "conversations" && automation.mode !== "START_CONVERSATION") return false;
    if (filter === "static" && automation.mode !== "SEND_MESSAGE") return false;
    return true;
  });

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Automations</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            Put your customer follow-up on autopilot — while keeping every interaction personal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/marketing/promotions" className="text-sm font-semibold text-[var(--cy-orange)] hover:underline">
            Promotions Bank →
          </Link>
          {canManage ? (
            <Link href="/marketing/automations/new" className="rounded-lg bg-[var(--cy-orange)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">
              + Create Automation
            </Link>
          ) : null}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Active conversations" value={metrics.activeConversations} />
        <Metric label="Customers engaged" value={metrics.customersEngaged} />
        <Metric label="Booked by Regina" value={metrics.appointmentsBooked} />
        <Metric label="Needs human" value={metrics.needsHuman} tone={metrics.needsHuman ? "attention" : "normal"} />
      </section>

      <section>
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--cy-orange)]">
            What should ContractorYou handle for you?
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">Recommended automations</h2>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {recommended.map((automation) => {
            const customers = new Set(automation.executions.map((row) => row.customerId).filter(Boolean)).size;
            const conversions = automation.executions.filter((row) => row.goalCompletedAt).length;
            const handoffs = automation.executions.filter((row) => row.humanTakeoverAt).length;
            return (
              <article key={automation.id} className="rounded-2xl border border-[var(--border)] bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[var(--cy-navy)]">{automation.name}</h3>
                      <StatusBadge status={automation.enabled ? "ON" : "OFF"} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {automation.templateKey
                        ? automationDescription(automation.templateKey)
                        : `${automation.trigger.replaceAll("_", " ")} follow-up`}
                    </p>
                  </div>
                  {canManage ? (
                    <ActionForm
                      action={toggleAutomationAction}
                      successMessage={automation.enabled ? "Automation paused." : "Automation turned on."}
                    >
                      <input type="hidden" name="automationId" value={automation.id} />
                      <input type="hidden" name="enable" value={automation.enabled ? "false" : "true"} />
                      <Button type="submit" size="sm" variant={automation.enabled ? "outline" : "default"}>
                        {automation.enabled ? "Turn off" : "Turn on"}
                      </Button>
                    </ActionForm>
                  ) : null}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
                  <Stat label="Channel" value={automation.channel} />
                  <Stat label="Regina" value={automation.mode === "START_CONVERSATION" ? "Active" : "Static"} />
                  <Stat label="Engaged" value={String(customers)} />
                  <Stat label="Goal wins" value={String(conversions)} />
                </dl>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>
                    {automation.lastTriggeredAt
                      ? `Last triggered ${automation.lastTriggeredAt.toLocaleDateString()}`
                      : "Not triggered yet"}
                    {handoffs ? ` · ${handoffs} human handoff${handoffs === 1 ? "" : "s"}` : ""}
                  </span>
                  <Link href={`/marketing/automations/${automation.id}`} className="font-semibold text-[var(--cy-orange)] hover:underline">
                    Configure →
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--cy-orange)]">Built for your business</p>
            <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">My automations</h2>
          </div>
          <form className="flex flex-col gap-2 sm:flex-row">
            <Input name="q" defaultValue={q} placeholder="Search automations" className="sm:w-64" />
            <select name="filter" defaultValue={filter} className="h-8 rounded-lg border bg-white px-3 text-sm">
              <option value="all">All custom</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="conversations">Regina conversations</option>
              <option value="static">Static messages</option>
            </select>
            <Button type="submit" variant="outline">Filter</Button>
          </form>
        </div>
        {custom.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {custom.map((automation) => {
              const customers = new Set(automation.executions.map((row) => row.customerId).filter(Boolean)).size;
              const wins = automation.executions.filter((row) => row.goalCompletedAt).length;
              return (
                <article key={automation.id} className="rounded-2xl border bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[var(--cy-navy)]">{automation.name}</h3>
                        <StatusBadge status={automation.enabled ? "ON" : "OFF"} />
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{friendly(automation.trigger)} → {friendly(automation.goal || "No goal")}</p>
                    </div>
                    <span className="rounded-full bg-[var(--cy-gray)] px-2 py-1 text-[10px] font-semibold uppercase">{friendly(automation.sourceType)}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
                    <Stat label="Audience" value={friendly(automation.audience)} />
                    <Stat label="Regina" value={automation.mode === "START_CONVERSATION" ? "Conversation" : "Static"} />
                    <Stat label="Engaged" value={String(customers)} />
                    <Stat label="Goal wins" value={String(wins)} />
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[var(--muted-foreground)]">{automation.lastTriggeredAt ? `Last triggered ${automation.lastTriggeredAt.toLocaleDateString()}` : "Not triggered yet"}{automation.promotion ? ` · ${automation.promotion.name}` : ""}</span>
                    <div className="flex items-center gap-3">
                      {canManage ? <ActionForm action={duplicateAutomationAction}><input type="hidden" name="automationId" value={automation.id} /><button className="text-xs font-semibold text-[var(--cy-navy)] hover:underline">Duplicate</button></ActionForm> : null}
                      <Link href={`/marketing/automations/${automation.id}`} className="text-xs font-semibold text-[var(--cy-orange)] hover:underline">Configure →</Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
            <p className="font-medium text-[var(--cy-navy)]">Tell ContractorYou what you want handled.</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Your custom Regina automations will appear here.</p>
            {canManage ? <Link href="/marketing/automations/new" className="mt-4 inline-block font-semibold text-[var(--cy-orange)] hover:underline">+ Create Automation</Link> : null}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "attention" }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 ${tone === "attention" ? "border-amber-300" : "border-[var(--border)]"}`}>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-[var(--cy-navy)]">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-1 font-medium text-[var(--cy-navy)]">{value}</dd>
    </div>
  );
}

const descriptions: Record<string, string> = {
  MISSED_CALL_TEXT_BACK: "Regina responds to verified missed calls and helps customers get service.",
  NEW_LEAD_CONVERSATION: "Regina follows up personally and gathers only what is needed to move forward.",
  BOOKING_CONFIRMATION: "Confirms real bookings and routes changes through the existing schedule.",
  APPOINTMENT_REMINDER: "Reminds customers about the current appointment without stale or duplicate notices.",
  TECHNICIAN_ON_THE_WAY: "Introduces the assigned technician and keeps pre-arrival requests with the job.",
  JOB_COMPLETE_FOLLOW_UP: "Checks in after completed work and escalates unresolved concerns.",
  REVIEW_REQUEST: "Requests a review after eligible work when there is no unresolved complaint.",
  UNSOLD_ESTIMATE_FOLLOW_UP: "Answers factual estimate questions without negotiating unauthorized prices.",
  MAINTENANCE_DUE: "Starts a personal maintenance conversation and books through real availability.",
  MEMBERSHIP_RENEWAL: "Helps customers with an expiring plan and involves the office when needed.",
  PAST_CUSTOMER_REACTIVATION: "Reconnects with eligible past customers while respecting consent and quiet hours.",
  PAYMENT_REMINDER: "Uses verified balances and directs customers to a secure payment flow.",
  PROMOTIONAL_CAMPAIGN: "Starts a personal conversation using a currently valid configured offer.",
};

function automationDescription(key: string) {
  return descriptions[key] || "Customer follow-up handled through ContractorYou.";
}

function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
