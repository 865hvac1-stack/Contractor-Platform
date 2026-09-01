import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EstimateStatus, Prisma } from "@prisma/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requirePermission("estimates:view");
  const { status } = await searchParams;
  const now = new Date();
  const followUpCutoff = new Date();
  followUpCutoff.setDate(followUpCutoff.getDate() - 3);
  const openStatuses: EstimateStatus[] = ["DRAFT", "SENT", "VIEWED"];
  const followUpStatuses: EstimateStatus[] = ["SENT", "VIEWED"];
  const unscheduledJobStatuses = ["NEW", "UNSCHEDULED"] as const;

  const where: Prisma.EstimateWhereInput =
    status === "open"
      ? { companyId: ctx.company.id, status: { in: openStatuses } }
      : status === "approved"
        ? {
            companyId: ctx.company.id,
            status: "APPROVED",
            OR: [
              { linkedJob: null, jobId: null },
              { linkedJob: { status: { in: [...unscheduledJobStatuses] } } },
              { job: { status: { in: [...unscheduledJobStatuses] } } },
            ],
          }
        : status === "followup"
          ? {
              companyId: ctx.company.id,
              status: { in: followUpStatuses },
              OR: [{ followUpAt: { lte: now } }, { followUpAt: null, issueDate: { lte: followUpCutoff } }],
            }
          : { companyId: ctx.company.id };

  const estimates = await prisma.estimate.findMany({
    where,
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Estimates</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {status === "open"
              ? "Showing open estimates awaiting a decision."
              : status === "approved"
                ? "Showing approved estimates that still need scheduling."
                : status === "followup"
                  ? "Showing estimates that need follow-up."
                  : "Draft, send, and track customer estimates."}
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
