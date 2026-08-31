import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { technicianScorecard, type ScorePeriod } from "@/lib/performance/scorecard";
import { customerLabel } from "@/lib/tech/today";

const PERIODS: { id: ScorePeriod; label: string }[] = [
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "this_month", label: "This month" },
];

function Metric({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: "money" | "number" | "percent";
}) {
  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {value == null
          ? "—"
          : format === "money"
            ? formatMoney(value)
            : format === "percent"
              ? `${value}%`
              : String(value)}
      </p>
    </div>
  );
}

export default async function TechPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requirePermission("performance:view_own");
  const period = ((await searchParams).period as ScorePeriod) || "this_week";
  const card = await technicianScorecard({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    period,
  });
  const [events, goals] = await Promise.all([
    prisma.compensationEvent.findMany({
      where: {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        earnedAt: { gte: card.period.start, lte: card.period.end },
      },
      include: {
        rule: true,
        job: { select: { id: true, jobNumber: true } },
        customer: { select: { firstName: true, lastName: true, businessName: true } },
      },
      orderBy: { earnedAt: "desc" },
    }),
    prisma.performanceGoal.findMany({
      where: {
        companyId: ctx.company.id,
        OR: [{ userId: ctx.user.id }, { userId: null }],
        period: period === "this_month" ? "MONTH" : "WEEK",
      },
    }),
  ]);

  function goalFor(key: string, format: "money" | "number" | "percent") {
    return goals
      .filter((goal) => goal.metricKey === key)
      .map((goal) => (
        <p key={goal.id} className="text-xs text-[var(--muted-foreground)]">
          Goal{" "}
          {format === "money" ? formatMoney(goal.target) : format === "percent" ? `${goal.target}%` : goal.target}
        </p>
      ));
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">My performance</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Scorecard</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {card.period.label}. Pending, qualified, and approved incentives are not paid. Only Paid is paid.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PERIODS.map((item) => (
          <Link
            key={item.id}
            href={`/tech/performance?period=${item.id}`}
            className={`flex h-11 items-center justify-center rounded-xl text-sm font-medium ${
              period === item.id ? "bg-[var(--cy-navy)] text-white" : "bg-[var(--muted)]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <section className="rounded-2xl bg-[var(--cy-navy)] p-4 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">My week</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(card.revenueCents)}</p>
            <p className="text-xs text-white/70">Revenue sold</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{card.jobsCompleted}</p>
            <p className="text-xs text-white/70">Jobs completed</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {card.averageTicketCents == null ? "—" : formatMoney(card.averageTicketCents)}
            </p>
            <p className="text-xs text-white/70">Average ticket</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{card.membershipsSold}</p>
            <p className="text-xs text-white/70">Memberships</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
              My incentives
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(card.incentives.approvedCents)} approved
            </p>
            <p className="text-sm text-[var(--muted-foreground)]">
              {formatMoney(card.incentives.pendingCents)} pending · {formatMoney(card.incentives.qualifiedCents)}{" "}
              qualified · {formatMoney(card.incentives.paidCents)} paid
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Approved is not paid. Qualified is not paid. Pending is not paid.
        </p>
      </section>

      <details className="rounded-2xl border border-[var(--border)] bg-white">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3 font-medium">
          Sales performance
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)] px-4 py-4">
          <Metric label="Revenue sold" value={card.revenueCents} format="money" />
          <Metric label="Revenue collected" value={card.collectedCents} format="money" />
          <div>
            <Metric label="Average ticket" value={card.averageTicketCents} format="money" />
            {goalFor("average_ticket", "money")}
          </div>
          <Metric label="Estimates presented" value={card.estimatesPresented} format="number" />
          <Metric label="Estimates approved" value={card.estimatesApproved} format="number" />
          <Metric label="Close rate" value={card.closeRate} format="percent" />
          <Metric label="Memberships sold" value={card.membershipsSold} format="number" />
          <Metric label="Membership conversion" value={card.membershipConversion} format="percent" />
        </div>
      </details>

      <details className="rounded-2xl border border-[var(--border)] bg-white">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3 font-medium">
          Quality
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)] px-4 py-4">
          <Metric label="Jobs completed" value={card.jobsCompleted} format="number" />
          <Metric label="Callbacks" value={card.callbacks} format="number" />
          <Metric label="Reviews" value={card.reviews} format="number" />
        </div>
      </details>

      <details className="rounded-2xl border border-[var(--border)] bg-white" open>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3 font-medium">
          Incentives
        </summary>
        <div className="space-y-3 border-t border-[var(--border)] px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Pending" value={card.incentives.pendingCents} format="money" />
            <Metric label="Qualified" value={card.incentives.qualifiedCents} format="money" />
            <Metric label="Approved" value={card.incentives.approvedCents} format="money" />
            <Metric label="Paid" value={card.incentives.paidCents} format="money" />
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No incentive events in this period.</p>
          ) : (
            events.map((event) => (
              <Link
                key={event.id}
                href={`/tech/performance/${event.id}`}
                className="block rounded-xl border border-[var(--border)] p-3"
              >
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  {event.earnedAt.toLocaleDateString()} · {event.status}
                </p>
                <p className="mt-1 font-medium">{event.rule.name}</p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {event.customer ? customerLabel(event.customer) : "Customer"}
                  {event.job ? ` · ${event.job.jobNumber}` : ""}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(event.amountCents)}</p>
                {event.status !== "PAID" ? (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">Not paid earnings.</p>
                ) : null}
              </Link>
            ))
          )}
        </div>
      </details>
    </div>
  );
}
