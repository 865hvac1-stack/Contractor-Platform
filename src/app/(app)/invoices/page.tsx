import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MoneySubnav } from "@/components/hub-subnav";
import { FinanceFilterContext } from "@/components/finance/filter-context";
import { financeFilterCopy, parseFinanceSearch } from "@/lib/finance/query";
import { invoicesWhere, parseInvoicesListQuery } from "@/lib/invoices/search";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    from?: string;
    to?: string;
    view?: string;
    serviceType?: string;
    source?: string;
    range?: string;
  }>;
}) {
  const ctx = await requirePermission("invoices:view");
  const params = await searchParams;
  const query = parseInvoicesListQuery(params);
  const finance = parseFinanceSearch(params);
  const where = invoicesWhere(ctx.company.id, query);
  const invoices = await prisma.invoice.findMany({
    where,
    include: { customer: true, serviceType: { select: { name: true } }, job: { select: { jobType: true } } },
    orderBy: { createdAt: "desc" },
  });
  const copy = financeFilterCopy(finance);
  const amountField = finance.view === "ar" || finance.view === "overdue" || query.status === "OPEN" || query.status === "overdue"
    ? "balanceCents"
    : "totalCents";
  const totalCents = invoices.reduce((sum, invoice) => sum + invoice[amountField], 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {copy?.detail ?? "Bill customers and track balances."}
          </p>
        </div>
        <Link href="/invoices/new" className={cn(buttonVariants())}>
          New invoice
        </Link>
      </div>
      <MoneySubnav />

      {copy ? (
        <FinanceFilterContext
          title={copy.title}
          detail={copy.detail}
          amount={invoices.length > 0 ? formatMoney(totalCents) : undefined}
          backHref={finance.backHref}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {[
          { id: "", label: "All" },
          { id: "OPEN", label: "Open" },
          { id: "PAID", label: "Paid" },
          { id: "overdue", label: "Overdue" },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.id ? `/invoices?status=${item.id}` : "/invoices"}
            className={`rounded-full px-3 py-1 text-sm ${
              (query.status || "") === item.id
                ? "bg-[var(--cy-navy)] text-white"
                : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title={query.status || query.from || query.serviceType ? "No matching invoices" : "No invoices yet"}
          description={
            query.status || query.from || query.serviceType
              ? "Nothing in ContractorYou matches this filter yet."
              : "Create an invoice with line items when work is ready to bill."
          }
          actionLabel="New invoice"
          actionHref="/invoices/new"
        />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      {inv.invoiceNumber}
                    </Link>
                    {inv.serviceType?.name || inv.job?.jobType ? (
                      <p className="text-xs text-[var(--muted-foreground)]">{inv.serviceType?.name || inv.job?.jobType}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {inv.customer.firstName} {inv.customer.lastName}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(inv.totalCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(inv.balanceCents)}
                  </TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">
                    {inv.createdAt.toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
