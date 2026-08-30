import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { getMarketingHubMetrics, getPerformanceBySource } from "@/lib/marketing/metrics";
import { MARKETING_RANGES, parseMarketingRange } from "@/lib/marketing/period";
import { LEAD_SOURCE_LABELS } from "@/lib/leads/sources";
import { formatMoney } from "@/lib/money";
import { listActiveInsights } from "@/lib/intelligence/insights";
import { getChannelCards } from "@/lib/integrations/connections";
import { KpiCard } from "@/components/kpi-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeadSource } from "@prisma/client";

export default async function MarketingHubPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const ctx = await requirePermission("marketing:view");
  const { range: rangeRaw } = await searchParams;
  const range = parseMarketingRange(rangeRaw);
  const [metrics, bySource, insights, channels] = await Promise.all([
    getMarketingHubMetrics(ctx.company.id, range),
    getPerformanceBySource(ctx.company.id, range),
    listActiveInsights(ctx.company.id),
    getChannelCards(ctx.company.id),
  ]);

  const kpis = [
    {
      label: "New leads",
      value: String(metrics.newLeads),
      context: metrics.period.label,
      href: "/marketing/leads",
    },
    {
      label: "Booked leads",
      value: String(metrics.bookedLeads),
      context: "Booked through won",
      href: "/marketing/leads",
    },
    metrics.bookingRate != null
      ? {
          label: "Booking rate",
          value: `${metrics.bookingRate}%`,
          context: "Booked ÷ new leads",
        }
      : null,
    {
      label: "Open opportunities",
      value: String(metrics.openOpportunities),
      context: "Still in the pipeline",
      href: "/marketing/leads",
    },
    {
      label: "Marketing spend",
      value: formatMoney(metrics.marketingSpendCents),
      context: "Advertising expenses + recorded spend",
      href: "/expenses",
    },
    metrics.costPerLeadCents != null
      ? {
          label: "Cost per lead",
          value: formatMoney(metrics.costPerLeadCents),
          context: "Spend ÷ new leads",
        }
      : null,
    metrics.costPerBookedCents != null
      ? {
          label: "Cost per booked job",
          value: formatMoney(metrics.costPerBookedCents),
          context: "Spend ÷ booked leads",
        }
      : null,
    metrics.attributedRevenueCents != null
      ? {
          label: "Attributed revenue",
          value: formatMoney(metrics.attributedRevenueCents),
          context: "From recorded attribution events",
        }
      : null,
    metrics.attributedGrossProfitCents != null
      ? {
          label: "Attributed gross profit",
          value: formatMoney(metrics.attributedGrossProfitCents),
          context: "Only where job cost is recorded",
        }
      : null,
    metrics.roas != null
      ? {
          label: "ROAS",
          value: `${metrics.roas.toFixed(2)}x`,
          context: "Attributed revenue ÷ spend",
        }
      : null,
    metrics.missedCalls != null
      ? {
          label: "Missed calls",
          value: String(metrics.missedCalls),
          context: "From connected call records",
        }
      : null,
    {
      label: "Unanswered leads",
      value: String(metrics.unansweredLeads),
      context: "No first response yet",
      href: "/marketing/leads?status=NEW",
    },
    metrics.reviewsGenerated != null
      ? {
          label: "Reviews generated",
          value: String(metrics.reviewsGenerated),
          context: "Imported in this period",
          href: "/marketing/reviews",
        }
      : null,
  ].filter(Boolean) as { label: string; value: string; context?: string; href?: string }[];

  const connectNext = channels.filter((c) => c.status === "NOT_CONNECTED").slice(0, 4);

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Marketing Hub
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
            Know what&apos;s driving your business.
          </h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            Where leads come from, what is booking, what you are spending, and what is actually
            making money — only from recorded ContractorYou data.
          </p>
        </div>
        <form method="get" className="flex flex-wrap gap-2">
          {MARKETING_RANGES.map((option) => (
            <button
              key={option.value}
              name="range"
              value={option.value}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium",
                range === option.value
                  ? "bg-[var(--cy-navy)] text-white"
                  : "bg-white text-[var(--cy-text-secondary)] ring-1 ring-[var(--border)]"
              )}
            >
              {option.label}
            </button>
          ))}
        </form>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">
              Performance by source
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              SOURCE · LEADS · BOOKED · SOLD · SPEND · REVENUE · GROSS PROFIT
            </p>
          </div>
          <Link href="/marketing/leads/new" className={cn(buttonVariants(), "hidden sm:inline-flex")}>
            Record lead
          </Link>
        </div>

        {bySource.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--muted-foreground)]">
            No leads in this period. Record a lead or connect a channel — we will not invent
            source performance.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Leads</th>
                  <th className="py-2 pr-3 font-medium">Booked</th>
                  <th className="py-2 pr-3 font-medium">Sold</th>
                  <th className="py-2 pr-3 font-medium">Spend</th>
                  <th className="py-2 pr-3 font-medium">CPL</th>
                  <th className="py-2 pr-3 font-medium">Revenue</th>
                  <th className="py-2 font-medium">Gross profit</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((row) => (
                  <tr key={row.source} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-3 pr-3 font-medium text-[var(--cy-navy)]">
                      {LEAD_SOURCE_LABELS[row.source as LeadSource] ?? row.source}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{row.leads}</td>
                    <td className="py-3 pr-3 tabular-nums">{row.booked}</td>
                    <td className="py-3 pr-3 tabular-nums">{row.sold}</td>
                    <td className="py-3 pr-3 tabular-nums">
                      {row.spend > 0 ? formatMoney(row.spend) : "—"}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {row.spend > 0 && row.leads > 0
                        ? formatMoney(Math.round(row.spend / row.leads))
                        : "Not enough data yet"}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {row.revenue > 0 ? formatMoney(row.revenue) : "—"}
                    </td>
                    <td className="py-3 tabular-nums">
                      {row.profit > 0 ? formatMoney(row.profit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-[var(--cy-text-muted)]">
          Revenue and profit appear only when attribution is recorded. Spend is advertising
          expenses plus imported campaign spend — never estimated.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">
            Connect what grows the business
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Integrations are not connected until you authorize a provider. Nothing here is mocked.
          </p>
          <ul className="mt-4 space-y-3">
            {connectNext.map((card) => (
              <li key={card.provider.key}>
                <Link
                  href="/marketing/channels"
                  className="flex items-start justify-between gap-3 rounded-xl px-2 py-2 hover:bg-[var(--cy-gray)]"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--cy-navy)]">{card.provider.name}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{card.provider.value}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-[var(--cy-orange)]">
                    {card.action === "CONFIGURE_INTEGRATION"
                      ? "Configure"
                      : card.action === "COMING_SOON"
                        ? "Coming soon"
                        : "Connect"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">
            ContractorYou Intelligence
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Insights are generated from this company&apos;s verified metrics only. Company A never
            trains or informs Company B.
          </p>
          {insights.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--muted-foreground)]">
              No computed insights yet. Trends and recommendations appear when there is enough
              recorded history — we will not show sample wins.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {insights.map((insight) => (
                <li key={insight.id} className="rounded-xl bg-[var(--cy-gray)] px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cy-orange)]">
                    {insight.insightType}
                  </p>
                  <p className="mt-1 font-medium text-[var(--cy-navy)]">{insight.title}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">{insight.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
