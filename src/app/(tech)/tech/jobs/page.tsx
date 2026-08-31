import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { technicianTodayJobs, technicianUpcomingJobs } from "@/lib/tech/today";
import { TechJobCard } from "@/components/tech/job-card";

export default async function TechJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requirePermission("jobs:view");
  const view = (await searchParams).view === "upcoming" ? "upcoming" : "today";
  const jobs =
    view === "upcoming"
      ? await technicianUpcomingJobs(ctx.company.id, ctx.user.id)
      : await technicianTodayJobs(ctx.company.id, ctx.user.id);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl tracking-tight">Jobs</h1>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/tech/jobs"
          className={`flex h-11 items-center justify-center rounded-xl text-sm font-medium ${
            view === "today" ? "bg-[var(--cy-navy)] text-white" : "bg-[var(--muted)]"
          }`}
        >
          Today
        </Link>
        <Link
          href="/tech/jobs?view=upcoming"
          className={`flex h-11 items-center justify-center rounded-xl text-sm font-medium ${
            view === "upcoming" ? "bg-[var(--cy-navy)] text-white" : "bg-[var(--muted)]"
          }`}
        >
          Upcoming
        </Link>
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
          {view === "today" ? "No more jobs today." : "No upcoming assigned jobs."}
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <TechJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
