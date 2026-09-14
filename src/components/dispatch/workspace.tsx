import { format } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { DispatchBoard } from "@/components/dispatch/board";
import { JobsSubnav } from "@/components/hub-subnav";
import { buttonVariants } from "@/components/ui/button";
import { getDispatchBoard } from "@/lib/dispatch/board";
import type { DispatchPulse } from "@/lib/dispatch/filters";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { can } from "@/lib/permissions";
import { routingConfigured } from "@/lib/routing/provider";
import { requirePermission } from "@/lib/tenant";
import { cn } from "@/lib/utils";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";

export async function DispatchWorkspace({
  search,
}: {
  search: { date?: string; issue?: string; job?: string };
}) {
  const ctx = await requirePermission("schedule:view");
  if (!canAccessWorkspace(ctx.role, "dispatch")) redirect(landingPath(ctx.role));

  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.date ?? "") ? search.date! : format(new Date(), "yyyy-MM-dd");
  const day = new Date(`${date}T12:00:00`);
  const today = format(new Date(), "yyyy-MM-dd");
  const isToday = date === today;
  const board = await getDispatchBoard(ctx.company.id, day);
  const prevDay = new Date(day);
  prevDay.setDate(prevDay.getDate() - 1);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);
  const pulseByIssue: Record<string, DispatchPulse> = {
    late: "runningLate",
    runningLate: "runningLate",
    unassigned: "unassigned",
    emergency: "emergency",
    completed: "completed",
    inProgress: "inProgress",
  };
  const initialPulse = pulseByIssue[search.issue ?? ""] ?? "all";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Operations</p>
          <h1 className="font-display text-3xl tracking-tight text-[var(--cy-navy)]">Jobs &amp; Dispatch</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Dispatch Board · today&apos;s work by technician and time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1 md:gap-2">
          <Link
            href={`/jobs?view=dispatch&date=${format(prevDay, "yyyy-MM-dd")}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "size-11 justify-center px-0 md:h-8 md:w-auto md:px-3")}
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
            <span className="hidden md:inline">Previous</span>
          </Link>
          <span className="min-w-[6.5rem] text-center text-sm font-semibold text-[var(--cy-navy)]">{format(day, "EEE, MMM d")}</span>
          <Link
            href={`/jobs?view=dispatch&date=${format(nextDay, "yyyy-MM-dd")}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "size-11 justify-center px-0 md:h-8 md:w-auto md:px-3")}
            aria-label="Next day"
          >
            <span className="hidden md:inline">Next</span>
            <ChevronRight className="size-4" />
          </Link>
          {!isToday ? <Link href="/jobs?view=dispatch" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>Today</Link> : null}
          <Link href="/settings/scheduling" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 px-3 md:h-8")}>
            Availability
          </Link>
          {can(ctx.role, "jobs:manage") ? (
            <Link href="/jobs/new?returnTo=dispatch" className={cn(buttonVariants({ size: "sm" }), "h-11 px-3 md:h-8")}>
              <Plus className="size-4" />
              New Job
            </Link>
          ) : null}
        </div>
      </div>

      <JobsSubnav />

      <DispatchBoard
        date={date}
        isToday={isToday}
        board={{
          technicians: board.technicians,
          unassigned: board.unassigned,
          issues: board.issues,
          metrics: board.metrics,
          jobTypes: board.jobTypes,
        }}
        canAssign={can(ctx.role, "schedule:manage")}
        canLock={can(ctx.role, "jobs:lock")}
        canOptimize={can(ctx.role, "routing:optimize")}
        canChangeStatus={can(ctx.role, "jobs:manage")}
        routingConfigured={routingConfigured()}
        canAsk={can(ctx.role, "intelligence:view")}
        suggestions={suggestedQuestions(ctx.role, null, "dispatch")}
        initialPulse={initialPulse}
        initialJobId={search.job}
      />
    </div>
  );
}
