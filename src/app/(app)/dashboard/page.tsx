import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { getCommandCenterData } from "@/lib/dashboard";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { can } from "@/lib/permissions";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { SnapshotCard, TodayJobs, relativeWhen } from "@/components/command-center";
import { AttentionFeed } from "@/components/attention-feed";
import { HealthHero } from "@/components/health-hero";
import { MetricRing } from "@/components/metric-ring";
import { RevenueChart } from "@/components/revenue-chart";
import { HOME_ATTENTION_LIMIT, parseAttentionFilter } from "@/lib/attention-priority";

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ attention?: string }>;
}) {
  const ctx = await requirePermission("dashboard:view");
  if (!canAccessWorkspace(ctx.role, "command")) {
    redirect(landingPath(ctx.role));
  }
  const params = await searchParams;
  const data = await getCommandCenterData(ctx.company.id);
  const greeting = greetingForHour(new Date().getHours());
  const initialFilter = parseAttentionFilter(params.attention);
  const canSeeTeam = can(ctx.role, "performance:view_team");
  const canAsk = can(ctx.role, "intelligence:view");
  const revenueProgress =
    data.goals.revenueCents && data.goals.revenueCents > 0
      ? Math.round((data.money.revenueThisMonth / data.goals.revenueCents) * 100)
      : null;
  const closeProgress = data.sales.closeRate;
  const opsProgress =
    data.today.jobsToday > 0
      ? Math.round(((data.today.jobsToday - data.today.runningBehind) / data.today.jobsToday) * 100)
      : null;
  const marginProgress = data.money.grossMarginPercent;

  const todayChips = [
    data.today.jobsToday > 0 ? { label: "Jobs", value: String(data.today.jobsToday), href: "/dispatch" } : null,
    data.today.completedJobs > 0 ? { label: "Completed", value: String(data.today.completedJobs), href: "/dispatch" } : null,
    data.today.inProgressJobs > 0 ? { label: "In progress", value: String(data.today.inProgressJobs), href: "/dispatch" } : null,
    data.today.runningBehind > 0 ? { label: "Running late", value: String(data.today.runningBehind), href: "/dispatch" } : null,
    data.today.soldCents > 0 ? { label: "Sold today", value: formatMoneyCompact(data.today.soldCents), href: "/estimates" } : null,
    data.today.collectedCents > 0 ? { label: "Collected today", value: formatMoneyCompact(data.today.collectedCents), href: "/payments" } : null,
    data.today.membershipsSold > 0 ? { label: "Memberships sold", value: String(data.today.membershipsSold), href: "/memberships" } : null,
    data.today.reviews > 0 ? { label: "Reviews", value: String(data.today.reviews), href: "/marketing/reviews" } : null,
    data.today.topTech ? { label: "Top tech", value: data.today.topTech.name, href: "/team/performance" } : null,
  ].filter((item): item is { label: string; value: string; href: string } => Boolean(item));

  return (
    <div className="space-y-5 md:space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Command Center</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
          {greeting}, {ctx.user.firstName}.
        </h1>
        <p className="mt-2 text-[var(--muted-foreground)]">Here&apos;s what your business needs today.</p>
      </header>

      <HealthHero health={data.health} />

      <div className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
        <MetricRing
          label="Revenue"
          value={formatMoneyCompact(data.money.revenueThisMonth)}
          context={
            revenueProgress != null && data.goals.revenueCents
              ? `${revenueProgress}% of ${formatMoneyCompact(data.goals.revenueCents)} goal`
              : data.money.revenueChangePercent == null
                ? "This month · paid invoices"
                : `${data.money.revenueChangePercent > 0 ? "↑" : data.money.revenueChangePercent < 0 ? "↓" : "→"} ${Math.abs(data.money.revenueChangePercent)}% vs last month`
          }
          href="/reports"
          progress={revenueProgress ?? (data.money.revenueChangePercent != null ? Math.min(100, 50 + data.money.revenueChangePercent) : null)}
        />
        <MetricRing
          label="Profitability"
          value={marginProgress == null ? "—" : `${marginProgress}%`}
          context={marginProgress == null ? "Not enough confirmed job cost" : "Gross margin this month"}
          href="/reports"
          progress={marginProgress}
        />
        <MetricRing
          label="Sales"
          value={closeProgress == null ? "—" : `${closeProgress}%`}
          context={
            closeProgress == null ? "Not enough decided estimates" : `Close rate · ${formatMoneyCompact(data.sales.estimateValue)} open`
          }
          href="/estimates"
          progress={closeProgress}
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
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {todayChips.map((chip) => (
              <Link
                key={chip.label}
                href={chip.href}
                className="min-w-[7.5rem] shrink-0 rounded-xl bg-[var(--cy-gray)] px-3 py-2"
              >
                <p className="text-[11px] text-[var(--muted-foreground)]">{chip.label}</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-[var(--cy-navy)]">{chip.value}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <AttentionFeed items={data.attention} initialFilter={initialFilter} initialLimit={HOME_ATTENTION_LIMIT} />

      {canAsk ? (
        <AskContractorYou
          variant="bar"
          suggestions={[...COMMAND_PROMPTS, ...suggestedQuestions(ctx.role, null, "command")].filter(
            (item, index, all) => all.indexOf(item) === index
          )}
        />
      ) : null}

      {data.observations.length > 0 ? (
        <section className="grid gap-2 md:grid-cols-3">
          {data.observations.map((item) => (
            <div key={item.text} className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
              <p className="text-sm text-[var(--cy-navy)]">{item.text}</p>
              <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">From {item.sources.join(", ")}</p>
              {canAsk ? (
                <Link href={`/intelligence?ask=${encodeURIComponent(item.ask)}`} className="mt-2 inline-block text-xs font-medium text-[var(--cy-orange)]">
                  Ask why
                </Link>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Revenue & profit</h2>
            <p className="text-sm text-[var(--muted-foreground)]">This month · paid invoices and confirmed job cost</p>
          </div>
          <Link href="/reports" className="text-sm font-medium text-[var(--cy-orange)]">
            View Reports
          </Link>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Revenue this month</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-[var(--cy-navy)]">{formatMoney(data.money.revenueThisMonth)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Collected (payments)</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-[var(--cy-navy)]">{formatMoney(data.today.collectedCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Gross margin</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-[var(--cy-navy)]">
              {data.money.grossMarginPercent == null ? "Not enough data" : `${data.money.grossMarginPercent}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Goal</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-[var(--cy-navy)]">
              {data.goals.revenueCents
                ? `${revenueProgress ?? 0}% of ${formatMoneyCompact(data.goals.revenueCents)}`
                : "Set a revenue target in Team Scorecards"}
            </dd>
          </div>
        </dl>
        <div className="mt-4">
          <RevenueChart series={data.money.revenueSeries} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
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
          insight={`Sent ${data.sales.pipeline.sent.count} · Viewed ${data.sales.pipeline.viewed.count} · Approved ${data.sales.pipeline.approved.count}`}
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
          insight={`Aging: 1–30 ${formatMoney(data.money.aging.d1to30)} · 31–60 ${formatMoney(data.money.aging.d31to60)} · 61–90 ${formatMoney(data.money.aging.d61to90)}`}
          items={data.money.issues.map((item) => ({
            href: item.href,
            title: `${formatMoney(item.amountCents)} · ${item.customerName}`,
            detail: item.dueDate ? `Due ${relativeWhen(item.dueDate)}` : "Past due",
          }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {canSeeTeam ? (
          <SnapshotCard
            title="Team"
            href="/team/performance"
            cta="View Team Scorecards"
            metrics={
              data.team.leaderboard[0]
                ? [
                    { label: "Top tech today", value: data.team.leaderboard[0].name },
                    { label: "Revenue", value: formatMoney(data.team.leaderboard[0].revenueCents) },
                    {
                      label: "Avg ticket",
                      value:
                        data.team.leaderboard[0].averageTicketCents == null
                          ? "—"
                          : formatMoney(data.team.leaderboard[0].averageTicketCents),
                    },
                    { label: "Jobs", value: String(data.team.leaderboard[0].jobsCompleted) },
                  ]
                : [
                    { label: "Technicians", value: String(data.team.workingToday) },
                    {
                      label: "Top average ticket",
                      value: data.team.averageTicketCents == null ? "Not enough data" : formatMoney(data.team.averageTicketCents),
                    },
                  ]
            }
            insight={data.team.insights[0] ?? null}
          />
        ) : null}
        <SnapshotCard
          title="Customers"
          href="/customers"
          cta="View Customers"
          metrics={[
            { label: "New today", value: String(data.customers.newToday) },
            { label: "Repeat (12 mo)", value: String(data.customers.repeatLastYear) },
            { label: "Missed calls", value: String(data.customers.missedCallsOpen) },
          ]}
          insight={
            data.customers.repeatLastYear > 0
              ? `${data.customers.repeatLastYear} customers had 2+ completed jobs in the last 12 months.`
              : null
          }
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
            data.reviews.month > 0 || data.reviews.today > 0
              ? [
                  { label: "Today", value: String(data.reviews.today) },
                  { label: "This month", value: String(data.reviews.month) },
                  { label: "Average", value: data.reviews.average == null ? "—" : String(data.reviews.average) },
                  { label: "Requests pending", value: String(data.reviews.pendingRequests) },
                ]
              : []
          }
          insight={data.reviews.month === 0 ? "Connect Reviews to track reputation." : null}
        />
      </div>

      <SnapshotCard
        title="Marketing"
        href="/marketing"
        cta="View Marketing Hub"
        metrics={
          data.marketing.leadsThisMonth > 0
            ? [
                { label: "Leads this month", value: String(data.marketing.leadsThisMonth) },
                { label: "Booked", value: String(data.marketing.bookedLeads) },
                {
                  label: "Booking rate",
                  value: `${Math.round((data.marketing.bookedLeads / data.marketing.leadsThisMonth) * 100)}%`,
                },
                {
                  label: "Attributed revenue",
                  value: data.marketing.revenueCents > 0 ? formatMoney(data.marketing.revenueCents) : "Not enough data",
                },
              ]
            : []
        }
        insight={
          data.marketing.leadsThisMonth === 0
            ? "Not enough attribution data yet."
            : data.marketing.bestSource
              ? `${data.marketing.bestSource.label}: ${data.marketing.bestSource.leads} leads · ${data.marketing.bestSource.booked} booked${
                  data.marketing.bestSource.revenue > 0 ? ` · ${formatMoney(data.marketing.bestSource.revenue)}` : ""
                }.`
              : null
        }
      />
    </div>
  );
}
