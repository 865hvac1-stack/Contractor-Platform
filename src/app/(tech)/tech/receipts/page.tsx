import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { TechReceiptUpload } from "@/components/tech/receipt-upload";
import { can } from "@/lib/permissions";

export default async function TechReceiptsPage() {
  const ctx = await requirePermission("receipts:view");
  const [receipts, membership, currentJob] = await Promise.all([
    prisma.receipt.findMany({
      where: { companyId: ctx.company.id, uploadedById: ctx.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.membership.findUnique({
      where: { companyId_userId: { companyId: ctx.company.id, userId: ctx.user.id } },
      select: { assignedVehicleId: true },
    }),
    prisma.job.findFirst({
      where: {
        companyId: ctx.company.id,
        assignments: { some: { userId: ctx.user.id } },
        status: { in: ["DISPATCHED", "IN_PROGRESS"] },
      },
      select: { id: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl tracking-tight">Receipts</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        Upload a fuel, supply, or job receipt. AI may suggest vendor and amount — you confirm later.
      </p>
      {can(ctx.role, "receipts:manage") ? (
        <TechReceiptUpload jobId={currentJob?.id} defaultVehicleId={membership?.assignedVehicleId} />
      ) : null}
      {receipts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No receipts uploaded yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm">
              <p className="font-medium">{receipt.vendor ?? receipt.fileName}</p>
              <p className="text-[var(--muted-foreground)]">
                {receipt.totalCents != null ? formatMoney(receipt.totalCents) : "Amount pending"} · {receipt.assignment} ·{" "}
                {receipt.processingStatus}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/tech/more" className="block text-center text-sm text-[var(--muted-foreground)]">
        Back to more
      </Link>
    </div>
  );
}
