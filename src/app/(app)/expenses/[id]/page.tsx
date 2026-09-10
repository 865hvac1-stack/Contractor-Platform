import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/action-form";
import { approveExpenseAction } from "@/server/actions/expenses";
import { syncExpenseToQuickBooksAction } from "@/server/actions/quickbooks";

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
  const mapping = await prisma.quickBooksMapping.findFirst({
    where: { companyId: ctx.company.id, entityType: "EXPENSE", internalId: expense.id },
  });
  const canApprove = can(ctx.role, "accounting:manage");

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

      <div className="rounded-xl border border-[var(--border)] bg-white p-4 space-y-3">
        <h2 className="font-medium">QuickBooks</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {mapping
            ? `Synced · QB Purchase #${mapping.quickbooksId}`
            : "Not in QuickBooks. Approval is required before accounting sync."}
        </p>
        {canApprove && expense.status !== "APPROVED" && expense.status !== "REJECTED" ? (
          <ActionForm action={approveExpenseAction}>
            <input type="hidden" name="expenseId" value={expense.id} />
            <Button type="submit" size="sm">
              Approve for accounting
            </Button>
          </ActionForm>
        ) : null}
        {canApprove && (expense.status === "APPROVED" || expense.status === "POSTED") && !mapping ? (
          <ActionForm action={syncExpenseToQuickBooksAction}>
            <input type="hidden" name="expenseId" value={expense.id} />
            <Button type="submit" size="sm" variant="outline">
              Sync to QuickBooks
            </Button>
          </ActionForm>
        ) : null}
      </div>

      <Link href="/expenses" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to list
      </Link>
    </div>
  );
}
