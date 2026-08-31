import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { technicianScorecard, type ScorePeriod } from "@/lib/performance/scorecard";
import { savePerformanceGoalAction } from "@/server/actions/compensation";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function TeamPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requirePermission("performance:view_team");
  const period = ((await searchParams).period as ScorePeriod) || "this_week";
  const showMargin = can(ctx.role, "job_costs:view");
  const [members, goals] = await Promise.all([
    prisma.membership.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE" },
      include: { user: true },
    }),
    prisma.performanceGoal.findMany({
      where: { companyId: ctx.company.id },
    }),
  ]);
  const rows = await Promise.all(
    members.map(async (member) => ({
      member,
      card: await technicianScorecard({
        companyId: ctx.company.id,
        userId: member.userId,
        period,
        includeMargin: showMargin,
      }),
    }))
  );
  const companyGoals = goals.filter((goal) => !goal.userId);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Team</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Performance</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Coaching visibility from verified work. Goals do not change compensation unless a rule says so.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["this_week", "last_week", "this_month"] as ScorePeriod[]).map((value) => (
          <Link
            key={value}
            href={`/team/performance?period=${value}`}
            className={`rounded-full px-3 py-1 text-sm ${
              period === value ? "bg-[var(--cy-navy)] text-white" : "bg-[var(--muted)]"
            }`}
          >
            {value.replaceAll("_", " ")}
          </Link>
        ))}
      </div>

      {can(ctx.role, "compensation:manage") ? (
        <ActionForm
          action={savePerformanceGoalAction}
          successMessage="Goal saved."
          className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-white p-4"
        >
          <select name="metricKey" className="h-8 rounded-lg border border-input px-2.5 text-sm">
            <option value="average_ticket">Average ticket (cents)</option>
            <option value="membership_conversion">Membership conversion (x10)</option>
            <option value="close_rate">Close rate (x10)</option>
            <option value="revenue">Revenue (cents)</option>
            <option value="reviews">Review count</option>
          </select>
          <Input name="target" type="number" placeholder="Target" required className="w-32" />
          <Button type="submit" size="sm">
            Add company goal
          </Button>
        </ActionForm>
      ) : null}

      {companyGoals.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {companyGoals.map((goal) => (
            <li key={goal.id} className="rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
              <p className="font-medium">{goal.metricKey.replaceAll("_", " ")}</p>
              <p className="text-[var(--muted-foreground)]">
                Goal {goal.target} · {goal.period}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="No technician performance data yet." description="Assign technicians to jobs and record live work to populate this table." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                <th className="p-3">Technician</th>
                <th className="p-3">Jobs</th>
                <th className="p-3">Revenue</th>
                <th className="p-3">Avg ticket</th>
                <th className="p-3">Close %</th>
                <th className="p-3">Memberships</th>
                <th className="p-3">Membership %</th>
                <th className="p-3">Callbacks</th>
                <th className="p-3">Reviews</th>
                <th className="p-3">Incentives</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ member, card }) => (
                <tr key={member.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">
                    {member.user.firstName} {member.user.lastName}
                  </td>
                  <td className="p-3 tabular-nums">{card.jobsCompleted}</td>
                  <td className="p-3 tabular-nums">{formatMoney(card.revenueCents)}</td>
                  <td className="p-3 tabular-nums">
                    {card.averageTicketCents == null ? "—" : formatMoney(card.averageTicketCents)}
                  </td>
                  <td className="p-3 tabular-nums">{card.closeRate == null ? "—" : `${card.closeRate}%`}</td>
                  <td className="p-3 tabular-nums">{card.membershipsSold}</td>
                  <td className="p-3 tabular-nums">
                    {card.membershipConversion == null ? "—" : `${card.membershipConversion}%`}
                  </td>
                  <td className="p-3 tabular-nums">{card.callbacks}</td>
                  <td className="p-3 tabular-nums">{card.reviews}</td>
                  <td className="p-3 tabular-nums">
                    {formatMoney(
                      card.incentives.pendingCents +
                        card.incentives.qualifiedCents +
                        card.incentives.approvedCents +
                        card.incentives.paidCents
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
