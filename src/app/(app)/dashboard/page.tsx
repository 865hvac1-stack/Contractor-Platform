import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  Banknote,
  Briefcase,
  FileText,
  Receipt,
  ArrowUpRight,
} from "lucide-react";
import { requirePermission } from "@/lib/tenant";
import { getCommandCenterData } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { AskContractorYou } from "@/components/ask-contractoryou";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const severityLabel: Record<string, string> = {
  critical: "Critical",
  warning: "Important",
  info: "Normal",
};

const severityTone: Record<string, string> = {
  critical: "bg-rose-50 text-rose-800",
  warning: "bg-[var(--cy-orange-muted)] text-[#9A3412]",
  info: "bg-slate-100 text-slate-700",
};

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  const data = await getCommandCenterData(ctx.company.id);
  const greeting = greetingForHour(new Date().getHours());

  const kpis = [
    {
      label: "Revenue this month",
      value: formatMoney(data.money.revenueThisMonth),
      context:
        data.money.revenueThisMonth === 0
          ? "No completed revenue yet."
          : "Paid invoices this month.",
      href: "/reports",
      icon: Banknote,
    },
    {
      label: "Open estimate value",
      value: formatMoney(data.sales.estimateValue),
      context:
        data.sales.openEstimates === 0
          ? "No open estimates."
          : `${data.sales.openEstimates} open`,
      href: "/estimates",
      icon: FileText,
    },
    {
      label: "Outstanding invoices",
      value: formatMoney(data.money.outstandingBalance),
      context:
        data.money.unpaidInvoices === 0
          ? "Nothing outstanding."
          : `${data.money.unpaidInvoices} unpaid`,
      href: "/invoices",
      icon: Receipt,
    },
    {
      label: "Jobs today",
      value: String(data.today.jobsToday),
      context:
        data.today.jobsToday === 0
          ? "Nothing scheduled yet today."
          : `${data.today.completedJobs} completed`,
      href: "/schedule",
      icon: Briefcase,
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
          Command Center
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
          {greeting}, {ctx.user.firstName}.
        </h1>
        <p className="mt-2 text-[var(--muted-foreground)]">
          Here&apos;s what your business needs today.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Link
              key={kpi.label}
              href={kpi.href}
              className="group rounded-2xl border border-[var(--border)] bg-white p-5 transition hover:border-[var(--cy-navy)]/15 hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--cy-text-secondary)]">
                  {kpi.label}
                </p>
                <Icon className="h-4 w-4 text-[var(--cy-orange)]" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-[var(--cy-navy)]">
                {kpi.value}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{kpi.context}</p>
            </Link>
          );
        })}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">
              Needs your attention
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              What needs a decision or follow-up today.
            </p>
          </div>
        </div>

        {data.attention.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-10 text-center">
            <p className="font-medium text-[var(--cy-navy)]">You&apos;re clear</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              No overdue invoices, stalled estimates, or incomplete jobs right now.
            </p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            {data.attention.map((item) => (
              <li key={item.id} className="border-b border-[var(--border)] last:border-b-0">
                <Link
                  href={item.href}
                  className="flex flex-col gap-2 px-4 py-3.5 transition hover:bg-[var(--cy-gray)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--cy-navy)]">{item.title}</p>
                    <p className="truncate text-sm text-[var(--muted-foreground)]">
                      {item.description}
                    </p>
                    <p className="mt-1 text-xs text-[var(--cy-text-muted)]">
                      {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${severityTone[item.severity] ?? severityTone.info}`}
                    >
                      {severityLabel[item.severity] ?? "Normal"}
                    </span>
                    <ArrowUpRight className="hidden h-4 w-4 text-[var(--cy-text-muted)] sm:block" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Today</h2>
            <Link href="/schedule" className="text-sm font-medium text-[var(--cy-orange)]">
              Schedule
            </Link>
          </div>
          {data.scheduledJobsToday.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--muted-foreground)]">
              Nothing scheduled yet today.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.scheduledJobsToday.map((job) => {
                const tech = job.assignments[0]?.user;
                return (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="flex items-start justify-between gap-3 rounded-xl px-2 py-2 hover:bg-[var(--cy-gray)]"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--cy-navy)]">
                          {job.scheduledStart
                            ? format(job.scheduledStart, "h:mm a")
                            : "Unscheduled"}{" "}
                          · {job.customer.firstName} {job.customer.lastName}
                        </p>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {job.jobType || job.jobNumber}
                          {tech
                            ? ` · ${tech.firstName} ${tech.lastName}`
                            : " · Unassigned"}
                        </p>
                      </div>
                      <StatusBadge status={job.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Sales</h2>
            <Link href="/estimates" className="text-sm font-medium text-[var(--cy-orange)]">
              Estimates
            </Link>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3">
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Open</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {data.sales.openEstimates}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Open value</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {formatMoney(data.sales.estimateValue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Won this month</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {formatMoney(data.sales.wonEstimateValue)}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">
          Business performance
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          From paid invoices and recorded expenses this month. Not a full P&amp;L.
        </p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Revenue</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(data.money.revenueThisMonth)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Expenses</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(data.money.expensesThisMonth)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Contribution</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(data.money.contributionThisMonth)}
            </dd>
            <p className="mt-1 text-[11px] text-[var(--cy-text-muted)]">Revenue minus expenses</p>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Outstanding A/R</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(data.money.outstandingBalance)}
            </dd>
          </div>
        </dl>
      </section>

      <AskContractorYou />
    </div>
  );
}
