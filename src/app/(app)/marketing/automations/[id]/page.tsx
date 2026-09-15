import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { loadReceptionistSettings } from "@/lib/intelligence/receptionist/settings";
import { renderFirstMessage } from "@/lib/conversations/personalization";
import {
  toggleAutomationAction,
  updateConversationAutomationAction,
} from "@/server/actions/conversations";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TestConversation } from "@/components/automations/test-conversation";
import { MessageEditor } from "@/components/automations/message-editor";
import { automationReadiness } from "@/lib/conversations/readiness";
import { ACTION_LABELS, GOAL_ACTIONS, REGINA_NEVER, friendly, friendlyDelay } from "@/lib/conversations/custom-automations";
import { duplicateAutomationAction } from "@/server/actions/custom-automations";

export default async function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("marketing:view");
  const { id } = await params;
  const [automation, promotions, settings] = await Promise.all([
    prisma.automation.findFirst({
      where: { id, companyId: ctx.company.id },
      include: { promotion: true },
    }),
    prisma.promotion.findMany({
      where: { companyId: ctx.company.id, status: { in: ["ACTIVE", "SCHEDULED", "DRAFT"] } },
      orderBy: { startsAt: "desc" },
    }),
    loadReceptionistSettings(ctx.company.id),
  ]);
  if (!automation) notFound();
  const canManage = can(ctx.role, "marketing:manage");
  const readiness = await automationReadiness(automation);
  const relevantActions = GOAL_ACTIONS[automation.goal || ""] || ["CREATE_FOLLOW_UP", "REQUEST_HUMAN_HANDOFF"];
  const selectedConditions = conditionList(automation.conditions);
  const preview = renderFirstMessage(automation.firstMessage || "", {
    customerFirstName: "Sarah",
    companyName: ctx.company.businessName,
    assistantName: settings.assistantName,
    propertyAddress: "123 Main Street",
    appointmentWindow: "Tuesday between 1–3 PM",
    technicianFirstName: "JR",
    eta: "1:25 PM",
    reviewLink: "your review link",
    promotion: automation.promotion,
  });

  return (
    <div className="space-y-6">
      <Link href="/marketing/automations" className="text-sm text-[var(--muted-foreground)] hover:underline">
        ← Automations
      </Link>
      <header className="flex flex-col gap-3 rounded-2xl border bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
            Customer conversation
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--cy-navy)]">{automation.name}</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {automation.enabled ? "On and listening for its event." : "Off. Configuration and previews never send messages."}
          </p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <ActionForm action={duplicateAutomationAction}><input type="hidden" name="automationId" value={automation.id} /><Button type="submit" variant="outline">Duplicate</Button></ActionForm>
            <ActionForm action={toggleAutomationAction} successMessage={automation.enabled ? "Automation paused." : "Automation turned on."}>
              <input type="hidden" name="automationId" value={automation.id} />
              <input type="hidden" name="enable" value={automation.enabled ? "false" : "true"} />
              <Button type="submit" variant={automation.enabled ? "outline" : "default"}>
                {automation.enabled ? "Pause" : "Turn on"}
              </Button>
            </ActionForm>
          </div>
        ) : null}
      </header>

      <ActionForm
        action={updateConversationAutomationAction}
        successMessage="Automation settings saved."
        className="space-y-5 rounded-2xl border bg-white p-5"
      >
        <input type="hidden" name="automationId" value={automation.id} />
        {automation.sourceRequest ? <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--cy-orange)]">You asked ContractorYou</p><p className="mt-2 text-sm text-[var(--cy-navy)]">“{automation.sourceRequest}”</p></div> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="When" value={friendly(automation.trigger)} />
          <Field label="Wait" value={automation.delayMinutes ? friendlyDelay(automation.delayMinutes) : "Immediately"} />
          <Field label="Who" value={automation.templateKey ? audienceFor(automation.templateKey) : friendly(automation.audience)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="audience">Audience</Label><select id="audience" name="audience" defaultValue={automation.audience} disabled={!canManage} className={selectClass}>{["EVENT_CUSTOMER", "RESIDENTIAL", "COMMERCIAL", "MAINTENANCE_MEMBERS", "NON_MEMBERS"].map((value) => <option key={value} value={value}>{friendly(value)}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="delayMinutes">Wait (minutes)</Label><input id="delayMinutes" name="delayMinutes" type="number" min={0} max={525600} defaultValue={automation.delayMinutes} disabled={!canManage} className={selectClass} /><p className="text-xs text-[var(--muted-foreground)]">Server-side timing. 1 day = 1440; 6 months = 259200.</p></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mode">Start</Label>
            <select id="mode" name="mode" defaultValue={automation.mode} disabled={!canManage} className={selectClass}>
              <option value="START_CONVERSATION">Conversation with Regina</option>
              <option value="SEND_MESSAGE">Send one message</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal">Business goal</Label>
            <select id="goal" name="goal" defaultValue={automation.goal || ""} disabled={!canManage} className={selectClass}>
              {GOALS.map((goal) => (
                <option key={goal} value={goal}>{friendly(goal)}</option>
              ))}
            </select>
          </div>
        </div>
        <MessageEditor initialValue={automation.firstMessage || ""} companyName={ctx.company.businessName} assistantName={settings.assistantName} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="promotionId">Promotion</Label>
            <select id="promotionId" name="promotionId" defaultValue={automation.promotionId || ""} disabled={!canManage} className={selectClass}>
              <option value="">None</option>
              {promotions.map((promotion) => (
                <option key={promotion.id} value={promotion.id}>{promotion.name} · {promotion.status}</option>
              ))}
            </select>
            <Link href="/marketing/promotions" className="text-xs text-[var(--cy-orange)] hover:underline">Manage Promotions Bank</Link>
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel">Channel</Label>
            <select id="channel" name="channel" defaultValue="SMS" disabled={!canManage} className={selectClass}>
              <option value="SMS">SMS</option>
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="quietHoursEnd">Messages may start at</Label>
            <select id="quietHoursEnd" name="quietHoursEnd" defaultValue={automation.quietHoursEnd ?? 8} disabled={!canManage} className={selectClass}>
              {hours.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quietHoursStart">Quiet hours begin at</Label>
            <select id="quietHoursStart" name="quietHoursStart" defaultValue={automation.quietHoursStart ?? 20} disabled={!canManage} className={selectClass}>
              {hours.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
            </select>
          </div>
        </div>
        <section className="rounded-xl border p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cy-navy)]">Regina can do</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">Only actions supported for this business goal are shown. Use the minimum Regina needs.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{relevantActions.map((action) => <label key={action} className="flex items-start gap-2 rounded-lg bg-[var(--cy-gray)] p-3 text-sm"><input type="checkbox" name="allowedActions" value={action} defaultChecked={automation.allowedActions.includes(action)} disabled={!canManage} className="mt-1" /><span>{ACTION_LABELS[action] || friendly(action)}</span></label>)}</div></section>
        <section className="rounded-xl border p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cy-navy)]">Only if</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">These conditions are rechecked when delayed outreach becomes due.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{CONDITION_OPTIONS.map((condition) => <label key={condition} className="flex items-start gap-2 text-sm"><input type="checkbox" name="conditions" value={condition} defaultChecked={selectedConditions.includes(condition)} disabled={!canManage} className="mt-1" />{friendly(condition)}</label>)}</div></section>
        <ListField title="Regina will not" values={REGINA_NEVER} />
        <section className="rounded-xl border p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cy-navy)]">Stop when</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{STOP_OPTIONS.map((stop) => <label key={stop} className="flex items-start gap-2 text-sm"><input type="checkbox" name="stopConditions" value={stop} defaultChecked={automation.stopConditions.includes(stop)} disabled={!canManage} className="mt-1" />{friendly(stop)}</label>)}</div></section>
        <section className="rounded-xl border p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cy-navy)]">If the customer does not reply</p><div className="mt-3 grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="maxAttempts">Maximum outreach attempts</Label><select id="maxAttempts" name="maxAttempts" defaultValue={automation.maxAttempts} className={selectClass}><option value="1">1 — no follow-up</option><option value="2">2 — one follow-up</option><option value="3">3 — two follow-ups</option></select></div><div className="space-y-2"><Label htmlFor="followUpDelayMinutes">Wait before follow-up</Label><select id="followUpDelayMinutes" name="followUpDelayMinutes" defaultValue={automation.followUpDelayMinutes || 1440} className={selectClass}><option value="1440">24 hours</option><option value="4320">3 days</option><option value="10080">1 week</option></select></div></div><p className="mt-2 text-xs text-[var(--muted-foreground)]">Sending remains deterministic. Regina may suggest wording but cannot add attempts.</p></section>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isCompanyTemplate" value="true" defaultChecked={automation.isCompanyTemplate} /> Save as a reusable company template</label>
        {canManage ? <Button type="submit">Save settings</Button> : null}
      </ActionForm>

      <ConversationPreview firstMessage={preview} goal={automation.goal} />
      <section className="rounded-2xl border bg-white p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">Test conversation</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">Act like the customer. This simulation cannot send messages or mutate production records.</p><div className="mt-4"><TestConversation firstMessage={preview} goal={automation.goal} allowedActions={automation.allowedActions} /></div></section>
      <section className="rounded-2xl border bg-white p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">{readiness.ready ? "Ready to turn on" : "Before this can turn on"}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{readiness.checks.map((check) => <div key={check.label} className={`rounded-lg px-3 py-2 text-sm ${check.ready ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{check.ready ? "✓" : "○"} {check.label}{check.blocker ? <p className="mt-1 text-xs">{check.blocker}</p> : null}</div>)}</div></section>
      <section className="rounded-2xl border bg-[var(--cy-navy)] p-5 text-white"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-300">What will happen</p><p className="mt-2">{automation.delayMinutes ? `${friendlyDelay(automation.delayMinutes)} after` : "When"} {friendly(automation.trigger).toLowerCase()}, Regina will contact {friendly(automation.audience).toLowerCase()} and try to {friendly(automation.goal || "complete the goal").toLowerCase()}.</p><p className="mt-3 text-sm text-slate-200">Up to {automation.maxAttempts} outreach attempt{automation.maxAttempts === 1 ? "" : "s"}. The conversation stops on the configured deterministic conditions.</p></section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 font-medium text-[var(--cy-navy)]">{value}</p>
    </div>
  );
}

function ListField({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="rounded-xl bg-[var(--cy-gray)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cy-navy)]">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-[var(--muted-foreground)]">
        {values.map((value) => <li key={value}>• {value}</li>)}
      </ul>
    </div>
  );
}

function audienceFor(templateKey: string | null) {
  if (templateKey === "MAINTENANCE_DUE") return "Customers with maintenance due";
  if (templateKey === "PAST_CUSTOMER_REACTIVATION") return "Eligible past customers";
  if (templateKey === "UNSOLD_ESTIMATE_FOLLOW_UP") return "Customers with an open estimate";
  if (templateKey === "PROMOTIONAL_CAMPAIGN") return "Customers matching the selected promotion audience";
  return "The customer connected to this event";
}

const GOALS = [
  "BOOK_MAINTENANCE",
  "CONFIRM_APPOINTMENT",
  "RECOVER_MISSED_CALL",
  "QUALIFY_NEW_LEAD",
  "FOLLOW_UP_ESTIMATE",
  "COLLECT_PAYMENT",
  "GET_REVIEW",
  "RENEW_MEMBERSHIP",
  "REACTIVATE_CUSTOMER",
  "PROMOTE_SEASONAL_OFFER",
  "ANSWER_PRE_ARRIVAL_QUESTIONS",
  "FOLLOW_UP_COMPLETED_JOB",
];
const hours = Array.from({ length: 24 }, (_, index) => index);
const selectClass = "h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm";
function hourLabel(hour: number) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function ConversationPreview({ firstMessage, goal }: { firstMessage: string; goal: string | null }) {
  const scheduling = ["BOOK_MAINTENANCE", "CONFIRM_APPOINTMENT", "RECOVER_MISSED_CALL", "REACTIVATE_CUSTOMER"].includes(goal || "");
  return (
    <section className="rounded-2xl border bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">Conversation preview</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">Illustrative sample only. No messages or actions occur.</p>
      <div className="mt-4 space-y-3 text-sm">
        <div><p className="mb-1 text-[10px] font-semibold uppercase">Regina</p><div className="max-w-xl rounded-2xl bg-[var(--cy-navy)] px-4 py-3 text-white">{firstMessage}</div></div>
        <div><p className="mb-1 text-right text-[10px] font-semibold uppercase">Customer</p><div className="ml-auto max-w-xl rounded-2xl border bg-[var(--cy-gray)] px-4 py-3">{scheduling ? "Actually, can we do Thursday afternoon?" : "I have a question. Can someone help?"}</div></div>
        <div><p className="mb-1 text-[10px] font-semibold uppercase">Regina</p><div className="max-w-xl rounded-2xl bg-[var(--cy-navy)] px-4 py-3 text-white">{scheduling ? "Absolutely. Let me check what we have available Thursday before I offer a time." : "Of course. Tell me what you need and I’ll help or get the office involved."}</div></div>
        <div className="max-w-xl rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"><strong>ContractorYou would now:</strong> {scheduling ? "Check real scheduling availability." : "Continue the configured goal or create an office task."}</div>
      </div>
    </section>
  );
}

const STOP_OPTIONS = [
  "GOAL_COMPLETED", "CUSTOMER_DECLINED", "CUSTOMER_OPTED_OUT", "HUMAN_TAKEOVER",
  "SOURCE_CANCELLED", "ESTIMATE_APPROVED", "INVOICE_PAID", "PROMOTION_EXPIRED", "MAXIMUM_ATTEMPTS_REACHED",
];
const CONDITION_OPTIONS = ["CUSTOMER_NOT_OPTED_OUT", "SOURCE_STILL_ACTIVE", "CUSTOMER_HAS_NOT_BOOKED", "PROMOTION_ACTIVE"];

function conditionList(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const onlyIf = (value as Record<string, unknown>).onlyIf;
  return Array.isArray(onlyIf) ? onlyIf.map(String) : [];
}
