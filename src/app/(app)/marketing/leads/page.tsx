import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, LEAD_SOURCES, LEAD_STATUSES } from "@/lib/leads/sources";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LeadSource, LeadStatus } from "@prisma/client";
import { formatMoney } from "@/lib/money";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; source?: string }>;
}) {
  const ctx = await requirePermission("leads:view");
  const { q, status, source } = await searchParams;
  const query = q?.trim() || "";
  const statusFilter = LEAD_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined;
  const sourceFilter = LEAD_SOURCES.includes(source as LeadSource) ? (source as LeadSource) : undefined;

  const leads = await prisma.lead.findMany({
    where: {
      companyId: ctx.company.id,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(sourceFilter ? { source: sourceFilter } : {}),
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { phone: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      customer: true,
      assignedUser: true,
    },
    orderBy: { receivedAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Leads</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            One pipeline from every source. Speed-to-lead is visible on every record.
          </p>
        </div>
        <Link href="/marketing/leads/new" className={cn(buttonVariants(), "h-10 px-4")}>
          New lead
        </Link>
      </div>

      <form
        method="get"
        className="grid gap-2 rounded-2xl border border-[var(--border)] bg-white p-3 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search name, email, or phone"
          aria-label="Search leads"
          className="h-10 border-transparent bg-[var(--cy-gray)]"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-[var(--cy-gray)] px-2 text-sm"
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          name="source"
          defaultValue={sourceFilter ?? ""}
          className="h-10 rounded-lg border border-[var(--border)] bg-[var(--cy-gray)] px-2 text-sm"
        >
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {LEAD_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <Button type="submit" className="h-10 px-5">
          Filter
        </Button>
      </form>

      {leads.length === 0 ? (
        <EmptyState
          title={query || statusFilter || sourceFilter ? "No matching leads" : "No leads yet"}
          description="Record a lead manually, or connect Google / Meta / website when those integrations are configured. We will not import fake leads."
          actionLabel="Record lead"
          actionHref="/marketing/leads/new"
        />
      ) : (
        <ul className="space-y-3 md:hidden">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/marketing/leads/${lead.id}`}
                className="block rounded-2xl border border-[var(--border)] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-[var(--cy-navy)]">
                    {lead.firstName} {lead.lastName}
                  </p>
                  <StatusBadge status={lead.status} />
                </div>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {LEAD_SOURCE_LABELS[lead.source]} ·{" "}
                  {formatDistanceToNow(lead.receivedAt, { addSuffix: true })}
                </p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {lead.phone || lead.email || "No contact"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {leads.length > 0 ? (
        <div className="hidden overflow-hidden rounded-2xl border border-[var(--border)] bg-white md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--cy-gray)]/70 text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
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
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/marketing/leads/${lead.id}`}
                      className="font-medium text-[var(--cy-navy)] hover:text-[var(--cy-orange)]"
                    >
                      {lead.firstName} {lead.lastName}
                    </Link>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {lead.phone || lead.email || "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {LEAD_SOURCE_LABELS[lead.source]}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {formatDistanceToNow(lead.receivedAt, { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    {lead.customer ? (
                      <Link
                        href={`/customers/${lead.customer.id}`}
                        className="text-[var(--cy-navy)] hover:text-[var(--cy-orange)]"
                      >
                        {lead.customer.firstName} {lead.customer.lastName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {lead.assignedUser
                      ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {lead.lastContactAt
                      ? formatDistanceToNow(lead.lastContactAt, { addSuffix: true })
                      : "Never"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {lead.nextAction || "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {lead.estimatedOpportunityCents != null
                      ? formatMoney(lead.estimatedOpportunityCents)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
