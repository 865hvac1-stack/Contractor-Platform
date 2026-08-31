import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { companyPaymentMetrics, recentCompanyPayments } from "@/lib/payments/metrics";
import { loadPayoutSnapshot } from "@/lib/payments/payouts";
import { paymentLabel } from "@/lib/payments/provider";
import { uxStatus } from "@/lib/payments/connect";
import { stripeConfigured } from "@/lib/payments/config";
import { EmptyState } from "@/components/empty-state";

export default async function PaymentsDashboardPage() {
  const ctx = await requirePermission("invoices:view");
  const [metrics, recent, account] = await Promise.all([
    companyPaymentMetrics(prisma, ctx.company.id),
    recentCompanyPayments(prisma, ctx.company.id),
    prisma.stripeConnectAccount.findUnique({ where: { companyId: ctx.company.id } }),
  ]);
  const status = uxStatus({ platformConfigured: stripeConfigured(), account });
  const canPayouts = can(ctx.role, "payments:view_payouts");
  const payouts = canPayouts ? await loadPayoutSnapshot(prisma, ctx.company.id) : null;

  const cards = [
    { label: "Collected today", value: formatMoney(metrics.collectedTodayCents) },
    { label: "Collected this week", value: formatMoney(metrics.collectedWeekCents) },
    { label: "Collected this month", value: formatMoney(metrics.collectedMonthCents) },
    { label: "Outstanding", value: formatMoney(metrics.outstandingCents) },
    { label: "Processing", value: formatMoney(metrics.processingCents) },
    { label: "Failed this month", value: formatMoney(metrics.failedCents) },
    { label: "Refunds this month", value: formatMoney(metrics.refundedMonthCents) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Customer payments collected in ContractorYou. Bank payouts are a separate Stripe event.
          </p>
        </div>
        {can(ctx.role, "company:settings") ? (
          <Link href="/settings/payments" className="text-sm font-medium text-[var(--cy-orange)] underline">
            Payment settings
          </Link>
        ) : null}
      </div>

      <p className="text-sm text-[var(--muted-foreground)]">
        ContractorYou Payments: {status.replaceAll("_", " ")}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-[var(--border)] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      {canPayouts ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Bank payouts</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Money moving from Stripe to your business bank — not the same as a customer payment.
          </p>
          {!payouts || !payouts.ok ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {payouts && !payouts.ok ? payouts.error : "Payout information is unavailable."}
            </p>
          ) : (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-[var(--muted-foreground)]">Available</p>
                  <p className="text-xl tabular-nums">{formatMoney(payouts.availableCents)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-[var(--muted-foreground)]">Pending</p>
                  <p className="text-xl tabular-nums">{formatMoney(payouts.pendingCents)}</p>
                </div>
              </div>
              {payouts.payouts.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--muted-foreground)]">No payouts yet.</p>
              ) : (
                <ul className="mt-4 space-y-2 text-sm">
                  {payouts.payouts.map((payout) => (
                    <li key={payout.id} className="flex justify-between gap-3">
                      <span>
                        {payout.arrivalDate ? payout.arrivalDate.toLocaleDateString() : "Scheduled"} ·{" "}
                        {payout.status}
                      </span>
                      <span className="tabular-nums">{formatMoney(payout.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Recent payments</h2>
        {recent.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Collected card, bank, cash, and check payments will appear here. Nothing is invented."
          />
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {recent.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-3 border-b border-[var(--border)] py-2 last:border-0">
                <span>
                  {payment.invoice.invoiceNumber} · {payment.invoice.customer.firstName}{" "}
                  {payment.invoice.customer.lastName} · {paymentLabel(payment)}
                </span>
                <Link href={`/invoices/${payment.invoiceId}`} className="tabular-nums underline">
                  {formatMoney(payment.amountCents)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
