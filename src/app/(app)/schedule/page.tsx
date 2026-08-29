import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { getScheduleJobs } from "@/lib/dashboard";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

function formatTimeRange(start: Date | null, end: Date | null) {
  if (!start) return "Unscheduled";
  const time = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (!end) return time.format(start);
  const endTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${time.format(start)} – ${endTime.format(end)}`;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requirePermission("schedule:view");
  const { view: viewParam } = await searchParams;
  const view = viewParam === "week" ? "week" : "today";
  const jobs = await getScheduleJobs(ctx.company.id, view);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Schedule</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Jobs on the calendar for your crew.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-1">
        <Link
          href="/schedule?view=today"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition",
            view === "today"
              ? "bg-[var(--foreground)] text-white"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
        >
          Today
        </Link>
        <Link
          href="/schedule?view=week"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition",
            view === "week"
              ? "bg-[var(--foreground)] text-white"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
        >
          This week
        </Link>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title={view === "today" ? "Nothing scheduled today" : "Nothing scheduled this week"}
          description="Scheduled jobs will show up here with time, address, and assignees."
          actionLabel="Create job"
          actionHref="/jobs/new"
        />
      ) : (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          {jobs.map((job) => {
            const customerName =
              job.customer.businessName?.trim() ||
              `${job.customer.firstName} ${job.customer.lastName}`.trim();
            const assignees = job.assignments
              .map((a) => `${a.user.firstName} ${a.user.lastName}`)
              .join(", ");
            return (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex flex-col gap-2 px-4 py-4 transition hover:bg-[var(--muted)] sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{job.jobNumber}</span>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-sm text-[var(--foreground)]">{customerName}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {job.property.address}, {job.property.city}, {job.property.state}{" "}
                      {job.property.zip}
                    </p>
                    {assignees ? (
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Assigned: {assignees}
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--muted-foreground)]">Unassigned</p>
                    )}
                  </div>
                  <p className="shrink-0 text-sm font-medium tabular-nums text-[var(--foreground)]">
                    {formatTimeRange(job.scheduledStart, job.scheduledEnd)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
