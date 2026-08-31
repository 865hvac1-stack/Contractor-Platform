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

  const metrics = [
    { key: "jobs_completed", label: "Jobs completed", value: card.jobsCompleted, format: "number" as const },
    { key: "revenue_sold", label: "Revenue sold", value: card.revenueCents, format: "money" as const },
    { key: "revenue_collected", label: "Revenue collected", value: card.collectedCents, format: "money" as const },
    { key: "average_ticket", label: "Average ticket", value: card.averageTicketCents, format: "money" as const },
    { key: "estimates_presented", label: "Estimates presented", value: card.estimatesPresented, format: "number" as const },
    { key: "estimates_approved", label: "Estimates approved", value: card.estimatesApproved, format: "number" as const },
    { key: "close_rate", label: "Close rate", value: card.closeRate, format: "percent" as const },
    { key: "memberships_sold", label: "Memberships sold", value: card.membershipsSold, format: "number" as const },
    { key: "membership_conversion", label: "Membership conversion", value: card.membershipConversion, format: "percent" as const },
    { key: "reviews", label: "Reviews", value: card.reviews, format: "number" as const },
    { key: "callbacks", label: "Callbacks", value: card.callbacks, format: "number" as const },
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">My performance</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Scorecard</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {card.period.label}. Incentives are not wages until your company marks them paid.
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

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <h2 className="text-sm font-semibold">My incentives</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {[
            { label: "Pending", value: card.incentives.pendingCents },
            { label: "Qualified", value: card.incentives.qualifiedCents },
            { label: "Approved", value: card.incentives.approvedCents },
            { label: "Paid", value: card.incentives.paidCents },
          ].map((row) => (
            <div key={row.label}>
              <p className="text-xs text-[var(--muted-foreground)]">{row.label}</p>
              <p className="text-xl font-semibold tabular-nums">{formatMoney(row.value)}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">Pending and qualified are not paid earnings.</p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => (
          <div key={metric.key} className="rounded-2xl border border-[var(--border)] bg-white p-3">
            <p className="text-xs text-[var(--muted-foreground)]">{metric.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {metric.value == null
                ? "—"
                : metric.format === "money"
                  ? formatMoney(metric.value)
                  : metric.format === "percent"
                    ? `${metric.value}%`
                    : String(metric.value)}
            </p>
            {goals
              .filter((goal) => goal.metricKey === metric.key)
              .map((goal) => (
                <p key={goal.id} className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Goal{" "}
                  {metric.format === "money"
                    ? formatMoney(goal.target)
                    : metric.format === "percent"
                      ? `${goal.target}%`
                      : goal.target}
                </p>
              ))}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Incentive detail</h2>
        {events.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            No incentives yet this week.
          </p>
        ) : (
          events.map((event) => (
            <article key={event.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                {event.earnedAt.toLocaleDateString()} · {event.status}
              </p>
              <p className="mt-1 font-medium">{event.rule.name}</p>
              <p className="text-sm text-[var(--muted-foreground)]">
                {event.customer ? customerLabel(event.customer) : "Customer"}
                {event.job ? ` · ${event.job.jobNumber}` : ""}
              </p>
              <p className="mt-2 text-lg font-semibold tabular-nums">{formatMoney(event.amountCents)}</p>
              <p className="mt-2 text-sm">
                <span className="font-medium">Why did I earn this? </span>
                {event.calculationBasis}
              </p>
              {event.status !== "PAID" ? (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">Not paid earnings.</p>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
