import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { LEAD_SOURCE_LABELS, LEAD_SOURCES, LEAD_STATUS_LABELS, LEAD_STATUSES } from "@/lib/leads/sources";
import { leadListHref, searchLeads } from "@/lib/leads/search";
import { leadAgeShort, leadDisplayName } from "@/lib/leads/format";
import { ClickableLeadRow } from "@/components/leads/clickable-row";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { customerLabel } from "@/lib/tech/today";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    source?: string;
    assigned?: string;
    age?: string;
    followUp?: string;
    needsResponse?: string;
    page?: string;
  }>;
}) {
  const ctx = await requirePermission("leads:view");
  const filters = await searchParams;
  const query = filters.q?.trim() || "";
  const unanswered = filters.needsResponse === "1";
  const followUp = filters.followUp === "1";
  const canComms = can(ctx.role, "marketing:view");
  const canTeam = can(ctx.role, "team:view");

  const [{ leads, total, page, pageCount }, members] = await Promise.all([
    searchLeads(ctx.company.id, filters),
    prisma.membership.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE" },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
      take: 40,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Leads</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            See a lead, open it, understand it, then act. Click any row.
          </p>
        </div>
        <Link href="/marketing/leads/new" className={cn(buttonVariants(), "h-10 px-4")}>
          New lead
        </Link>
      </div>

      {unanswered || followUp ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
              {unanswered ? "Needs a response" : "Needs follow-up"}
            </p>
            <p className="mt-0.5 text-sm text-[var(--cy-navy)]">
              {unanswered
                ? "Leads that have not received a first response."
                : "Leads with no contact, an overdue next action, or an estimate waiting on follow-up."}
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--cy-navy)]">
              {total} lead{total === 1 ? "" : "s"}
            </p>
          </div>
          <Link href="/office" className="text-sm font-medium text-[var(--cy-navy)] underline-offset-4 hover:underline">
            Back to Customer Hub
          </Link>
        </div>
      ) : null}

      <form method="get" className="grid gap-2 rounded-2xl border border-[var(--border)] bg-white p-3 md:grid-cols-2 xl:grid-cols-[1fr_auto_auto_auto_auto_auto_auto]">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search name, phone, email, or company"
          aria-label="Search leads"
          className="h-10 border-transparent bg-[var(--cy-gray)]"
        />
        <select
          name="status"
          defaultValue={filters.status ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-[var(--cy-gray)] px-2 text-sm"
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LEAD_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          name="source"
          defaultValue={filters.source ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-[var(--cy-gray)] px-2 text-sm"
        >
          <option value="">All sources</option>
          {LEAD_SOURCES.map((source) => (
            <option key={source} value={source}>
              {LEAD_SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
        <select
          name="assigned"
          defaultValue={filters.assigned ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-[var(--cy-gray)] px-2 text-sm"
        >
          <option value="">All assigned</option>
          <option value="unassigned">Unassigned</option>
          {members.map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.user.firstName} {member.user.lastName}
            </option>
          ))}
        </select>
        <select
          name="age"
          defaultValue={filters.age ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-[var(--cy-gray)] px-2 text-sm"
        >
          <option value="">Any age</option>
          <option value="1">Older than 1 day</option>
          <option value="3">Older than 3 days</option>
          <option value="7">Older than 7 days</option>
          <option value="14">Older than 14 days</option>
        </select>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--cy-gray)] px-3 text-sm">
          <input type="checkbox" name="followUp" value="1" defaultChecked={followUp} />
          Needs follow-up
        </label>
        {unanswered ? <input type="hidden" name="needsResponse" value="1" /> : null}
        <Button type="submit" className="h-10 px-5">
          Filter
        </Button>
      </form>

      {leads.length === 0 ? (
        <EmptyState
          title={query || filters.status || filters.source || followUp || unanswered ? "No matching leads" : "No leads yet"}
          description="Record a lead manually, or connect Google / Meta / website when those integrations are configured. We will not import fake leads."
          actionLabel="Record lead"
          actionHref="/marketing/leads/new"
        />
      ) : (
        <ul className="space-y-3 md:hidden">
          {leads.map((lead) => {
            const href = `/marketing/leads/${lead.id}`;
            const callHref = lead.phone ? `tel:${lead.phone.replace(/\s/g, "")}` : null;
            const textHref =
              canComms && lead.phone
                ? `/marketing/communications?compose=1&to=${encodeURIComponent(lead.phone)}${lead.customerId ? `&customerId=${lead.customerId}` : ""}`
                : null;
            return (
              <li key={lead.id}>
                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <Link href={href} className="block">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-[var(--cy-navy)]">{leadDisplayName(lead)}</p>
                      <StatusBadge status={lead.status} />
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {LEAD_SOURCE_LABELS[lead.source]} · {leadAgeShort(lead.receivedAt)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {lead.estimatedOpportunityCents != null
                        ? formatMoney(lead.estimatedOpportunityCents)
                        : "No opportunity value"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--cy-navy)]">
                      {lead.nextAction || "No next action set"}
                    </p>
                  </Link>
                  {(callHref || textHref) && (
                    <div className="mt-3 flex gap-2">
                      {callHref ? (
                        <a href={callHref} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                          Call
                        </a>
                      ) : null}
                      {textHref ? (
                        <Link href={textHref} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                          Text
                        </Link>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {leads.length > 0 ? (
        <div className="hidden overflow-hidden rounded-2xl border border-[var(--border)] bg-white md:block">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--cy-gray)] text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Age</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                  <th className="px-4 py-3 font-medium">Last contact</th>
                  <th className="px-4 py-3 font-medium">Next action</th>
                  <th className="px-4 py-3 font-medium">Opportunity</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const href = `/marketing/leads/${lead.id}`;
                  const opportunityHref = lead.estimate?.id ? `/estimates/${lead.estimate.id}` : href;
                  return (
                    <ClickableLeadRow key={lead.id} href={href}>
                      <td className="px-4 py-3">
                        <Link href={href} className="font-medium text-[var(--cy-navy)] hover:text-[var(--cy-orange)]">
                          {leadDisplayName(lead)}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">{lead.phone || lead.email || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/marketing/leads?source=${lead.source}`} className="text-[var(--cy-navy)] hover:underline">
                          {LEAD_SOURCE_LABELS[lead.source]}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">{leadAgeShort(lead.receivedAt)}</td>
                      <td className="px-4 py-3">
                        {lead.customer ? (
                          <Link href={`/customers/${lead.customer.id}`} className="text-[var(--cy-navy)] hover:text-[var(--cy-orange)]">
                            {customerLabel(lead.customer)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">
                        {lead.assignedUser ? (
                          canTeam ? (
                            <Link href="/team" className="hover:underline">
                              {lead.assignedUser.firstName} {lead.assignedUser.lastName}
                            </Link>
                          ) : (
                            `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">
                        {lead.lastContactAt ? leadAgeShort(lead.lastContactAt) : "Never"}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">{lead.nextAction || "—"}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {lead.estimatedOpportunityCents != null ? (
                          <Link href={opportunityHref} className="hover:underline">
                            {formatMoney(lead.estimatedOpportunityCents)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={lead.status} />
                      </td>
                    </ClickableLeadRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {total > 0 ? (
        <div className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
          <p>
            Page {page} of {pageCount} · {total} lead{total === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={leadListHref(filters, page - 1)} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                Previous
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link href={leadListHref(filters, page + 1)} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
