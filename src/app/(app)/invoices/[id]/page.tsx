import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney, lineTotalCents } from "@/lib/money";
import {
  recordPaymentAction,
  updateInvoiceStatusAction,
} from "@/server/actions/billing";
import { presentInvoiceAction } from "@/server/actions/payments";
import { sellMembershipAction } from "@/server/actions/memberships";
import { paymentLabel } from "@/lib/payments/provider";
import { stripeClientConfigured, stripePublishableKey } from "@/lib/payments/config";
import { appUrl } from "@/lib/payments/config";
import { CardPay } from "@/components/payments/card-pay";
import { InvoiceStatusRefresh } from "@/components/payments/invoice-status-refresh";
import { RefundForm } from "@/components/payments/refund-form";
import { syncOpenStripePaymentsForInvoice } from "@/lib/payments/sync";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QuickBooksInvoicePanel } from "@/components/quickbooks-invoice-panel";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("invoices:view");
  await syncOpenStripePaymentsForInvoice(prisma, ctx.company.id, id);
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      customer: true,
      job: true,
      lineItems: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!invoice) notFound();

  const plans = can(ctx.role, "memberships:manage")
    ? await prisma.membershipPlan.findMany({
        where: { companyId: ctx.company.id, active: true },
        orderBy: { name: "asc" },
      })
    : [];

  const [invoiceMap, lastEvent, paymentMaps, stripeAccount] = await Promise.all([
    prisma.quickBooksMapping.findFirst({
      where: { companyId: ctx.company.id, entityType: "INVOICE", internalId: invoice.id },
    }),
    prisma.quickBooksSyncEvent.findFirst({
      where: { companyId: ctx.company.id, entityType: "INVOICE", internalId: invoice.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quickBooksMapping.findMany({
      where: {
        companyId: ctx.company.id,
        entityType: "PAYMENT",
        internalId: { in: invoice.payments.map((payment) => payment.id) },
      },
    }),
    prisma.stripeConnectAccount.findUnique({ where: { companyId: ctx.company.id } }),
  ]);
  const publishable = stripePublishableKey();
  const cardReady =
    stripeClientConfigured() &&
    Boolean(stripeAccount && !stripeAccount.disabledAt && stripeAccount.chargesEnabled && publishable);
  const canCollect = can(ctx.role, "invoices:manage") || can(ctx.role, "invoices:field");
  const canRefund = can(ctx.role, "payments:refund");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/invoices"
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            ← Invoices
          </Link>
          <h1 className="mt-2 font-display text-3xl tracking-tight">
            {invoice.invoiceNumber}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {invoice.customer.firstName} {invoice.customer.lastName}
            {invoice.job ? ` · Job ${invoice.job.jobNumber}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={invoice.status} className="text-sm" />
          <InvoiceStatusRefresh invoiceId={invoice.id} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Invoice total</p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(invoice.totalCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Paid</p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(invoice.amountPaidCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Balance due</p>
          <p className="mt-1 text-xl font-medium tabular-nums">{formatMoney(invoice.balanceCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Invoice status</p>
          <p className="mt-1 text-xl"><StatusBadge status={invoice.status} /></p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {invoice.publicToken ? (
          <Link href={`/i/${invoice.publicToken}`} className={cn(buttonVariants({ variant: "outline" }))} target="_blank">
            Customer payment link
          </Link>
        ) : (
          <form
            action={async () => {
              "use server";
              await presentInvoiceAction(id);
            }}
          >
            <Button type="submit" size="sm" variant="outline">
              Create payment link
            </Button>
          </form>
        )}
      </div>

      {invoice.balanceCents > 0 && invoice.status !== "VOID" && canCollect ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <h2 className="font-medium">Collect card or bank payment</h2>
          {cardReady && stripeAccount && publishable ? (
            <div className="mt-3">
              <CardPay
                invoiceId={invoice.id}
                amountCents={invoice.balanceCents}
                publishableKey={publishable}
                stripeAccountId={stripeAccount.stripeAccountId}
                returnUrl={`${appUrl()}/invoices/${invoice.id}`}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Card collection is not available until ContractorYou Payments is connected in Settings → Payments.
            </p>
          )}
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.lineItems.map((li) => {
              const qty = Number(li.quantity);
              return (
                <TableRow key={li.id}>
                  <TableCell>
                    <div className="font-medium">{li.name}</div>
                    {li.description ? (
                      <div className="text-xs text-[var(--muted-foreground)]">{li.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{qty}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(li.unitPriceCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(lineTotalCents(qty, li.unitPriceCents))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-white p-4">
        {invoice.status === "DRAFT" ? (
          <form
            action={async () => {
              "use server";
              await updateInvoiceStatusAction(id, "SENT");
            }}
          >
            <Button type="submit" size="sm">Mark sent</Button>
          </form>
        ) : null}
        {invoice.status !== "PAID" && invoice.status !== "VOID" ? (
          <form
            action={async () => {
              "use server";
              await updateInvoiceStatusAction(id, "PAID");
            }}
          >
            <Button type="submit" size="sm" variant="outline">Mark paid</Button>
          </form>
        ) : null}
        {invoice.status !== "VOID" ? (
          <form
            action={async () => {
              "use server";
              await updateInvoiceStatusAction(id, "VOID");
            }}
          >
            <Button type="submit" size="sm" variant="ghost">Void</Button>
          </form>
        ) : null}
      </div>

      {invoice.balanceCents > 0 && invoice.status !== "VOID" ? (
        <ActionForm
          action={recordPaymentAction}
          successMessage="Payment recorded."
          className="space-y-4 rounded-xl border border-[var(--border)] bg-white p-4"
        >
          <h2 className="font-medium">Recorded payment</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Cash, check, or an external card charge. This is not a processor-confirmed payment.
          </p>
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount ($)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                defaultValue={(invoice.balanceCents / 100).toFixed(2)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="method">Method</Label>
              <select
                id="method"
                name="method"
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                defaultValue="OTHER"
              >
                <option value="CASH">Cash</option>
                <option value="CHECK">Check</option>
                <option value="CREDIT_CARD">Credit card</option>
                <option value="ACH">ACH</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <Input name="reference" placeholder="Check number or reference" />
          <Input name="notes" placeholder="Notes" />
          <Button type="submit">Record payment</Button>
        </ActionForm>
      ) : null}

      {can(ctx.role, "memberships:manage") && plans.length > 0 ? (
        <ActionForm
          action={sellMembershipAction}
          successMessage="Membership recorded."
          className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
        >
          <h2 className="font-medium">Sell a membership</h2>
          <input type="hidden" name="customerId" value={invoice.customerId} />
          <input type="hidden" name="invoiceId" value={invoice.id} />
          {invoice.jobId ? <input type="hidden" name="jobId" value={invoice.jobId} /> : null}
          <select name="planId" required className="h-8 max-w-sm rounded-lg border border-input px-2.5 text-sm">
            <option value="">Choose a plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {formatMoney(plan.priceCents)}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm">
            Record membership
          </Button>
        </ActionForm>
      ) : null}

      <QuickBooksInvoicePanel
        role={ctx.role}
        invoiceId={invoice.id}
        importMode={invoice.importMode}
        mapping={invoiceMap}
        lastEvent={lastEvent}
        payments={invoice.payments.map((payment) => ({
          id: payment.id,
          amountLabel: formatMoney(payment.amountCents),
          mapping: paymentMaps.find((row) => row.internalId === payment.id) ?? null,
        }))}
      />

      {invoice.payments.length > 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <h2 className="mb-3 font-medium">Payments</h2>
          <ul className="space-y-2 text-sm">
            {invoice.payments.map((p) => (
              <li key={p.id} className="space-y-2 border-b border-[var(--border)] py-2 last:border-0">
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted-foreground)]">
                    {p.paidAt.toLocaleString()} · {paymentLabel(p)}
                    {p.status === "DISPUTED" ? " · Payment disputed" : ""}
                    {p.refundedCents ? ` · Refunded ${formatMoney(p.refundedCents)}` : ""}
                  </span>
                  <span className="tabular-nums">{formatMoney(p.amountCents)}</span>
                </div>
                {canRefund && p.provider === "STRIPE" && p.amountCents - (p.refundedCents ?? 0) > 0 ? (
                  <RefundForm paymentId={p.id} remainingCents={p.amountCents - (p.refundedCents ?? 0)} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Link href="/invoices" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to list
      </Link>
    </div>
  );
}
