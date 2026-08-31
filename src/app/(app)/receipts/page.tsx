import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

const TABS: { key: string; label: string; where: Prisma.ReceiptWhereInput }[] = [
  { key: "review", label: "Needs review", where: { processingStatus: { in: ["UPLOADED", "REVIEW_REQUIRED", "PROCESSING"] } } },
  { key: "unassigned", label: "Unassigned", where: { assignment: "UNASSIGNED", processingStatus: { not: "CONFIRMED" } } },
  { key: "duplicates", label: "Possible duplicate", where: { duplicateStatus: "POSSIBLE" } },
  { key: "confirmed", label: "Confirmed", where: { processingStatus: "CONFIRMED" } },
  { key: "all", label: "All", where: {} },
];

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requirePermission("receipts:view");
  const { tab } = await searchParams;
  const current = TABS.find((item) => item.key === tab) ?? TABS[0];
  const [receipts, counts] = await Promise.all([
    prisma.receipt.findMany({
      where: { companyId: ctx.company.id, ...current.where },
      include: { job: true, vehicle: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    Promise.all(
      TABS.map(async (item) => ({
        key: item.key,
        count: await prisma.receipt.count({ where: { companyId: ctx.company.id, ...item.where } }),
      }))
    ),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Receipts</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Snap a photo, assign it, and confirm. Confirmed receipts become job costs or company expenses.
          </p>
        </div>
        <Link href="/receipts/new" className={cn(buttonVariants(), "min-h-11 px-5")}>
          Add receipt
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((item) => {
          const count = counts.find((row) => row.key === item.key)?.count ?? 0;
          const active = item.key === current.key;
          return (
            <Link
              key={item.key}
              href={item.key === "review" ? "/receipts" : `/receipts?tab=${item.key}`}
              className={cn(
                "shrink-0 rounded-full px-3 py-2 text-sm",
                active ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--muted-foreground)] border border-[var(--border)]"
              )}
            >
              {item.label}
              {count ? ` · ${count}` : ""}
            </Link>
          );
        })}
      </div>

      {receipts.length === 0 ? (
        <EmptyState
          title="No receipts yet."
          description={
            current.key === "review"
              ? "When a tech snaps a receipt, it lands here for review."
              : "Nothing in this queue."
          }
          actionLabel="Add receipt"
          actionHref="/receipts/new"
        />
      ) : (
        <ul className="space-y-3">
          {receipts.map((receipt) => (
            <li key={receipt.id}>
              <Link
                href={`/receipts/${receipt.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{receipt.vendor || receipt.fileName}</p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {receipt.receiptDate ? receipt.receiptDate.toLocaleDateString() : "No date"}
                    {receipt.job ? ` · ${receipt.job.jobNumber}` : ""}
                    {receipt.vehicle ? ` · ${receipt.vehicle.name}` : ""}
                    {receipt.assignment === "UNASSIGNED" ? " · Unassigned" : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular-nums">{receipt.totalCents != null ? formatMoney(receipt.totalCents) : "—"}</p>
                  <div className="mt-1 flex justify-end gap-1">
                    <StatusBadge status={receipt.processingStatus} />
                    {receipt.duplicateStatus === "POSSIBLE" ? <StatusBadge status="POSSIBLE DUPLICATE" /> : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
