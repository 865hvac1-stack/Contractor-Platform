import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { loadLead360, speedStamp, speedToLeadLabel } from "@/lib/leads/lead-360";
import { followUpAsk } from "@/lib/leads/follow-up";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, LEAD_STATUSES } from "@/lib/leads/sources";
import { LEAD_LOST_REASONS } from "@/lib/leads/lost-reasons";
import { formatLeadDateTime, leadDisplayName } from "@/lib/leads/format";
import { addLeadNoteAction, updateLeadStatusAction } from "@/server/actions/leads";
import { ActionForm } from "@/components/action-form";
import { ConvertCustomerPanel } from "@/components/leads/convert-customer-panel";
import { LeadAiPanel } from "@/components/leads/lead-ai-panel";
import { NextActionPanel } from "@/components/leads/next-action-panel";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import { customerLabel } from "@/lib/tech/today";
import { cn } from "@/lib/utils";

function actionHref(
  href: string | null,
  label: string,
  variant: "default" | "outline" = "outline"
) {
  if (!href) return null;
  return (
    <Link href={href} className={cn(buttonVariants({ variant }), "h-9")}>
      {label}
    </Link>
  );
}

export default async function Lead360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("leads:view");
  const { id } = await params;
  const workspace = await loadLead360(ctx.company.id, id);
  if (!workspace) notFound();

  const { lead, facts, insights, summary, followUp, match, timeline, speed, threads, calls } =
    workspace;
  const name = leadDisplayName(lead);
  const canManage = can(ctx.role, "leads:manage");
  const canEstimate = can(ctx.role, "estimates:manage");
  const canSchedule = can(ctx.role, "jobs:manage");
  const canAsk = can(ctx.role, "intelligence:view");
  const canComms = can(ctx.role, "marketing:view");
  const canTeam = can(ctx.role, "team:view");
  const sourceHref = `/marketing/leads?source=${lead.source}`;
  const customerHref = lead.customerId ? `/customers/${lead.customerId}` : null;
  const estimateHref = lead.estimateId ? `/estimates/${lead.estimateId}` : null;
  const scheduleHref = canSchedule
    ? `/jobs/new?leadId=${lead.id}${lead.customerId ? `&customerId=${lead.customerId}` : ""}`
    : null;
  const estimateCreateHref = canEstimate ? `/estimates/new?leadId=${lead.id}${lead.customerId ? `&customerId=${lead.customerId}` : ""}` : null;
  const callHref = lead.phone ? `tel:${lead.phone.replace(/\s/g, "")}` : null;
  const textHref =
    canComms && lead.phone
      ? `/marketing/communications?compose=1&to=${encodeURIComponent(lead.phone)}${lead.customerId ? `&customerId=${lead.customerId}` : ""}`
      : null;
  const emailHref = lead.email ? `mailto:${lead.email}` : null;
  const conversationHref =
    canComms && workspace.primaryThread ? `/marketing/communications/${workspace.primaryThread.id}` : canComms ? "/marketing/communications" : null;
  const draftHref = textHref ?? conversationHref;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/marketing/leads" className="text-sm text-[var(--muted-foreground)] hover:underline">
          ← Leads
        </Link>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">{name}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {[lead.phone, lead.email].filter(Boolean).join(" · ") || "No phone or email on file"}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={lead.status} />
              <Link
                href={sourceHref}
                className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 text-[var(--cy-navy)] hover:bg-[var(--cy-gray)]/80"
              >
                {LEAD_SOURCE_LABELS[lead.source]}
              </Link>
              <span className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 text-[var(--cy-navy)]">
                {formatLeadDateTime(lead.receivedAt).split(",")[0]} · {Math.max(0, Math.round((Date.now() - lead.receivedAt.getTime()) / 86400000))} days old
              </span>
              {facts.assignedName ? (
                canTeam ? (
                  <Link href="/team" className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 hover:underline">
                    Assigned: {facts.assignedName}
                  </Link>
                ) : (
                  <span className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1">Assigned: {facts.assignedName}</span>
                )
              ) : (
                <span className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1">Unassigned</span>
              )}
              {lead.estimatedOpportunityCents != null ? (
                estimateHref ? (
                  <Link href={estimateHref} className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 font-medium hover:underline">
                    Opportunity: {formatMoney(lead.estimatedOpportunityCents)}
                  </Link>
                ) : (
                  <span className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1">
                    Opportunity: {formatMoney(lead.estimatedOpportunityCents)}
                  </span>
                )
              ) : null}
            </div>
            {lead.customer ? (
              <p className="mt-3 text-sm">
                Linked customer:{" "}
                <Link href={customerHref!} className="font-medium text-[var(--cy-navy)] underline-offset-4 hover:underline">
                  {customerLabel(lead.customer)}
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {actionHref(callHref, "Call")}
        {actionHref(textHref, "Text")}
        {actionHref(emailHref, "Email")}
        {actionHref(scheduleHref, "Schedule")}
        {actionHref(estimateHref ?? estimateCreateHref, lead.estimate ? "Open estimate" : "Create estimate")}
        {actionHref(conversationHref, "Open conversation")}
        {canManage && lead.status !== "WON" ? (
          <ActionForm action={updateLeadStatusAction}>
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="status" value="WON" />
            <Button type="submit" className="h-9">
              Mark won
            </Button>
          </ActionForm>
        ) : null}
        {canManage && lead.status !== "LOST" ? (
          <ActionForm action={updateLeadStatusAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="status" value="LOST" />
            <select
              name="lostReason"
              className="h-9 rounded-lg border border-[var(--border)] px-2 text-sm"
              defaultValue={lead.lostReason && LEAD_LOST_REASONS.includes(lead.lostReason as (typeof LEAD_LOST_REASONS)[number]) ? lead.lostReason : ""}
            >
              <option value="">Lost reason</option>
              {LEAD_LOST_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" className="h-9">
              Mark lost
            </Button>
          </ActionForm>
        ) : null}
      </div>

      <section
        className={cn(
          "rounded-2xl border p-5",
          speed.noContactAttempt
            ? "border-rose-200 bg-rose-50"
            : "border-[var(--border)] bg-white"
        )}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
          Speed to lead
        </p>
        {speed.noContactAttempt ? (
          <p className="mt-2 text-xl font-semibold tracking-tight text-rose-800">NO CONTACT ATTEMPT</p>
        ) : (
          <p className="mt-2 text-xl font-semibold text-[var(--cy-navy)]">
            {speedToLeadLabel(speed.speedToLeadMs)}
          </p>
        )}
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[var(--cy-text-muted)]">Created</dt>
            <dd>{speedStamp(speed.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[var(--cy-text-muted)]">First contact</dt>
            <dd>{speedStamp(speed.firstContactAttempt) ?? "None recorded"}</dd>
          </div>
          <div>
            <dt className="text-[var(--cy-text-muted)]">First response</dt>
            <dd>{speedStamp(speed.firstResponse) ?? "None recorded"}</dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <NextActionPanel
            leadId={lead.id}
            nextAction={lead.nextAction}
            nextActionAt={lead.nextActionAt}
            assignedUserId={lead.assignedUserId}
            members={workspace.members}
            canManage={canManage}
          />

          <LeadAiPanel
            leadId={lead.id}
            insights={insights}
            summary={summary}
            followUpAsk={followUp ? followUpAsk(followUp, name) : `Why is ${name} in ${LEAD_STATUS_LABELS[lead.status]}?`}
            canAsk={canAsk}
            draftHref={draftHref}
          />

          <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-[var(--cy-navy)]">Communications</h2>
              {conversationHref ? (
                <Link href={conversationHref} className="text-sm font-medium hover:underline">
                  Open conversation
                </Link>
              ) : null}
            </div>
            {threads.length === 0 && calls.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No recorded messages or calls for this lead.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {calls.slice(0, 3).map((call) => (
                  <li key={call.id} className="rounded-lg bg-[var(--cy-gray)] px-3 py-2">
                    {call.missed ? "Missed call" : "Call"}
                    {call.recordingRef ? " · voicemail/recording on file" : ""}
                    {` · ${formatLeadDateTime(call.startedAt)}`}
                  </li>
                ))}
                {threads.slice(0, 3).map((thread) => (
                  <li key={thread.id}>
                    <Link href={`/marketing/communications/${thread.id}`} className="block rounded-lg bg-[var(--cy-gray)] px-3 py-2 hover:bg-[var(--cy-gray)]/70">
                      <span className="font-medium capitalize">{thread.channel}</span>
                      <span className="mt-0.5 block text-[var(--muted-foreground)]">
                        {thread.lastPreview || thread.messages[0]?.body || "No preview"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="font-semibold text-[var(--cy-navy)]">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">No recorded activity yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {timeline.map((item) => (
                  <li key={item.id} className="border-t border-[var(--border)] pt-3 text-sm">
                    <p className="text-xs text-[var(--cy-text-muted)]">
                      {item.title} · {formatLeadDateTime(item.at)}
                      {item.actor ? ` · ${item.actor}` : ""}
                    </p>
                    {item.body ? <p className="mt-1 text-[var(--cy-navy)]">{item.body}</p> : null}
                    {item.href ? (
                      <Link href={item.href} className="mt-1 inline-block text-xs underline-offset-4 hover:underline">
                        Open
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canManage ? (
              <ActionForm action={addLeadNoteAction} className="mt-4 space-y-3" successMessage="Note saved.">
                <input type="hidden" name="leadId" value={lead.id} />
                <Textarea name="body" rows={3} placeholder="Add a verified note" />
                <Button type="submit">Add note</Button>
              </ActionForm>
            ) : null}
          </section>
        </div>

        <aside className="space-y-4">
          {canManage ? (
            <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <h2 className="font-semibold text-[var(--cy-navy)]">Status</h2>
              <ActionForm action={updateLeadStatusAction} className="mt-3 space-y-3" successMessage="Status updated.">
                <input type="hidden" name="leadId" value={lead.id} />
                <select
                  name="status"
                  defaultValue={lead.status}
                  className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm"
                >
                  {LEAD_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {LEAD_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
                <select name="lostReason" defaultValue={lead.lostReason ?? ""} className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm">
                  <option value="">Lost reason (if lost)</option>
                  {LEAD_LOST_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
                <Button type="submit">Update status</Button>
              </ActionForm>
            </section>
          ) : null}

          {!lead.customerId && canManage ? (
            <ConvertCustomerPanel
              leadId={lead.id}
              firstName={lead.firstName}
              lastName={lead.lastName}
              phone={lead.phone}
              email={lead.email}
              match={match}
            />
          ) : null}

          <section className="rounded-2xl border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="font-semibold text-[var(--cy-navy)]">Estimate</h2>
            {lead.estimate ? (
              <div className="mt-2 space-y-1">
                <p>
                  <Link href={`/estimates/${lead.estimate.id}`} className="font-medium underline-offset-4 hover:underline">
                    {lead.estimate.estimateNumber}
                  </Link>
                </p>
                <p>{formatMoney(lead.estimate.totalCents)}</p>
                <p className="text-[var(--muted-foreground)]">{lead.estimate.status.replaceAll("_", " ")}</p>
                <p className="text-[var(--muted-foreground)]">
                  Issued {formatLeadDateTime(lead.estimate.issueDate)}
                </p>
                {lead.estimate.approvedAt ? (
                  <p>Approved {formatLeadDateTime(lead.estimate.approvedAt)}</p>
                ) : null}
                {lead.estimate.declinedAt ? (
                  <p>Declined {formatLeadDateTime(lead.estimate.declinedAt)}</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-[var(--muted-foreground)]">No estimate yet.</p>
                {estimateCreateHref ? (
                  <Link href={estimateCreateHref} className="mt-2 inline-block font-medium underline-offset-4 hover:underline">
                    Create estimate
                  </Link>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="font-semibold text-[var(--cy-navy)]">Appointment</h2>
            {lead.job ? (
              <div className="mt-2 space-y-1">
                <Link href={`/jobs/${lead.job.id}`} className="font-medium underline-offset-4 hover:underline">
                  {lead.job.jobNumber}
                </Link>
                <p className="text-[var(--muted-foreground)]">{lead.job.status.replaceAll("_", " ")}</p>
                {lead.job.scheduledStart ? (
                  <p>Scheduled {formatLeadDateTime(lead.job.scheduledStart)}</p>
                ) : (
                  <p className="text-[var(--muted-foreground)]">Created, not scheduled.</p>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-[var(--muted-foreground)]">No appointment on this lead.</p>
                {scheduleHref ? (
                  <Link href={scheduleHref} className="mt-2 inline-block font-medium underline-offset-4 hover:underline">
                    Schedule
                  </Link>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="font-semibold text-[var(--cy-navy)]">Source</h2>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-[var(--cy-text-muted)]">Primary source</dt>
                <dd>
                  <Link href={sourceHref} className="underline-offset-4 hover:underline">
                    {LEAD_SOURCE_LABELS[lead.source]}
                  </Link>
                </dd>
              </div>
              {lead.campaignName || lead.campaign ? (
                <div>
                  <dt className="text-[var(--cy-text-muted)]">Campaign</dt>
                  <dd>{lead.campaignName || lead.campaign?.name}</dd>
                </div>
              ) : null}
              {lead.utmSource ? (
                <div>
                  <dt className="text-[var(--cy-text-muted)]">UTM source</dt>
                  <dd>{lead.utmSource}</dd>
                </div>
              ) : null}
              {lead.utmCampaign ? (
                <div>
                  <dt className="text-[var(--cy-text-muted)]">UTM campaign</dt>
                  <dd>{lead.utmCampaign}</dd>
                </div>
              ) : null}
              {lead.firstTouch ? (
                <div>
                  <dt className="text-[var(--cy-text-muted)]">First touch</dt>
                  <dd>{lead.firstTouch}</dd>
                </div>
              ) : null}
              {lead.lastTouch ? (
                <div>
                  <dt className="text-[var(--cy-text-muted)]">Last touch</dt>
                  <dd>{lead.lastTouch}</dd>
                </div>
              ) : null}
              {calls[0]?.trackingNumber ? (
                <div>
                  <dt className="text-[var(--cy-text-muted)]">Tracking number</dt>
                  <dd>{calls[0].trackingNumber}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
