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
          <ActionForm action={toggleAutomationAction} successMessage={automation.enabled ? "Automation paused." : "Automation turned on."}>
            <input type="hidden" name="automationId" value={automation.id} />
            <input type="hidden" name="enable" value={automation.enabled ? "false" : "true"} />
            <Button type="submit" variant={automation.enabled ? "outline" : "default"}>
              {automation.enabled ? "Turn off" : "Turn on"}
            </Button>
          </ActionForm>
        ) : null}
      </header>

      <ActionForm
        action={updateConversationAutomationAction}
        successMessage="Automation settings saved."
        className="space-y-5 rounded-2xl border bg-white p-5"
      >
        <input type="hidden" name="automationId" value={automation.id} />
        <Field label="When" value={friendly(automation.trigger)} />
        <Field label="Who" value={audienceFor(automation.templateKey)} />
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
        <div className="space-y-2">
          <Label htmlFor="firstMessage">First message</Label>
          <textarea
            id="firstMessage"
            name="firstMessage"
            defaultValue={automation.firstMessage || ""}
            disabled={!canManage}
            rows={4}
            className="w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            Personalization uses verified customer, company, job, property, technician, and promotion context only.
          </p>
        </div>
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
        <div className="grid gap-4 lg:grid-cols-2">
          <ListField title="Regina may" values={automation.allowedActions.map(friendly)} />
          <ListField title="Regina must escalate" values={automation.escalationRules.map(friendly)} />
        </div>
        <ListField title="Stop conversation goal when" values={automation.stopConditions.map(friendly)} />
        {canManage ? <Button type="submit">Save settings</Button> : null}
      </ActionForm>

      <section className="rounded-2xl border bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">First message preview</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Sample customer: Sarah. This preview is never sent.</p>
        <div className="mt-4 max-w-xl rounded-2xl bg-[var(--cy-navy)] px-4 py-3 text-sm text-white">{preview}</div>
        <div className="mt-4">
          <TestConversation firstMessage={preview} goal={automation.goal} />
        </div>
      </section>
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

function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
