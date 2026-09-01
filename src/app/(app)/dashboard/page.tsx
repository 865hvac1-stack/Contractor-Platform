import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { getCommandCenterData } from "@/lib/dashboard";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { AskContractorYou } from "@/components/ask-contractoryou";
import {
  AttentionCard,
  KpiCard,
  SnapshotCard,
  TodayJobs,
  attentionCountLabel,
  relativeWhen,
} from "@/components/command-center";
import { HOME_ATTENTION_LIMIT } from "@/lib/attention-priority";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  if (!canAccessWorkspace(ctx.role, "command")) {
    redirect(landingPath(ctx.role));
  }
  const data = await getCommandCenterData(ctx.company.id);
  const greeting = greetingForHour(new Date().getHours());
  const viewAll = attentionCountLabel(data.attention.length);

  const revenueContext =
    data.money.revenueThisMonth === 0
      ? "No completed revenue yet."
      : data.money.revenueChangePercent == null
        ? "Paid invoices this month."
        : `${data.money.revenueChangePercent > 0 ? "↑" : data.money.revenueChangePercent < 0 ? "↓" : "→"} ${Math.abs(data.money.revenueChangePercent)}% vs last month`;

  const estimateContext =
    data.sales.openEstimates === 0
      ? "No open estimates."
      : `${data.sales.awaitingDecision} awaiting decision`;

  const outstandingContext =
    data.money.unpaidInvoices === 0
      ? "Nothing outstanding."
      : data.money.overdueBalance > 0
        ? `${formatMoney(data.money.overdueBalance)} overdue`
        : `${data.money.unpaidInvoices} unpaid`;

  const jobsContext =
    data.today.jobsToday === 0
      ? "Nothing scheduled yet today."
      : `${data.today.completedJobs} completed · ${data.today.inProgressJobs} active · ${data.today.upcomingJobs} upcoming`;

  return (
    <div className="space-y-6 md:space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Command Center
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
            {greeting}, {ctx.user.firstName}.
          </h1>
          <p className="mt-2 text-[var(--muted-foreground)]">Here&apos;s what your business needs today.</p>
        </div>
        {ctx.company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ctx.company.logoUrl}
            alt={`${ctx.company.businessName} logo`}
            className="h-12 w-auto max-w-[180px] rounded-lg border border-[var(--border)] bg-white object-contain p-1"
          />
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Revenue this month"
          value={formatMoney(data.money.revenueThisMonth)}
          context={revenueContext}
          href="/reports"
        />
        <KpiCard
          label="Open estimate value"
          value={formatMoney(data.sales.estimateValue)}
          context={estimateContext}
          href="/estimates"
        />
        <KpiCard
          label="Outstanding invoices"
          value={formatMoney(data.money.outstandingBalance)}
          context={outstandingContext}
          href="/invoices"
        />
        <KpiCard
          label="Jobs today"
          value={String(data.today.jobsToday)}
          context={jobsContext}
          href="/dispatch"
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Needs your attention</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Top {Math.min(HOME_ATTENTION_LIMIT, data.homeAttention.length)} items by value, urgency, and risk.
            </p>
          </div>
          {viewAll ? (
            <Link href="/attention" className="text-sm font-medium text-[var(--cy-orange)]">
              {viewAll}
            </Link>
          ) : null}
        </div>
        {data.homeAttention.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-10 text-center">
            <p className="font-medium text-[var(--cy-navy)]">You&apos;re clear</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              No overdue invoices, stalled estimates, or incomplete jobs right now.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {data.homeAttention.map((item) => (
              <AttentionCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      {can(ctx.role, "intelligence:view") ? (
        <AskContractorYou suggestions={suggestedQuestions(ctx.role, null, "command")} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <SnapshotCard
          title="Today"
          href="/dispatch"
          cta="View Dispatch"
          metrics={[
            { label: "Scheduled", value: String(data.today.jobsToday) },
            { label: "Completed", value: String(data.today.completedJobs) },
            { label: "In progress", value: String(data.today.inProgressJobs) },
            { label: "Unassigned", value: String(data.today.unassignedJobs) },
          ]}
          insight={data.today.runningBehind > 0 ? `${data.today.runningBehind} job${data.today.runningBehind === 1 ? "" : "s"} running behind.` : null}
        />
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Next up</h2>
            <Link href="/dispatch" className="text-sm font-medium text-[var(--cy-orange)]">
              View Dispatch
            </Link>
          </div>
          <TodayJobs jobs={data.scheduledJobsToday} />
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SnapshotCard
          title="Sales"
          href="/estimates"
          cta="View Estimates"
          metrics={[
            { label: "Open value", value: formatMoney(data.sales.estimateValue) },
            { label: "Awaiting decision", value: String(data.sales.awaitingDecision) },
            { label: "Close rate", value: data.sales.closeRate == null ? "Not enough data" : `${data.sales.closeRate}%` },
            { label: "Won this month", value: formatMoney(data.sales.wonEstimateValue) },
          ]}
          items={data.sales.opportunities.map((item) => ({
            href: item.href,
            title: `${formatMoney(item.amountCents)} · ${item.customerName}`,
            detail: `${item.status.replaceAll("_", " ")} · ${relativeWhen(item.updatedAt)}`,
          }))}
        />
        <SnapshotCard
          title="Money"
          href="/reports"
          cta="View Reports"
          metrics={[
            { label: "Collected", value: formatMoney(data.money.revenueThisMonth) },
            { label: "Outstanding", value: formatMoney(data.money.outstandingBalance) },
            { label: "Overdue", value: formatMoney(data.money.overdueBalance) },
            {
              label: "Gross margin",
              value: data.money.grossMarginPercent == null ? "Not enough data" : `${data.money.grossMarginPercent}%`,
            },
          ]}
          items={data.money.issues.map((item) => ({
            href: item.href,
            title: `${formatMoney(item.amountCents)} · ${item.customerName}`,
            detail: item.dueDate ? `Due ${relativeWhen(item.dueDate)}` : "Past due",
          }))}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SnapshotCard
          title="Marketing"
          href="/marketing"
          cta="View Marketing Hub"
          metrics={[
            { label: "Leads this month", value: String(data.marketing.leadsThisMonth) },
            { label: "Booked", value: String(data.marketing.bookedLeads) },
            { label: "Attributed revenue", value: data.marketing.revenueCents > 0 ? formatMoney(data.marketing.revenueCents) : "Not enough data" },
            { label: "Best source", value: data.marketing.bestSource?.label ?? "Not enough data" },
          ]}
          insight={
            data.marketing.bestSource && (data.marketing.bestSource.revenue > 0 || data.marketing.bestSource.booked > 0)
              ? `${data.marketing.bestSource.label} is your highest-producing source this month.`
              : null
          }
        />
        <SnapshotCard
          title="Memberships"
          href="/memberships"
          cta="View Memberships"
          metrics={[
            { label: "Active members", value: String(data.memberships.active) },
            { label: "Renewals due", value: String(data.memberships.renewalsDue) },
            { label: "Membership value", value: data.memberships.revenueCents > 0 ? formatMoney(data.memberships.revenueCents) : "Not enough data" },
            { label: "Sold this month", value: String(data.memberships.soldThisMonth) },
          ]}
        />
        {can(ctx.role, "performance:view_team") ? (
          <SnapshotCard
            title="Team"
            href="/team/performance"
            cta="View Team Scorecards"
            metrics={[
              { label: "Technicians working", value: String(data.team.workingToday) },
              {
                label: "Top average ticket",
                value: data.team.averageTicketCents == null ? "Not enough data" : formatMoney(data.team.averageTicketCents),
              },
              { label: "Memberships sold", value: String(data.sales.membershipsSoldThisMonth) },
              { label: "Close rate", value: data.sales.closeRate == null ? "Not enough data" : `${data.sales.closeRate}%` },
            ]}
            insight={data.team.insights[0] ?? null}
          />
        ) : (
          <SnapshotCard
            title="Operations"
            href="/dispatch"
            cta="View Dispatch"
            metrics={[
              { label: "Completed this month", value: String(data.operations.completedThisMonth) },
              { label: "Callbacks", value: String(data.operations.callbacks) },
              { label: "Unassigned", value: String(data.operations.unassignedJobs) },
              { label: "Need follow-through", value: String(data.operations.jobsNeedingAttention) },
            ]}
          />
        )}
      </div>

      {can(ctx.role, "performance:view_team") ? (
        <SnapshotCard
          title="Operations"
          href="/dispatch"
          cta="View Dispatch"
          metrics={[
            { label: "Completed this month", value: String(data.operations.completedThisMonth) },
            { label: "Callbacks", value: String(data.operations.callbacks) },
            { label: "Unassigned", value: String(data.operations.unassignedJobs) },
            { label: "Need follow-through", value: String(data.operations.jobsNeedingAttention) },
          ]}
        />
      ) : null}
    </div>
  );
}
