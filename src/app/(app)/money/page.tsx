import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { collectedAmountCents } from "@/lib/payments/record";
import { paymentLabel } from "@/lib/payments/provider";
import { collectedPaymentWhere, revenueInvoiceWhere } from "@/lib/finance/definitions";
import { loadFinancialSnapshot } from "@/lib/finance/snapshot";
import { financeFilterCopy, parseFinanceSearch } from "@/lib/finance/query";
import { FinanceFilterContext } from "@/components/finance/filter-context";
import { MoneySubnav } from "@/components/hub-subnav";
import { getCompanyConnection } from "@/lib/integrations/store";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { quickBooksCardState, QUICKBOOKS_STATUS_COPY } from "@/lib/quickbooks/status";
import { refreshBillingWatchdog } from "@/lib/billing-watchdog/service";
import { BillingWatchdogHomeCard } from "@/components/billing-watchdog/home-card";

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    view?: string;
    range?: string;
    source?: string;
  }>;
}) {
  const ctx = await requirePermission("invoices:view");
  const finance = parseFinanceSearch(await searchParams);
  const snapshot = await loadFinancialSnapshot(ctx.company.id, finance.range);
  const [qboConnection, qboSettings, watchdog] = await Promise.all([
    getCompanyConnection(ctx.company.id, QUICKBOOKS_PROVIDER_KEY),
    prisma.quickBooksSettings.findUnique({ where: { companyId: ctx.company.id } }),
    refreshBillingWatchdog(prisma, ctx.company.id),
  ]);
  const qboCard = quickBooksCardState({
    connection: qboConnection,
    verifiedCompanyName: qboSettings?.qboCompanyName,
  });
  const isDay = finance.view === "day" && finance.start && finance.end;
  const copy = financeFilterCopy(finance) ?? (finance.source === "home"
    ? { title: "Money", detail: snapshot.period.label }
    : null);

  const dayRecords = isDay
    ? await Promise.all([
        prisma.invoice.findMany({
          where: revenueInvoiceWhere(ctx.company.id, finance.start!, finance.end!),
          include: { customer: true },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.payment.findMany({
          where: collectedPaymentWhere(ctx.company.id, finance.start!, finance.end!),
          include: {
            invoice: { select: { invoiceNumber: true, customer: { select: { firstName: true, lastName: true } } } },
          },
          orderBy: { paidAt: "desc" },
        }),
      ])
    : null;

  const dayRevenue = dayRecords?.[0].reduce((sum, invoice) => sum + invoice.totalCents, 0) ?? 0;
  const dayCollected = dayRecords?.[1].reduce((sum, payment) => sum + collectedAmountCents(payment), 0) ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Money</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          What came in, what went out, who owes us, and what needs attention.
        </p>
      </header>
      <MoneySubnav />
      <BillingWatchdogHomeCard summary={watchdog.summary} />

      {copy ? (
        <FinanceFilterContext
          title={copy.title}
          detail={copy.detail}
          amount={isDay ? `${formatMoney(dayRevenue)} revenue · ${formatMoney(dayCollected)} collected` : undefined}
          backHref={finance.backHref}
        />
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MoneyStat
          label={isDay ? "Revenue this period" : `Revenue · ${snapshot.period.label}`}
          value={formatMoney(isDay ? dayRevenue : snapshot.revenueCents)}
          href={snapshot.hrefs.revenue}
        />
        <MoneyStat
          label={isDay ? "Collected this period" : `Collected · ${snapshot.period.label}`}
          value={formatMoney(isDay ? dayCollected : snapshot.collectedCents)}
          href={snapshot.hrefs.collected}
        />
        <MoneyStat label="A/R" value={formatMoney(snapshot.arCents)} href={snapshot.hrefs.ar} />
        <MoneyStat label="Overdue" value={formatMoney(snapshot.overdueArCents)} href={snapshot.hrefs.overdueAr} />
        <MoneyStat label="Open estimates" value={formatMoney(snapshot.openEstimateCents)} href={snapshot.hrefs.openEstimates} />
        <MoneyStat
          label={`Expenses · ${snapshot.period.label}`}
          value={formatMoney(snapshot.expenseCents)}
          href={snapshot.hrefs.expenses}
        />
        <MoneyStat
          label="Receipts to review"
          value={String(snapshot.receiptsToReview)}
          href={snapshot.hrefs.receipts}
        />
        <MoneyStat
          label="Job profit"
          value={
            snapshot.grossProfitAvailable && snapshot.grossProfitCents != null
              ? formatMoney(snapshot.grossProfitCents)
              : "Needs confirmed job costs"
          }
          href={snapshot.hrefs.grossProfit}
        />
        <MoneyStat
          label="QuickBooks"
          value={qboSettings?.qboCompanyName && qboCard === "CONNECTED" ? qboSettings.qboCompanyName : QUICKBOOKS_STATUS_COPY[qboCard]}
          href="/settings/quickbooks"
        />
      </dl>

      {dayRecords ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="font-medium">Paid invoices</h2>
            {dayRecords[0].length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">No paid invoices in this period.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {dayRecords[0].map((invoice) => (
                  <li key={invoice.id} className="flex justify-between gap-3 border-b border-[var(--border)] py-2 last:border-0">
                    <Link href={`/invoices/${invoice.id}`} className="hover:underline">
                      {invoice.invoiceNumber} · {invoice.customer.firstName} {invoice.customer.lastName}
                    </Link>
                    <span className="tabular-nums">{formatMoney(invoice.totalCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h2 className="font-medium">Payments</h2>
            {dayRecords[1].length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">No collected payments in this period.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {dayRecords[1].map((payment) => (
                  <li key={payment.id} className="flex justify-between gap-3 border-b border-[var(--border)] py-2 last:border-0">
                    <Link href={`/invoices/${payment.invoiceId}`} className="hover:underline">
                      {payment.invoice.invoiceNumber} · {payment.invoice.customer.firstName}{" "}
                      {payment.invoice.customer.lastName} · {paymentLabel(payment)}
                    </Link>
                    <span className="tabular-nums">{formatMoney(collectedAmountCents(payment))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-sm font-medium">
        <Link href={snapshot.hrefs.revenue} className="text-[var(--cy-orange)]">
          View invoices →
        </Link>
        <Link href={snapshot.hrefs.collected} className="text-[var(--cy-orange)]">
          View payments →
        </Link>
        {can(ctx.role, "reports:view") ? (
          <Link href={snapshot.hrefs.reports} className="text-[var(--cy-orange)]">
            View reports →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function MoneyStat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--cy-orange)]/40">
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--cy-navy)]">{value}</dd>
    </Link>
  );
}
