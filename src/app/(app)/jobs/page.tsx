import Link from "next/link";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { JOBS_PAGE_SIZE, jobsListHref, jobsWhere, parseJobsListQuery, type JobsListQuery } from "@/lib/jobs/search";
import { JobsSubnav } from "@/components/hub-subnav";
import { FinanceFilterContext } from "@/components/finance/filter-context";
import { financeFilterCopy, parseFinanceSearch } from "@/lib/finance/query";
import { deriveJobOperationalAlerts, loadJobOperationsSummary } from "@/lib/jobs/operations";
import { formatMoney } from "@/lib/money";
import { DispatchWorkspace } from "@/components/dispatch/workspace";
import { canAccessWorkspace } from "@/lib/workspaces";

function formatSchedule(start: Date | null, end: Date | null) {
  if (!start) return "Unscheduled";
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (!end) return dateFmt.format(start);
  return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
}

const STATUSES = [
  "ALL",
  "NEW",
  "UNSCHEDULED",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "CANCELED",
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    view?: string;
    page?: string;
    customerId?: string;
    when?: string;
    needsInvoice?: string;
    serviceType?: string;
    source?: string;
    range?: string;
    attention?: string;
    filter?: string;
    date?: string;
    issue?: string;
    job?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermission("jobs:view");
  const listIntent = Boolean(
    params.q || params.status || params.page || params.customerId || params.when || params.needsInvoice || params.serviceType || params.attention || params.filter || params.date
  );
  const requestedView = jobsWorkspaceView(params.view, listIntent);
  const routeView = requestedView === "dispatch" && !canAccessWorkspace(ctx.role, "dispatch") ? "all" : requestedView;
  if (routeView === "dispatch") {
    return <DispatchWorkspace search={{ date: params.date, issue: params.issue, job: params.job }} />;
  }

  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const legacyOperationView =
    params.view && ["active", "today", "scheduled", "in-progress", "completed-week", "needs-attention", "estimates-pending"].includes(params.view)
      ? params.view
      : undefined;
  const operationView =
    params.filter ||
    legacyOperationView ||
    (routeView === "waiting"
      ? "waiting"
      : routeView === "estimates"
        ? "estimates-pending"
        : routeView === "attention"
          ? "needs-attention"
          : undefined);
  const query = parseJobsListQuery({
    ...params,
    view: operationView,
    status: routeView === "completed" ? params.status || "COMPLETED" : params.status,
    when: params.when || (params.date === "today" ? "today" : undefined),
  });
  query.routeView = routeView;
  const finance = parseFinanceSearch(params);
  const where = jobsWhere({
    companyId: ctx.company.id,
    access,
    q: query.q,
    status: query.status,
    view: query.view ?? (routeView === "completed" ? "completed" : undefined),
    customerId: query.customerId,
    when: query.when,
    needsInvoice: query.needsInvoice,
    serviceType: query.serviceType,
    attention: query.attention,
  });
  const skip = ((query.page ?? 1) - 1) * JOBS_PAGE_SIZE;
  const [total, jobs, summary] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      include: {
        customer: true,
        property: true,
        assignments: { include: { user: true } },
        playbook: { select: { name: true } },
        serviceType: { select: { name: true } },
        estimates: { select: { status: true, totalCents: true }, orderBy: { createdAt: "desc" }, take: 1 },
        invoices: { select: { status: true, totalCents: true, balanceCents: true }, orderBy: { createdAt: "desc" }, take: 1 },
        waitingRecords: { where: { state: "ACTIVE" }, select: { state: true }, take: 1 },
        jobParts: {
          where: { status: { not: "CANCELED" } },
          select: {
            status: true,
            quantity: true,
            part: { select: { inventoryStocks: { select: { onHand: true, reserved: true, minimumStock: true } } } },
          },
        },
      },
      orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
      skip,
      take: JOBS_PAGE_SIZE,
    }),
    loadJobOperationsSummary(prisma, { companyId: ctx.company.id, access }),
  ]);
  const pages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
  const returnTo = jobsListHref(query);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Operations</p>
          <h1 className="font-display text-3xl tracking-tight">Jobs &amp; Dispatch</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total.toLocaleString()} job{total === 1 ? "" : "s"}
            {query.q ? ` matching “${query.q}”` : ""}
            {query.when === "today" ? " scheduled today" : ""}
            {query.when === "upcoming" ? " upcoming" : ""}
            {query.customerId ? " for this customer" : ""}
            {query.needsInvoice ? " that still need an invoice" : ""}
            {query.serviceType ? ` in ${query.serviceType}` : ""}.
          </p>
        </div>
        <Link href="/jobs/new" className={cn(buttonVariants())}>
          New job
        </Link>
      </div>
      <JobsSubnav canDispatch={canAccessWorkspace(ctx.role, "dispatch")} />
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Job operations summary">
        <OperationsMetric label="Today" value={summary.today} href={metricHref(query, "today")} active={query.view === "today"} />
        <OperationsMetric label="Scheduled" value={summary.scheduled} href={metricHref(query, "scheduled")} active={query.view === "scheduled"} />
        <OperationsMetric label="In Progress" value={summary.inProgress} href={metricHref(query, "in-progress")} active={query.view === "in-progress"} />
        <OperationsMetric label="Waiting" value={summary.waiting} href={metricHref(query, "waiting")} active={query.view === "waiting"} tone={summary.waiting ? "attention" : undefined} />
        <OperationsMetric label="Estimates Pending" value={summary.estimatesPending} href={metricHref(query, "estimates-pending")} active={query.view === "estimates-pending"} />
        <OperationsMetric label="Completed This Week" value={summary.completedThisWeek} href={metricHref(query, "completed-week")} active={query.view === "completed-week"} />
        <OperationsMetric label="Needs Attention" value={summary.needsAttention} href={metricHref(query, "needs-attention")} active={query.view === "needs-attention"} tone={summary.needsAttention ? "attention" : undefined} />
      </section>
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4" aria-labelledby="job-intelligence-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Job Intelligence</p>
            <h2 id="job-intelligence-title" className="font-semibold text-[var(--cy-navy)]">Needs attention</h2>
          </div>
          {query.view || query.attention ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--muted-foreground)]">
                Filtered by: <strong className="text-[var(--cy-navy)]">{activeJobFilterLabel(query)}</strong>
              </span>
              <Link href={jobsListHref({ ...query, routeView: "all", view: undefined, attention: undefined, page: 1 })} className="font-semibold text-[var(--cy-orange)] hover:underline">
                Clear
              </Link>
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["estimate", summary.intelligence.estimatesPending, "Estimates Awaiting Approval"],
            ["late", summary.intelligence.runningLate, "Running Late"],
            ["parts", summary.intelligence.partsRequired, "Jobs Requiring Parts"],
            ["payment", summary.intelligence.paymentsDue, "Payment Due"],
            ["unassigned", summary.intelligence.unassigned, "Unassigned"],
          ].filter(([, value]) => Number(value) > 0).map(([id, value, label]) => (
            <Link
              key={String(id)}
              href={attentionHref(query, String(id))}
              aria-current={query.attention === id ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition hover:-translate-y-0.5 hover:border-[var(--cy-orange)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]",
                query.attention === id ? "border-[var(--cy-navy)] bg-[var(--cy-navy)] text-white" : "border-[var(--border)] bg-[var(--cy-gray)]/50 text-[var(--cy-navy)]"
              )}
            >
              {Number(value).toLocaleString()} {String(label)}
            </Link>
          ))}
          {Object.values(summary.intelligence).every((value) => value === 0) ? (
            <span className="text-sm font-medium text-emerald-700">All clear</span>
          ) : null}
        </div>
      </section>
      {(() => {
        const copy = financeFilterCopy({ ...finance, needsInvoice: Boolean(query.needsInvoice), serviceType: query.serviceType });
        return copy ? <FinanceFilterContext title={copy.title} detail={copy.detail} backHref={finance.backHref} /> : null;
      })()}

      <form className="flex flex-col gap-2 sm:flex-row" method="get">
        <Input
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Search job number, customer, phone, address, tech…"
          className="sm:max-w-md"
        />
        <select
          name="status"
          defaultValue={query.status ?? "ALL"}
          className="h-10 rounded-lg border border-input bg-white px-3 text-sm"
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status === "ALL" ? "All statuses" : status.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select
          name="when"
          defaultValue={query.when ?? ""}
          className="h-10 rounded-lg border border-input bg-white px-3 text-sm"
        >
          <option value="">Any day</option>
          <option value="today">Today</option>
          <option value="upcoming">Upcoming</option>
        </select>
        {query.customerId ? <input type="hidden" name="customerId" value={query.customerId} /> : null}
        <input type="hidden" name="view" value={query.routeView ?? "all"} />
        {query.routeView === "all" && query.view ? <input type="hidden" name="filter" value={query.view} /> : null}
        {query.attention ? <input type="hidden" name="attention" value={query.attention} /> : null}
        {query.needsInvoice ? <input type="hidden" name="needsInvoice" value="1" /> : null}
        {query.serviceType ? <input type="hidden" name="serviceType" value={query.serviceType} /> : null}
        {query.source ? <input type="hidden" name="source" value={query.source} /> : null}
        <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
          Search
        </button>
      </form>

      {jobs.length === 0 ? (
        <EmptyState
          title={query.q || query.status || query.when || query.customerId || query.needsInvoice || query.serviceType ? "No matching jobs" : "No jobs yet"}
          description={
            query.q || query.status || query.when || query.customerId
              ? "Try a different search or status."
              : "Create a job to schedule technicians and track progress."
          }
          actionLabel="Create job"
          actionHref="/jobs/new"
        />
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {jobs.map((job) => {
              const customerName =
                job.customer.businessName?.trim() ||
                `${job.customer.firstName} ${job.customer.lastName}`.trim();
              const alerts = deriveJobOperationalAlerts(job);
              return (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}?from=${encodeURIComponent(returnTo)}`}
                  className="rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-[var(--cy-orange)]/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{job.jobNumber}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="mt-1 text-sm">{customerName}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">{job.property.address}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {job.serviceType?.name || job.playbook?.name || job.jobType || formatSchedule(job.scheduledStart, job.scheduledEnd)}
                  </p>
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    {job.assignments.map((assignment) => `${assignment.user.firstName} ${assignment.user.lastName}`).join(", ") || "Unassigned"}
                    {` · ${jobFinancialLabel(job)}`}
                  </p>
                  {alerts.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {alerts.slice(0, 2).map((alert) => <JobAlert key={alert} label={alert} />)}
                    </div>
                  ) : null}
                  <p className="mt-1 text-xs font-medium text-sky-700">Parts: {jobPartsStatus(job.jobParts)}</p>
                </Link>
              );
            })}
          </div>
          <div className="hidden overflow-hidden rounded-xl border border-[var(--border)] bg-white md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Technician</TableHead>
                  <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                  <TableHead className="hidden xl:table-cell">Value / Payment</TableHead>
                  <TableHead className="hidden xl:table-cell">Parts</TableHead>
                  <TableHead className="hidden xl:table-cell">Alerts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const customerName =
                    job.customer.businessName?.trim() ||
                    `${job.customer.firstName} ${job.customer.lastName}`.trim();
                  const alerts = deriveJobOperationalAlerts(job);
                  return (
                    <TableRow key={job.id} className="group hover:bg-[var(--cy-gray)]">
                      <TableCell>
                        <Link
                          href={`/jobs/${job.id}?from=${encodeURIComponent(returnTo)}`}
                          className="font-medium hover:underline"
                        >
                          {job.jobNumber}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {job.serviceType?.name || job.playbook?.name || job.jobType || job.property.address}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Link href={`/jobs/${job.id}?from=${encodeURIComponent(returnTo)}`} className="hover:underline">
                          {customerName}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">{job.property.address}</p>
                      </TableCell>
                      <TableCell>
                        <Link href={`/jobs/${job.id}?from=${encodeURIComponent(returnTo)}`} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]">
                          <StatusBadge status={job.status} />
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        <Link href={`/jobs/${job.id}?from=${encodeURIComponent(returnTo)}`} className="block">
                          {job.assignments.map((assignment) => `${assignment.user.firstName} ${assignment.user.lastName}`).join(", ") || "Unassigned"}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm text-[var(--muted-foreground)] lg:table-cell">
                        <Link href={`/jobs/${job.id}?from=${encodeURIComponent(returnTo)}#schedule`} className="block">
                          {formatSchedule(job.scheduledStart, job.scheduledEnd)}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm xl:table-cell">
                        <Link href={`/jobs/${job.id}#payment`} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]">
                          {jobFinancialDisplay(job).map((line) => <p key={line} className="first:font-medium last:text-xs last:text-[var(--muted-foreground)]">{line}</p>)}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-xs xl:table-cell">
                        <Link href={`/jobs/${job.id}#parts`} className="block rounded font-medium text-sky-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]">
                          {jobPartsStatus(job.jobParts)}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {alerts.length ? (
                          <Link href={`${alertHref(job.id, alerts[0])}`} title={alerts.join(", ")} className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]">
                            <JobAlert label={`${shortAlert(alerts[0])}${alerts.length > 1 ? ` +${alerts.length - 1}` : ""}`} />
                          </Link>
                        ) : <span className="text-xs text-[var(--muted-foreground)]">Clear</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {pages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <p className="text-[var(--muted-foreground)]">
                Page {query.page} of {pages}
              </p>
              <div className="flex gap-2">
                {query.page && query.page > 1 ? (
                  <Link href={jobsListHref(query, query.page - 1)} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                    Previous
                  </Link>
                ) : null}
                {query.page && query.page < pages ? (
                  <Link href={jobsListHref(query, query.page + 1)} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function OperationsMetric({
  label,
  value,
  tone,
  href,
  active,
}: {
  label: string;
  value: number;
  tone?: "attention";
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]",
        active
          ? "border-[var(--cy-navy)] bg-[var(--cy-navy)]"
          : tone
            ? "border-amber-200 bg-amber-50"
            : "border-[var(--border)] bg-white"
      )}
    >
      <p className={cn("text-xl font-semibold tabular-nums", active ? "text-white" : "text-[var(--cy-navy)]")}>{value.toLocaleString()}</p>
      <p className={cn("text-[11px] font-medium", active ? "text-white/75" : "text-[var(--muted-foreground)]")}>{label}</p>
    </Link>
  );
}

function JobAlert({ label }: { label: string }) {
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900">{label}</span>;
}

type JobPartSummary = {
  status: string;
  quantity: number;
  part: { inventoryStocks: Array<{ onHand: number; reserved: number; minimumStock: number }> };
};

function jobPartsStatus(parts: JobPartSummary[]) {
  if (!parts.length) return "Not Required";
  const missing = parts.filter(
    (row) =>
      row.status === "NEEDED" &&
      row.part.inventoryStocks.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0) < row.quantity
  ).length;
  if (missing) return `${missing} Missing`;
  const needed = parts.filter((part) => part.status === "NEEDED").length;
  if (needed) return `${needed} Required`;
  const reserved = parts.filter((part) => part.status === "RESERVED").length;
  if (reserved) return `${reserved} Reserved`;
  if (parts.some((part) => part.status === "PICKED_UP")) return "Ready";
  return "Installed";
}

function metricHref(query: JobsListQuery, view: string) {
  const routeView =
    view === "waiting"
      ? "waiting"
      : view === "estimates-pending"
        ? "estimates"
        : view === "needs-attention"
          ? "attention"
          : "all";
  return jobsListHref({
    ...query,
    routeView,
    view: query.view === view ? undefined : view,
    attention: undefined,
    page: 1,
  });
}

function attentionHref(query: JobsListQuery, attention: string) {
  return jobsListHref({
    ...query,
    routeView: "attention",
    view: "needs-attention",
    attention: query.attention === attention ? undefined : attention,
    page: 1,
  });
}

type JobsWorkspaceView = "dispatch" | "all" | "waiting" | "estimates" | "completed" | "attention";

function jobsWorkspaceView(value: string | undefined, hasListIntent: boolean): JobsWorkspaceView {
  if (value && ["dispatch", "all", "waiting", "estimates", "completed", "attention"].includes(value)) {
    return value as JobsWorkspaceView;
  }
  if (value) return "all";
  return hasListIntent ? "all" : "dispatch";
}

function activeJobFilterLabel(query: JobsListQuery) {
  const labels: Record<string, string> = {
    today: "Today",
    scheduled: "Scheduled",
    "in-progress": "In Progress",
    waiting: "Waiting",
    "estimates-pending": "Estimates Pending",
    "completed-week": "Completed This Week",
    "needs-attention": "Needs Attention",
    estimate: "Estimates Awaiting Approval",
    late: "Running Late",
    parts: "Parts Required",
    payment: "Payment Due",
    unassigned: "Unassigned",
  };
  return labels[query.attention || query.view || ""] || "Jobs";
}

function jobFinancialDisplay(job: {
  invoices: Array<{ status: string; totalCents: number; balanceCents: number }>;
  estimates: Array<{ status: string; totalCents: number }>;
}) {
  const invoice = job.invoices[0];
  if (invoice) {
    if (invoice.balanceCents <= 0 || invoice.status === "PAID") return [formatMoney(invoice.totalCents), "Paid"];
    return [formatMoney(invoice.totalCents), `Balance ${formatMoney(invoice.balanceCents)}`];
  }
  const estimate = job.estimates[0];
  if (estimate) {
    return [`Estimate ${formatMoney(estimate.totalCents)}`, ["SENT", "VIEWED"].includes(estimate.status) ? "Awaiting Approval" : estimate.status.replaceAll("_", " ")];
  }
  return ["—", "No invoice"];
}

function jobFinancialLabel(job: Parameters<typeof jobFinancialDisplay>[0]) {
  return jobFinancialDisplay(job).join(" · ");
}

function shortAlert(alert: string) {
  const labels: Record<string, string> = {
    "Technician Unassigned": "Unassigned",
    "Customer Waiting": "Customer Waiting",
    "Appointment Conflict": "Conflict",
    "Estimate Awaiting Approval": "Estimate",
    "Payment Due": "Payment Due",
    "Missing Invoice": "Missing Invoice",
    "Part Needed": "Part Needed",
    Late: "Late",
  };
  return labels[alert] || alert;
}

function alertHref(jobId: string, alert: string) {
  if (alert === "Part Needed") return `/jobs/${jobId}#parts`;
  if (alert === "Payment Due" || alert === "Missing Invoice") return `/jobs/${jobId}#payment`;
  if (alert === "Estimate Awaiting Approval") return `/jobs/${jobId}#estimates`;
  if (alert === "Customer Waiting") return `/jobs/${jobId}#waiting`;
  return `/jobs/${jobId}`;
}
