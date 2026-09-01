import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, lineTotalCents } from "@/lib/money";
import { paymentLabel } from "@/lib/payments/provider";
import { stripeClientConfigured, stripePublishableKey } from "@/lib/payments/config";
import { PublicCardPay } from "@/components/payments/card-pay";
import { InvoiceStatusRefresh } from "@/components/payments/invoice-status-refresh";
import { StatusBadge } from "@/components/status-badge";
import { appUrl } from "@/lib/payments/config";
import { syncOpenStripePaymentsForInvoice } from "@/lib/payments/sync";
import { TenantDocumentBrand } from "@/components/tenant-document-brand";
import { DemoModeBadge } from "@/components/demo-mode-badge";

export default async function PublicInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; canceled?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const existing = await prisma.invoice.findFirst({
    where: { publicToken: token },
    select: { id: true, companyId: true },
  });
  if (existing) {
    await syncOpenStripePaymentsForInvoice(prisma, existing.companyId, existing.id);
  }
  const invoice = await prisma.invoice.findFirst({
    where: { publicToken: token },
    include: {
      company: true,
      customer: true,
      lineItems: { orderBy: { sortOrder: "asc" } },
      payments: {
        where: { status: { notIn: ["CANCELED"] } },
        orderBy: { paidAt: "desc" },
        select: {
          id: true,
          amountCents: true,
          method: true,
          status: true,
          provider: true,
          paidAt: true,
          refundedCents: true,
        },
      },
    },
  });
  if (!invoice) notFound();

  const account = await prisma.stripeConnectAccount.findUnique({
    where: { companyId: invoice.companyId },
  });
  const publishable = stripePublishableKey();
  const cardReady =
    stripeClientConfigured() &&
    Boolean(account && !account.disabledAt && account.chargesEnabled && publishable);
  const visiblePayments = invoice.payments.filter((payment) =>
    ["CONFIRMED", "SUCCEEDED", "RECORDED", "PROCESSING", "REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED", "FAILED"].includes(
      payment.status
    )
  );

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <TenantDocumentBrand
          businessName={invoice.company.businessName}
          tagline={invoice.company.tagline}
          logoUrl={invoice.company.logoUrl}
          primaryColor={invoice.company.primaryColor}
          accentColor={invoice.company.accentColor}
        />
        {invoice.company.isDemo ? <div className="mt-2"><DemoModeBadge /></div> : null}
        <h1 className="mt-2 font-display text-3xl tracking-tight">Invoice {invoice.invoiceNumber}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {invoice.customer.firstName} {invoice.customer.lastName}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={invoice.status} />
        <InvoiceStatusRefresh token={token} />
      </div>

      {query.paid ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          If payment succeeded, it will appear below after the processor confirms it.
        </p>
      ) : null}
      {query.canceled ? (
        <p className="rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm">Payment was canceled.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Invoice total", value: formatMoney(invoice.totalCents) },
          { label: "Paid", value: formatMoney(invoice.amountPaidCents) },
          { label: "Amount due", value: formatMoney(invoice.balanceCents) },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-[var(--border)] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.label}</p>
            <p className="mt-1 text-xl tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      <ul className="space-y-2 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        {invoice.lineItems.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span>{item.name}</span>
            <span className="tabular-nums">
              {formatMoney(lineTotalCents(Number(item.quantity), item.unitPriceCents))}
            </span>
          </li>
        ))}
      </ul>

      {invoice.balanceCents > 0 && invoice.status !== "VOID" ? (
        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Secure payment</h2>
          {cardReady && account && publishable ? (
            <PublicCardPay
              token={token}
              amountCents={invoice.balanceCents}
              publishableKey={publishable}
              stripeAccountId={account.stripeAccountId}
              returnUrl={`${appUrl()}/i/${token}?paid=1`}
            />
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              Card payments are not available for this invoice. Please pay the office by cash, check, or another
              recorded method.
            </p>
          )}
        </section>
      ) : invoice.balanceCents === 0 ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          This invoice is paid.
        </p>
      ) : null}

      {visiblePayments.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {visiblePayments.map((payment) => (
            <li key={payment.id} className="flex justify-between gap-3">
              <span>{paymentLabel(payment)}</span>
              <span className="tabular-nums">{formatMoney(payment.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No payments recorded.</p>
      )}

      <p className="text-center text-[11px] text-[var(--muted-foreground)]">
        Powered by ContractorYou. Card and bank details are handled by Stripe.
      </p>
    </main>
  );
}
