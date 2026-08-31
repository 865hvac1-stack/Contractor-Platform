import { format } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { DispatchBoard } from "@/components/dispatch/board";
import { getDispatchBoard } from "@/lib/dispatch/board";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { can } from "@/lib/permissions";
import { routingConfigured } from "@/lib/routing/provider";
import { requirePermission } from "@/lib/tenant";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export default async function DispatchCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requirePermission("schedule:view");
  if (!canAccessWorkspace(ctx.role, "dispatch")) {
    redirect(landingPath(ctx.role));
  }

  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : format(new Date(), "yyyy-MM-dd");
  const day = new Date(`${date}T12:00:00`);
  const board = await getDispatchBoard(ctx.company.id, day);
  const prevDay = new Date(day);
  prevDay.setDate(prevDay.getDate() - 1);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Dispatch Center
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--cy-navy)]">
            Today&apos;s board
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">
            Assign work, lock promised windows, and optimize a technician&apos;s day. Same jobs the
            Owner Command Center and Technician Portal already use.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dispatch?date=${format(prevDay, "yyyy-MM-dd")}`}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Previous
          </Link>
          <span className="text-sm font-medium">{format(day, "EEE, MMM d")}</span>
          <Link
            href={`/dispatch?date=${format(nextDay, "yyyy-MM-dd")}`}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Next
          </Link>
          {can(ctx.role, "jobs:manage") ? (
            <Link
              href="/jobs/new?returnTo=dispatch"
              className="rounded-md bg-[var(--cy-orange)] px-3 py-1.5 text-sm font-medium text-white"
            >
              New job
            </Link>
          ) : null}
        </div>
      </div>
      <DispatchBoard
        date={date}
        technicians={board.technicians}
        unassigned={board.unassigned}
        exceptions={board.exceptions}
        openings={board.openings}
        canAssign={can(ctx.role, "schedule:manage")}
        canLock={can(ctx.role, "jobs:lock")}
        canOptimize={can(ctx.role, "routing:optimize")}
        routingConfigured={routingConfigured()}
      />
      {can(ctx.role, "intelligence:view") ? (
        <AskContractorYou suggestions={suggestedQuestions(ctx.role, null, "dispatch")} />
      ) : null}
    </div>
  );
}
