import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InvoiceStatus, Prisma } from "@prisma/client";
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
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requirePermission("invoices:view");
  const { status } = await searchParams;
  const now = new Date();
  const overdueStatuses: InvoiceStatus[] = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
  const where: Prisma.InvoiceWhereInput =
    status === "overdue"
      ? {
          companyId: ctx.company.id,
          status: { in: overdueStatuses },
          balanceCents: { gt: 0 },
          dueDate: { lt: now },
        }
      : { companyId: ctx.company.id };
  const invoices = await prisma.invoice.findMany({
    where,
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {status === "overdue"
              ? "Showing overdue invoices with an outstanding balance."
              : "Bill customers and track balances."}
          </p>
        </div>
        <Link href="/invoices/new" className={cn(buttonVariants())}>
          New invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Create an invoice with line items when work is ready to bill."
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
