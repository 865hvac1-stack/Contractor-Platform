import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { technicianTodayJobs, customerLabel } from "@/lib/tech/today";
import { technicianScorecard } from "@/lib/performance/scorecard";
import { formatMoney } from "@/lib/money";
import { TechJobCard } from "@/components/tech/job-card";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { can } from "@/lib/permissions";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function TechHomePage() {
  const ctx = await requirePermission("jobs:view");
  const [jobs, week] = await Promise.all([
    technicianTodayJobs(ctx.company.id, ctx.user.id),
    technicianScorecard({ companyId: ctx.company.id, userId: ctx.user.id, period: "this_week" }),
  ]);
  const next = jobs.find((job) => job.status !== "COMPLETED") ?? jobs[0] ?? null;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          {greetingForHour(new Date().getHours())}, {ctx.user.firstName}
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">
          {jobs.length === 0 ? "You're clear for today." : `${jobs.length} job${jobs.length === 1 ? "" : "s"} today`}
        </h1>
      </header>

      {next ? (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Next job</p>
          <TechJobCard job={next} />
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--cy-navy)]">You&apos;re clear for today.</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">No jobs are currently assigned to you.</p>
          <Link
            href="/tech/jobs?view=upcoming"
            className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-[var(--cy-navy)] px-5 text-sm font-medium text-white"
          >
            View upcoming jobs
          </Link>
        </section>
      )}

      {jobs.length > 1 ? (
        <section className="space-y-3">
          <h2 className="font-medium">Today&apos;s jobs</h2>
          {jobs
            .filter((job) => job.id !== next?.id)
            .map((job) => (
              <TechJobCard key={job.id} job={job} />
            ))}
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">This week</p>
            <h2 className="mt-1 font-medium">How I&apos;m doing</h2>
          </div>
          <Link href="/tech/performance" className="text-sm font-medium text-[var(--cy-orange)]">
            View my performance
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Revenue sold</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoney(week.revenueCents)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Memberships</p>
            <p className="text-xl font-semibold tabular-nums">{week.membershipsSold}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Average ticket</p>
            <p className="text-xl font-semibold tabular-nums">
              {week.averageTicketCents == null ? "—" : formatMoney(week.averageTicketCents)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Incentives</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoney(week.incentives.approvedCents)}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Approved · {formatMoney(week.incentives.pendingCents)} pending
            </p>
          </div>
        </div>
      </section>

      {can(ctx.role, "intelligence:view") ? (
        <AskContractorYou
          compact
          suggestions={[
            "What do I have left today?",
            "What is my next job?",
            "How much incentive do I have pending?",
          ]}
        />
      ) : null}
      <p className="sr-only">{customerLabel({ firstName: ctx.user.firstName, lastName: ctx.user.lastName })}</p>
    </div>
  );
}
