import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can, isFieldRole } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { refreshBillingWatchdog } from "@/lib/billing-watchdog/service";
import { FILTER_TYPES } from "@/lib/billing-watchdog/labels";
import { WatchdogFindingCard } from "@/components/billing-watchdog/finding-card";
import { MoneySubnav } from "@/components/hub-subnav";
import { cn } from "@/lib/utils";

export default async function BillingWatchdogPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; range?: string }>;
}) {
  const ctx = await requirePermission("invoices:view");
  if (isFieldRole(ctx.role)) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h1 className="font-display text-3xl tracking-tight">Billing Watchdog</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Company-wide revenue recovery is for office and owners. Finish checkout on your assigned jobs from the job page.
        </p>
        <Link href="/tech/jobs" className="mt-4 inline-block text-sm text-[var(--cy-orange)]">
          Open my jobs →
        </Link>
      </div>
    );
  }

  const params = await searchParams;
  await refreshBillingWatchdog(prisma, ctx.company.id);
  const filter = params.filter || "all";
  const range = params.range || "all";
  const { loadBillingWatchdog } = await import("@/lib/billing-watchdog/service");
  const { findings, summary } = await loadBillingWatchdog(prisma, ctx.company.id, { filter, range });
  const canExclude = can(ctx.role, "invoices:manage");

  const kpis = [
    { label: "Revenue at risk", value: summary.verifiedAtRiskCents > 0 ? formatMoney(summary.verifiedAtRiskCents) : "Unknown" },
    { label: "Needs attention", value: String(summary.openCount) },
    { label: "Unbilled jobs", value: String(summary.unbilledJobs) },
    { label: "Unsent invoices", value: String(summary.unsentInvoices) },
    { label: "Checkout issues", value: String(summary.checkoutIssues) },
    { label: "Overdue A/R", value: String(summary.overdueInvoices) },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-[var(--cy-navy)]">Billing Watchdog</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Catch work that hasn&apos;t turned into money.</p>
      </header>
      <MoneySubnav />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4">
            <p className="text-xs text-[var(--muted-foreground)]">{kpi.label}</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-[var(--cy-navy)]">{kpi.value}</p>
          </div>
        ))}
      </section>

      <p className="text-sm text-[var(--muted-foreground)]">{summary.morningLine}</p>

      <div className="flex flex-wrap gap-2">
        {FILTER_TYPES.map((item) => (
          <Link
            key={item.key}
            href={`/billing-watchdog?filter=${item.key}&range=${range}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium",
              filter === item.key ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--cy-text-secondary)]"
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {[
          { key: "all", label: "Any time" },
          { key: "today", label: "Today" },
          { key: "yesterday", label: "Yesterday" },
          { key: "7d", label: "7 days" },
          { key: "30d", label: "30 days" },
        ].map((item) => (
          <Link
            key={item.key}
            href={`/billing-watchdog?filter=${filter}&range=${item.key}`}
            className={cn(
              "rounded-full px-3 py-1",
              range === item.key ? "bg-[var(--cy-gray)] font-medium text-[var(--cy-navy)]" : "text-[var(--muted-foreground)]"
            )}
          >
            {item.label}
          </Link>
        ))}
        {can(ctx.role, "company:settings") ? (
          <Link href="/settings/billing-watchdog" className="ml-auto text-[var(--cy-orange)]">
            Settings →
          </Link>
        ) : null}
      </div>

      {findings.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-white px-5 py-8 text-center">
          <p className="font-display text-2xl text-[var(--cy-navy)]">All clear</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">No billing issues in this view.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {findings.map((finding) => (
            <WatchdogFindingCard key={finding.id} finding={finding} canExclude={canExclude} />
          ))}
        </div>
      )}
    </div>
  );
}
