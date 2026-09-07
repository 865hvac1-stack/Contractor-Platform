import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { isFieldRole } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { landingPath } from "@/lib/workspaces";
import { formatMoney } from "@/lib/money";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { getHomeSummary } from "@/lib/home";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const HOME_PROMPTS = [
  "What needs me today?",
  "Who owes us money?",
  "Which estimates need follow-up?",
  "Who is ready to schedule?",
  "How are we doing this month?",
];

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  if (isFieldRole(ctx.role)) redirect(landingPath(ctx.role));

  const canSeeMoney = can(ctx.role, "invoices:view");
  const canAsk = can(ctx.role, "intelligence:view");
  const data = await getHomeSummary(ctx.company.id);
  const greeting = greetingForHour(new Date().getHours());

  const todayMetrics = [
    { label: "Jobs today", value: String(data.today.jobsToday), href: "/jobs?when=today" },
    { label: "In progress", value: String(data.today.inProgressToday), href: "/dispatch" },
    { label: "Completed", value: String(data.today.completedToday), href: "/jobs?status=COMPLETED&when=today" },
    { label: "Waiting", value: String(data.today.waitingCount), href: "/operations/waiting" },
    ...(data.today.scheduledRevenueCents != null
      ? [{ label: "Scheduled", value: formatMoney(data.today.scheduledRevenueCents), href: "/jobs?when=today" }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
          {greeting}, {ctx.user.firstName}.
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Here&apos;s what needs your attention today.</p>
      </header>

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Today</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {todayMetrics.map((metric) => (
            <Link
              key={metric.label}
              href={metric.href}
              className="rounded-2xl border border-[var(--border)] bg-white px-3 py-3 hover:border-[var(--cy-orange)]/40"
            >
              <p className="text-xs text-[var(--muted-foreground)]">{metric.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--cy-navy)]">{metric.value}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Needs you</h2>
          <Link href="/attention" className="text-sm font-medium text-[var(--cy-orange)]">
            View all in Action Center →
          </Link>
        </div>
        {data.needsYou.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-5 text-sm text-[var(--muted-foreground)]">
            Nothing needs you right now.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.needsYou.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="block rounded-2xl border border-[var(--border)] bg-white px-4 py-3 hover:border-[var(--cy-orange)]/40"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                    {item.title}
                  </p>
                  <p className="mt-1 font-medium text-[var(--cy-navy)]">{item.customerName || item.description}</p>
                  <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{item.description}</p>
                  <p className="mt-2 text-sm font-medium text-[var(--cy-orange)]">
                    {item.recommendedAction || "Open"} →
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canAsk ? (
        <AskContractorYou variant="bar" suggestions={HOME_PROMPTS} placeholder="Ask anything about your business..." />
      ) : null}

      {canSeeMoney ? (
        <section>
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
              Business snapshot — this month
            </h2>
            <div className="flex gap-3 text-sm font-medium">
              <Link href="/money" className="text-[var(--cy-orange)]">
                View Money →
              </Link>
              {can(ctx.role, "reports:view") ? (
                <Link href="/reports" className="text-[var(--cy-orange)]">
                  View Reports →
                </Link>
              ) : null}
            </div>
          </div>
          {data.snapshot ? (
            <dl className="mt-3 grid grid-cols-2 gap-2">
              <SnapshotStat label="Revenue" value={formatMoney(data.snapshot.revenueCents)} />
              <SnapshotStat label="Collected" value={formatMoney(data.snapshot.collectedCents)} />
              <SnapshotStat label="A/R" value={formatMoney(data.snapshot.arCents)} />
              <SnapshotStat label="Open estimates" value={formatMoney(data.snapshot.openEstimateCents)} />
            </dl>
          ) : (
            <p className="mt-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-5 text-sm text-[var(--muted-foreground)]">
              We&apos;re still building your business picture. ContractorYou will show revenue, collections and open
              work here as verified data comes in.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function SnapshotStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white px-3 py-3">
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--cy-navy)]">{value}</dd>
    </div>
  );
}
