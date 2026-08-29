import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function ExpensesPage() {
  const ctx = await requirePermission("expenses:view");
  const expenses = await prisma.expense.findMany({
    where: { companyId: ctx.company.id },
    include: { job: true, receipt: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Track costs with optional receipt uploads.
          </p>
        </div>
        <Link href="/expenses/new" className={cn(buttonVariants())}>
          New expense
        </Link>
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          title="No expenses yet"
          description="Log materials, fuel, and other costs. Attach a receipt if you have one."
          actionLabel="New expense"
          actionHref="/expenses/new"
        />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell>
                    <Link
                      href={`/expenses/${ex.id}`}
                      className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      {ex.date.toLocaleDateString()}
                    </Link>
                  </TableCell>
                  <TableCell>{ex.vendor || "—"}</TableCell>
                  <TableCell>{ex.category.replaceAll("_", " ")}</TableCell>
                  <TableCell>
                    <StatusBadge status={ex.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(ex.amountCents)}
                  </TableCell>
                  <TableCell>
                    {ex.receipt ? (
                      <StatusBadge status={ex.receipt.processingStatus} />
                    ) : (
                      "—"
                    )}
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
