import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { getCommandCenterData } from "@/lib/dashboard";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";
import { can } from "@/lib/permissions";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { SnapshotCard, TodayJobs, relativeWhen } from "@/components/command-center";
import { AttentionSummary } from "@/components/attention-feed";
import { HealthHero } from "@/components/health-hero";
import { MetricRing } from "@/components/metric-ring";
import { RevenueChart } from "@/components/revenue-chart";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const COMMAND_PROMPTS = [
  "What needs me today?",
  "How are we doing this month?",
  "Who owes us money?",
  "Which estimates need follow-up?",
  "Who is my top tech today?",
  "Where are we losing money?",
];

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  if (!canAccessWorkspace(ctx.role, "command")) {
    redirect(landingPath(ctx.role));
  }
  const data = await getCommandCenterData(ctx.company.id);
  const greeting = greetingForHour(new Date().getHours());
  const canSeeTeam = can(ctx.role, "performance:view_team");
  const canAsk = can(ctx.role, "intelligence:view");
  const revenueProgress =
    data.goals.revenueCents && data.goals.revenueCents > 0
      ? Math.round((data.money.revenueThisMonth / data.goals.revenueCents) * 100)
      : null;
  const closeProgress =
    data.goals.closeRate && data.goals.closeRate > 0 && data.sales.closeRate != null
      ? Math.round((data.sales.closeRate / data.goals.closeRate) * 100)
      : null;
  const opsProgress =
    data.today.jobsToday > 0
      ? Math.round(((data.today.jobsToday - data.today.runningBehind) / data.today.jobsToday) * 100)
      : null;
  const marginProgress =
    data.goals.marginPercent && data.goals.marginPercent > 0 && data.money.grossMarginPercent != null
      ? Math.round((data.money.grossMarginPercent / data.goals.marginPercent) * 100)
      : null;

  const todayChips = [
    { label: "Jobs", value: String(data.today.jobsToday), href: "/dispatch", show: data.today.jobsToday > 0 },
    { label: "Completed", value: String(data.today.completedJobs), href: "/dispatch", show: data.today.completedJobs > 0 },
    { label: "In progress", value: String(data.today.inProgressJobs), href: "/dispatch", show: data.today.inProgressJobs > 0 },
    { label: "Running late", value: String(data.today.runningBehind), href: "/dispatch", show: data.today.runningBehind > 0 },
    { label: "Memberships sold", value: String(data.today.membershipsSold), href: "/memberships", show: data.today.membershipsSold > 0 },
  ].filter((item) => item.show);

  return (
    <div className="space-y-4 md:space-y-5">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Command Center</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
          {greeting}, {ctx.user.firstName}.
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Here&apos;s what your business needs today.</p>
      </header>

      <HealthHero health={data.health} />

      <div className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
        <MetricRing
          label="Revenue"
          value={formatMoneyCompact(data.money.revenueThisMonth)}
          context={
            revenueProgress != null && data.goals.revenueCents
              ? `${revenueProgress}% of ${formatMoneyCompact(data.goals.revenueCents)}`
              : "This month · no target set"
          }
          href="/reports"
          progress={revenueProgress}
          configureHref={data.goals.revenueCents ? null : "/team/performance"}
        />
        <MetricRing
          label="Profitability"
          value={data.money.grossMarginPercent == null ? "—" : `${data.money.grossMarginPercent}%`}
          context={
            data.money.grossMarginPercent == null
              ? "Not enough confirmed job cost"
              : marginProgress != null && data.goals.marginPercent
                ? `${marginProgress}% of ${data.goals.marginPercent}% target`
                : "Gross margin · no target set"
          }
          href="/reports"
          progress={marginProgress}
          configureHref={data.money.grossMarginPercent != null && !data.goals.marginPercent ? "/team/performance" : null}
        />
        <MetricRing
          label="Sales"
          value={data.sales.closeRate == null ? "—" : `${data.sales.closeRate}%`}
          context={
            data.sales.closeRate == null
              ? "Not enough decided estimates"
              : closeProgress != null && data.goals.closeRate
                ? `${data.sales.closeRate}% vs ${data.goals.closeRate}% target`
                : "Close rate · no target set"
          }
          href="/estimates"
          progress={closeProgress}
          configureHref={data.sales.closeRate != null && !data.goals.closeRate ? "/team/performance" : null}
        />
        <MetricRing
          label="Operations"
          value={data.today.jobsToday === 0 ? "—" : `${data.today.jobsToday - data.today.runningBehind}/${data.today.jobsToday}`}
          context={data.today.jobsToday === 0 ? "Nothing scheduled today" : "Jobs on track today"}
          href="/dispatch"
          progress={opsProgress}
        />
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Today at a glance</h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Updated {data.generatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        {todayChips.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No completed work recorded today yet.</p>
        ) : (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
            {todayChips.map((chip) => (
              <Link
                key={chip.label}
                href={chip.href}
                className="min-w-[6.5rem] shrink-0 rounded-xl bg-[var(--cy-gray)] px-3 py-1.5"
              >
                <p className="text-[11px] text-[var(--muted-foreground)]">{chip.label}</p>
                <p className="truncate text-sm font-semibold text-[var(--cy-navy)]">{chip.value}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <AttentionSummary items={data.attention} />

      {canAsk ? <AskContractorYou variant="bar" suggestions={COMMAND_PROMPTS} /> : null}

      {data.observations.length > 0 ? (
        <ul className="space-y-1.5">
          {data.observations.slice(0, 2).map((item) => (
            <li key={item.text} className="text-sm text-[var(--muted-foreground)]">
              {item.text}{" "}
              <span className="text-[11px]">({item.sources.join(", ")})</span>
              {canAsk ? (
                <Link href={`/intelligence?ask=${encodeURIComponent(item.ask)}`} className="ml-2 text-xs font-medium text-[var(--cy-orange)]">
                  Ask why
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Revenue & profit</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              This month {formatMoney(data.money.revenueThisMonth)}
              {data.money.lastMonthRevenue > 0 ? ` · last month ${formatMoney(data.money.lastMonthRevenue)}` : ""}
              {data.goals.revenueCents ? ` · goal ${formatMoneyCompact(data.goals.revenueCents)}` : ""}
            </p>
          </div>
          <Link href="/reports" className="text-sm font-medium text-[var(--cy-orange)]">
            View Reports
          </Link>
        </div>
        <div className="mt-3">
          <RevenueChart series={data.money.revenueSeries} />
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <SnapshotCard
          title="Sales pipeline"
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
          title="Money / A/R"
          href="/invoices"
          cta="View Money"
          metrics={[
            { label: "Outstanding", value: formatMoney(data.money.outstandingBalance) },
            { label: "Overdue", value: formatMoney(data.money.overdueBalance) },
            { label: "Current", value: formatMoney(data.money.aging.current) },
            { label: "90+", value: formatMoney(data.money.aging.d90plus) },
          ]}
          items={data.money.issues.map((item) => ({
            href: item.href,
            title: `${formatMoney(item.amountCents)} · ${item.customerName}`,
            detail: item.dueDate ? `Due ${relativeWhen(item.dueDate)}` : "Past due",
          }))}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SnapshotCard
          title="Operations"
          href="/dispatch"
          cta="View Dispatch"
          metrics={[
            { label: "Scheduled today", value: String(data.today.jobsToday) },
            { label: "Completed", value: String(data.today.completedJobs) },
            { label: "In progress", value: String(data.today.inProgressJobs) },
            { label: "Running late", value: String(data.today.runningBehind) },
          ]}
        />
        <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Next up</h2>
            <Link href="/dispatch" className="text-sm font-medium text-[var(--cy-orange)]">
              View Dispatch
            </Link>
          </div>
          <TodayJobs jobs={data.scheduledJobsToday} />
        </section>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {canSeeTeam ? (
          <SnapshotCard
            title="Team"
            href="/team/performance"
            cta="View Team Scorecards"
            metrics={
              data.team.topTechToday
                ? [
                    { label: "Top tech today", value: data.team.topTechToday.name },
                    { label: "Jobs today", value: String(data.team.topTechToday.jobsCompleted) },
                    { label: "Revenue", value: formatMoney(data.team.topTechToday.revenueCents) },
                    {
                      label: "Memberships",
                      value: String(data.team.topTechToday.membershipsSold),
                    },
                  ]
                : [{ label: "Top tech today", value: "Not enough completed revenue today" }]
            }
          />
        ) : null}
        <SnapshotCard
          title="Customers"
          href="/customers"
          cta="View Customers"
          metrics={[
            { label: "New today", value: String(data.customers.newToday) },
            { label: "Booked today", value: String(data.customers.bookedToday) },
            { label: "Calls today", value: String(data.customers.callsToday) },
            { label: "Missed today", value: String(data.customers.missedCallsToday) },
          ]}
        />
        <SnapshotCard
          title="Memberships"
          href="/memberships"
          cta="View Memberships"
          metrics={[
            { label: "Active", value: String(data.memberships.active) },
            { label: "Sold today", value: String(data.memberships.soldToday) },
            { label: "Renewals due", value: String(data.memberships.renewalsDue) },
            { label: "Value", value: data.memberships.revenueCents > 0 ? formatMoney(data.memberships.revenueCents) : "Not enough data" },
          ]}
        />
        <SnapshotCard
          title="Reviews"
          href="/marketing/reviews"
          cta="View Reviews"
          metrics={
            data.reviews.connected
              ? [
                  { label: "Today", value: String(data.reviews.today) },
                  { label: "Average", value: data.reviews.average == null ? "—" : String(data.reviews.average) },
                  { label: "This month", value: String(data.reviews.month) },
                  { label: "Requests pending", value: String(data.reviews.pendingRequests) },
                ]
              : []
          }
          insight={data.reviews.connected ? null : "Reviews are not connected or synchronized yet."}
        />
      </div>

      <SnapshotCard
        title="Marketing"
        href="/marketing"
        cta="View Marketing Hub"
        metrics={
          data.marketing.leadsToday > 0 || data.marketing.leadsThisMonth > 0
            ? [
                { label: "Leads today", value: String(data.marketing.leadsToday) },
                { label: "Booked today", value: String(data.marketing.bookedToday) },
                {
                  label: "Attributed revenue",
                  value: data.marketing.revenueCents > 0 ? formatMoney(data.marketing.revenueCents) : "Not enough data",
                },
                { label: "Best source", value: data.marketing.bestSource?.label ?? "Not enough data" },
              ]
            : []
        }
        insight={data.marketing.leadsThisMonth === 0 ? "Not enough attribution data" : null}
      />
    </div>
  );
}
