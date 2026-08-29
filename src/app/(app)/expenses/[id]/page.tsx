import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("expenses:view");
  const expense = await prisma.expense.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      job: true,
      customer: true,
      receipt: true,
      createdBy: true,
    },
  });
  if (!expense) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/expenses"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Expenses
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">
          {expense.vendor || "Expense"}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {expense.date.toLocaleDateString()} · {expense.category.replaceAll("_", " ")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Amount</p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(expense.amountCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Tax</p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(expense.taxCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Status</p>
          <div className="mt-2">
            <StatusBadge status={expense.status} />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        {expense.description ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Description
            </p>
            <p className="mt-1 whitespace-pre-wrap">{expense.description}</p>
          </div>
        ) : null}
        {expense.job ? (
          <p>
            <span className="text-[var(--muted-foreground)]">Job: </span>
            {expense.job.jobNumber}
          </p>
        ) : null}
        {expense.paymentMethod ? (
          <p>
            <span className="text-[var(--muted-foreground)]">Payment: </span>
            {expense.paymentMethod.replaceAll("_", " ")}
          </p>
        ) : null}
        <p>
          <span className="text-[var(--muted-foreground)]">Logged by: </span>
          {expense.createdBy.firstName} {expense.createdBy.lastName}
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-medium">Receipt</h2>
        {expense.receipt ? (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={expense.receipt.processingStatus} />
              <span className="text-[var(--muted-foreground)]">
                Upload status only — no automatic extraction has been run.
              </span>
            </div>
            <p>
              <span className="text-[var(--muted-foreground)]">File: </span>
              {expense.receipt.fileName} ({Math.round(expense.receipt.fileSizeBytes / 1024)} KB)
            </p>
            <Link
              href={`/api/receipts/${expense.receipt.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Download receipt
            </Link>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No receipt attached.</p>
        )}
      </div>

      <Link href="/expenses" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to list
      </Link>
    </div>
  );
}
