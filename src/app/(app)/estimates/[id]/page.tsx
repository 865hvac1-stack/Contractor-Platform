import Link from "next/link";
import { notFound } from "next/navigation";
import type { EstimateStatus } from "@prisma/client";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney, lineTotalCents } from "@/lib/money";
import { updateEstimateStatusAction } from "@/server/actions/billing";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_ACTIONS: { status: EstimateStatus; label: string }[] = [
  { status: "SENT", label: "Mark sent" },
  { status: "VIEWED", label: "Mark viewed" },
  { status: "APPROVED", label: "Approve" },
  { status: "DECLINED", label: "Decline" },
  { status: "EXPIRED", label: "Mark expired" },
  { status: "CANCELED", label: "Cancel" },
];

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("estimates:view");
  const estimate = await prisma.estimate.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      customer: true,
      property: true,
      job: true,
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!estimate) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/estimates"
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            ← Estimates
          </Link>
          <h1 className="mt-2 font-display text-3xl tracking-tight">
            {estimate.estimateNumber}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {estimate.customer.firstName} {estimate.customer.lastName}
            {estimate.job ? ` · Job ${estimate.job.jobNumber}` : ""}
          </p>
        </div>
        <StatusBadge status={estimate.status} className="text-sm" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Subtotal
          </p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(estimate.subtotalCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Tax</p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(estimate.taxCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Total</p>
          <p className="mt-1 text-xl font-medium tabular-nums">
            {formatMoney(estimate.totalCents)}
          </p>
        </div>
      </div>

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
            {estimate.lineItems.map((li) => {
              const qty = Number(li.quantity);
              return (
                <TableRow key={li.id}>
                  <TableCell>
                    <div className="font-medium">{li.name}</div>
                    {li.description ? (
                      <div className="text-xs text-[var(--muted-foreground)]">
                        {li.description}
                      </div>
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

      {estimate.notes ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{estimate.notes}</p>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <p className="mb-3 text-sm font-medium">Update status</p>
        <div className="flex flex-wrap gap-2">
          {STATUS_ACTIONS.filter((a) => a.status !== estimate.status).map((a) => (
            <form
              key={a.status}
              action={async () => {
                "use server";
                await updateEstimateStatusAction(id, a.status);
              }}
            >
              <Button
                type="submit"
                variant={a.status === "APPROVED" ? "default" : "outline"}
                size="sm"
              >
                {a.label}
              </Button>
            </form>
          ))}
          {estimate.status !== "DRAFT" ? (
            <form
              action={async () => {
                "use server";
                await updateEstimateStatusAction(id, "DRAFT");
              }}
            >
              <Button type="submit" variant="ghost" size="sm">
                Revert to draft
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <Link href="/estimates" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to list
      </Link>
    </div>
  );
}
