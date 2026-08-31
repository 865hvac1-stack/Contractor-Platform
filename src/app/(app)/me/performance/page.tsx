import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { technicianScorecard, type ScorePeriod } from "@/lib/performance/scorecard";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";

const PERIODS: { id: ScorePeriod; label: string }[] = [
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "this_month", label: "This month" },
];

export default async function MyPerformancePage({
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
    includeMargin: can(ctx.role, "job_costs:view"),
  });
  const events = await prisma.compensationEvent.findMany({
    where: {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      earnedAt: { gte: card.period.start, lte: card.period.end },
    },
    include: { rule: true, job: { select: { jobNumber: true } }, customer: { select: { firstName: true, lastName: true } } },
    orderBy: { earnedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">My Performance</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Scorecard</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Verified activity only. Incentives are not wages until your company marks them paid.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((item) => (
          <Link
            key={item.id}
            href={`/me/performance?period=${item.id}`}
            className={`rounded-full px-3 py-1 text-sm ${
              period === item.id ? "bg-[var(--cy-navy)] text-white" : "bg-[var(--muted)]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { label: "Jobs completed", value: String(card.jobsCompleted) },
          { label: "Revenue generated", value: formatMoney(card.revenueCents) },
          { label: "Revenue collected", value: formatMoney(card.collectedCents) },
          {
            label: "Average ticket",
            value: card.averageTicketCents == null ? "—" : formatMoney(card.averageTicketCents),
          },
          { label: "Estimates presented", value: String(card.estimatesPresented) },
          { label: "Estimates approved", value: String(card.estimatesApproved) },
          { label: "Close rate", value: card.closeRate == null ? "—" : `${card.closeRate}%` },
          { label: "Memberships sold", value: String(card.membershipsSold) },
          {
            label: "Membership conversion",
            value: card.membershipConversion == null ? "—" : `${card.membershipConversion}%`,
          },
          { label: "Reviews attributed", value: String(card.reviews) },
          { label: "Callbacks", value: String(card.callbacks) },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl border border-[var(--border)] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{metric.label}</p>
            <p className="mt-1 text-xl tabular-nums">{metric.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Incentives this week</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { label: "Estimated / Pending", value: card.incentives.pendingCents },
            { label: "Qualified", value: card.incentives.qualifiedCents },
            { label: "Approved", value: card.incentives.approvedCents },
            { label: "Paid", value: card.incentives.paidCents },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(item.value)}</p>
            </div>
          ))}
        </div>
      </section>

      {events.length === 0 ? (
        <EmptyState
          title="No compensation earned this week."
          description="When a qualifying sale matches a company rule, it will show here as pending until it is qualified, approved, or paid."
        />
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-[var(--border)] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {event.rule.name} · +{formatMoney(event.amountCents)}
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">{event.calculationBasis}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {event.customer ? `${event.customer.firstName} ${event.customer.lastName}` : "Customer on file"}
                    {event.job ? ` · ${event.job.jobNumber}` : ""}
                    · {event.earnedAt.toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={event.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
