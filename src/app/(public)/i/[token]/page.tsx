import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, lineTotalCents } from "@/lib/money";
import { paymentLabel, stripeConfigured } from "@/lib/payments/provider";
import { publicPayInvoiceAction } from "@/server/actions/public-billing";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";

export default async function PublicInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; canceled?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const invoice = await prisma.invoice.findFirst({
    where: { publicToken: token },
    include: {
      company: true,
      customer: true,
      lineItems: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!invoice) notFound();
  const cardReady = stripeConfigured();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          {invoice.company.businessName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Invoice {invoice.invoiceNumber}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {invoice.customer.firstName} {invoice.customer.lastName}
        </p>
      </div>
      <StatusBadge status={invoice.status} />

      {query.paid ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          If payment succeeded, it will appear below after the processor confirms it. This is not a payroll receipt.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Invoice total", value: formatMoney(invoice.totalCents) },
          { label: "Paid", value: formatMoney(invoice.amountPaidCents) },
          { label: "Balance due", value: formatMoney(invoice.balanceCents) },
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
        cardReady ? (
          <ActionForm action={publicPayInvoiceAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Pay balance by card</Button>
          </ActionForm>
        ) : (
          <p className="rounded-xl border border-[var(--border)] bg-white p-4 text-sm text-[var(--muted-foreground)]">
            Card payments are not configured. Please pay the office by cash, check, or another recorded method.
          </p>
        )
      ) : null}

      {invoice.payments.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {invoice.payments.map((payment) => (
            <li key={payment.id} className="flex justify-between gap-3">
              <span>{paymentLabel(payment)}</span>
              <span className="tabular-nums">{formatMoney(payment.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No payments recorded.</p>
      )}
    </main>
  );
}
