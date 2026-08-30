import Link from "next/link";
import { notFound } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, LEAD_STATUSES } from "@/lib/leads/sources";
import {
  addLeadNoteAction,
  convertLeadToCustomerAction,
  updateLeadStatusAction,
} from "@/server/actions/leads";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("leads:view");
  const { id } = await params;
  const lead = await prisma.lead.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      customer: true,
      assignedUser: true,
      estimate: true,
      job: true,
      activities: { orderBy: { createdAt: "desc" }, include: { actor: true } },
      attributionEvents: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!lead) notFound();

  const ageMs = Date.now() - lead.receivedAt.getTime();
  const responseMs = lead.firstRespondedAt
    ? lead.firstRespondedAt.getTime() - lead.receivedAt.getTime()
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/marketing/leads" className="text-sm text-[var(--muted-foreground)]">
          ← Leads
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
              {lead.firstName} {lead.lastName}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {LEAD_SOURCE_LABELS[lead.source]} · received{" "}
              {format(lead.receivedAt, "MMM d, yyyy h:mm a")}
            </p>
          </div>
          <StatusBadge status={lead.status} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs text-[var(--cy-text-muted)]">Age</p>
          <p className="mt-1 font-semibold text-[var(--cy-navy)]">
            {formatDistanceToNow(lead.receivedAt)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs text-[var(--cy-text-muted)]">Time to first response</p>
          <p className="mt-1 font-semibold text-[var(--cy-navy)]">
            {responseMs == null
              ? "Unanswered"
              : `${Math.max(1, Math.round(responseMs / 60000))} min`}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs text-[var(--cy-text-muted)]">Opportunity</p>
          <p className="mt-1 font-semibold text-[var(--cy-navy)]">
            {lead.estimatedOpportunityCents != null
              ? formatMoney(lead.estimatedOpportunityCents)
              : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs text-[var(--cy-text-muted)]">Attributed revenue</p>
          <p className="mt-1 font-semibold text-[var(--cy-navy)]">
            {lead.attributedRevenueCents != null
              ? formatMoney(lead.attributedRevenueCents)
              : "Not recorded"}
          </p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="font-semibold text-[var(--cy-navy)]">Contact</h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-[var(--cy-text-muted)]">Phone</dt>
                <dd>{lead.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">Email</dt>
                <dd>{lead.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">Assigned</dt>
                <dd>
                  {lead.assignedUser
                    ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                    : "Unassigned"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">Customer</dt>
                <dd>
                  {lead.customer ? (
                    <Link
                      href={`/customers/${lead.customer.id}`}
                      className="text-[var(--cy-orange)]"
                    >
                      {lead.customer.firstName} {lead.customer.lastName}
                    </Link>
                  ) : (
                    "Not linked"
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--cy-text-muted)]">Message</dt>
                <dd className="mt-1 whitespace-pre-wrap">{lead.message || "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">Next action</dt>
                <dd>{lead.nextAction || "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">Campaign</dt>
                <dd>{lead.campaignName || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="font-semibold text-[var(--cy-navy)]">Attribution</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--cy-text-muted)]">First touch</dt>
                <dd>{lead.firstTouch || lead.source}</dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">Last touch</dt>
                <dd>{lead.lastTouch || lead.source}</dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">UTM source</dt>
                <dd>{lead.utmSource || "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--cy-text-muted)]">Landing page</dt>
                <dd className="break-all">{lead.landingPage || "—"}</dd>
              </div>
            </dl>
            {lead.attributionEvents.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                No revenue attribution events yet. Those are written when a job or invoice is
                linked with verified amounts.
              </p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm">
                {lead.attributionEvents.map((event) => (
                  <li key={event.id} className="rounded-lg bg-[var(--cy-gray)] px-3 py-2">
                    {event.model.replaceAll("_", " ")} · {event.source}
                    {event.revenueCents != null ? ` · ${formatMoney(event.revenueCents)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="font-semibold text-[var(--cy-navy)]">Activity</h2>
            <ActionForm action={addLeadNoteAction} className="mt-3 space-y-3" successMessage="Note saved.">
              <input type="hidden" name="leadId" value={lead.id} />
              <Textarea name="body" rows={3} placeholder="Log a call, text, or next step" />
              <Button type="submit">Add note</Button>
            </ActionForm>
            <ul className="mt-5 space-y-3">
              {lead.activities.map((activity) => (
                <li key={activity.id} className="border-t border-[var(--border)] pt-3 text-sm">
                  <p className="text-xs text-[var(--cy-text-muted)]">
                    {activity.kind} · {format(activity.createdAt, "MMM d, h:mm a")}
                    {activity.actor
                      ? ` · ${activity.actor.firstName} ${activity.actor.lastName}`
                      : ""}
                  </p>
                  <p className="mt-1 text-[var(--cy-navy)]">{activity.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="font-semibold text-[var(--cy-navy)]">Pipeline</h2>
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
              <Textarea name="lostReason" rows={2} placeholder="Lost reason (if lost)" />
              <Button type="submit">Update status</Button>
            </ActionForm>
          </div>

          {!lead.customerId ? (
            <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <h2 className="font-semibold text-[var(--cy-navy)]">Customer</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Link or create a customer in this company. We will not duplicate if email or
                phone already matches.
              </p>
              <ActionForm action={convertLeadToCustomerAction} className="mt-3" successMessage="Customer linked.">
                <input type="hidden" name="leadId" value={lead.id} />
                <Button type="submit">Link / create customer</Button>
              </ActionForm>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="font-semibold text-[var(--cy-navy)]">Work</h2>
            <p className="mt-2 text-[var(--muted-foreground)]">
              Estimate:{" "}
              {lead.estimate ? (
                <Link href={`/estimates/${lead.estimate.id}`} className="text-[var(--cy-orange)]">
                  {lead.estimate.estimateNumber}
                </Link>
              ) : (
                "—"
              )}
            </p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Job:{" "}
              {lead.job ? (
                <Link href={`/jobs/${lead.job.id}`} className="text-[var(--cy-orange)]">
                  {lead.job.jobNumber}
                </Link>
              ) : (
                "—"
              )}
            </p>
            <p className="mt-3 text-xs text-[var(--cy-text-muted)]">
              Lead age in this view: {Math.round(ageMs / 60000)} minutes.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
