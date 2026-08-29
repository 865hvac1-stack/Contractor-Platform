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

export default async function EstimatesPage() {
  const ctx = await requirePermission("estimates:view");
  const estimates = await prisma.estimate.findMany({
    where: { companyId: ctx.company.id },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Estimates</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Draft, send, and track customer estimates.
          </p>
        </div>
        <Link href="/estimates/new" className={cn(buttonVariants())}>
          New estimate
        </Link>
      </div>

      {estimates.length === 0 ? (
        <EmptyState
          title="No estimates yet"
          description="Create your first estimate with line items and send it to a customer."
          actionLabel="New estimate"
          actionHref="/estimates/new"
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
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimates.map((est) => (
                <TableRow key={est.id}>
                  <TableCell>
                    <Link
                      href={`/estimates/${est.id}`}
                      className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      {est.estimateNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {est.customer.firstName} {est.customer.lastName}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={est.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(est.totalCents)}
                  </TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">
                    {est.createdAt.toLocaleDateString()}
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
