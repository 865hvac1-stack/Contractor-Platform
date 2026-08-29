import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { getCommandCenterData } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--foreground)]">{value}</p>
    </div>
  );
}

const severityTone: Record<string, string> = {
  critical: "border-rose-200 bg-rose-50 text-rose-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  const data = await getCommandCenterData(ctx.company.id);
  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-[var(--foreground)] md:text-4xl">
          {greeting}, {ctx.user.firstName}
        </h1>
        <p className="mt-2 text-[var(--muted-foreground)]">Your business at a glance.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Today
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Metric label="Jobs today" value={data.today.jobsToday} />
            <Metric label="Completed" value={data.today.completedJobs} />
            <Metric label="Open jobs" value={data.today.openJobs} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Sales
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Metric label="Open estimates" value={data.sales.openEstimates} />
            <Metric label="Open value" value={formatMoney(data.sales.estimateValue)} />
            <Metric label="Won this month" value={formatMoney(data.sales.wonEstimateValue)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Money
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Metric label="Revenue this month" value={formatMoney(data.money.revenueThisMonth)} />
            <Metric label="Unpaid invoices" value={data.money.unpaidInvoices} />
            <Metric label="Outstanding" value={formatMoney(data.money.outstandingBalance)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Follow-up
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Metric
              label="Estimates needing follow-up"
              value={data.followUp.estimatesNeedingFollowUp}
            />
            <Metric label="Overdue invoices" value={data.followUp.overdueInvoices} />
            <Metric
              label="Unscheduled approved"
              value={data.followUp.unscheduledApprovedJobs}
            />
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Operations
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Metric label="Jobs needing attention" value={data.operations.jobsNeedingAttention} />
            <Metric label="Technicians" value={data.operations.technicianCount} />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-xl text-[var(--foreground)]">Needs attention</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Items that may need a decision or follow-up today.
          </p>
        </div>

        {data.attention.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-white/60 px-6 py-10 text-center">
            <p className="font-medium text-[var(--foreground)]">You&apos;re clear</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              No overdue invoices, stalled estimates, or incomplete jobs right now.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-white">
            {data.attention.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex flex-col gap-1 px-4 py-3 transition hover:bg-[var(--muted)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--foreground)]">{item.title}</p>
                    <p className="truncate text-sm text-[var(--muted-foreground)]">
                      {item.description}
                    </p>
                  </div>
                  <span
                    className={`mt-1 inline-flex w-fit shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium capitalize sm:mt-0 ${severityTone[item.severity] ?? severityTone.info}`}
                  >
                    {item.severity}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
