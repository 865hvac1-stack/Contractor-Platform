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
import { JOBS_PAGE_SIZE, jobsListHref, jobsWhere, parseJobsListQuery } from "@/lib/jobs/search";

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
  searchParams: Promise<{ q?: string; status?: string; page?: string; customerId?: string; when?: string }>;
}) {
  const ctx = await requirePermission("jobs:view");
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const params = await searchParams;
  const query = parseJobsListQuery(params);
  const where = jobsWhere({
    companyId: ctx.company.id,
    access,
    q: query.q,
    status: query.status,
    customerId: query.customerId,
    when: query.when,
  });
  const skip = ((query.page ?? 1) - 1) * JOBS_PAGE_SIZE;
  const [total, jobs] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      include: {
        customer: true,
        property: true,
        assignments: { include: { user: true } },
        playbook: { select: { name: true } },
        serviceType: { select: { name: true } },
      },
      orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
      skip,
      take: JOBS_PAGE_SIZE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
  const returnTo = jobsListHref(query);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total.toLocaleString()} job{total === 1 ? "" : "s"}
            {query.q ? ` matching “${query.q}”` : ""}
            {query.when === "today" ? " scheduled today" : ""}
            {query.when === "upcoming" ? " upcoming" : ""}
            {query.customerId ? " for this customer" : ""}.
          </p>
        </div>
        <Link href="/jobs/new" className={cn(buttonVariants())}>
          New job
        </Link>
      </div>

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
        <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
          Search
        </button>
      </form>

      {jobs.length === 0 ? (
        <EmptyState
          title={query.q || query.status || query.when || query.customerId ? "No matching jobs" : "No jobs yet"}
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
                  <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const customerName =
                    job.customer.businessName?.trim() ||
                    `${job.customer.firstName} ${job.customer.lastName}`.trim();
                  return (
                    <TableRow key={job.id} className="hover:bg-[var(--cy-gray)]">
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
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="hidden text-sm text-[var(--muted-foreground)] lg:table-cell">
                        {formatSchedule(job.scheduledStart, job.scheduledEnd)}
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
