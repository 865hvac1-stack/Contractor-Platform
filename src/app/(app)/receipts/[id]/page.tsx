import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { reviewReceiptAction, createVehicleAction } from "@/server/actions/receipts";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = [
  "MATERIALS",
  "EQUIPMENT",
  "FUEL",
  "SUBCONTRACTOR",
  "PERMITS",
  "TOOLS",
  "VEHICLE",
  "OFFICE",
  "OTHER",
] as const;

const ASSIGNMENTS = [
  { value: "JOB", label: "Job" },
  { value: "VEHICLE", label: "Truck" },
  { value: "OVERHEAD", label: "Company expense" },
  { value: "INVENTORY", label: "Inventory / stock" },
  { value: "UNASSIGNED", label: "Leave unassigned" },
] as const;

export default async function ReceiptReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("receipts:view");
  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({
    where: { id, companyId: ctx.company.id },
    include: { job: true, vehicle: true, expense: true, duplicateOf: true },
  });
  if (!receipt) notFound();

  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const [jobs, vehicles] = await Promise.all([
    prisma.job.findMany({
      where: { companyId: ctx.company.id, status: { not: "CANCELED" }, ...access },
      select: { id: true, jobNumber: true, customer: { select: { firstName: true, lastName: true } } },
      orderBy: { updatedAt: "desc" },
      take: 80,
    }),
    prisma.vehicle.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const dollars = (cents: number | null | undefined) =>
    cents != null ? (cents / 100).toFixed(2) : "";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/receipts" className="text-sm text-[var(--muted-foreground)]">
          ← Receipts
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl tracking-tight">Review receipt</h1>
          <StatusBadge status={receipt.processingStatus} />
          {receipt.duplicateStatus === "POSSIBLE" ? <StatusBadge status="POSSIBLE DUPLICATE" /> : null}
        </div>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Suggestions are a starting point. Confirm only after the numbers look right.
        </p>
      </div>

      {receipt.duplicateStatus === "POSSIBLE" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          This looks like a receipt you already have
          {receipt.duplicateOf ? (
            <>
              {" "}
              (
              <Link href={`/receipts/${receipt.duplicateOf.id}`} className="underline">
                {receipt.duplicateOf.vendor || receipt.duplicateOf.fileName}
              </Link>
              )
            </>
          ) : null}
          . We did not delete or merge anything.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
          {receipt.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/receipts/${receipt.id}`}
              alt={receipt.vendor || "Receipt"}
              className="max-h-[70vh] w-full object-contain bg-slate-50"
            />
          ) : (
            <div className="p-6 text-sm">
              <p>PDF receipt</p>
              <Link href={`/api/receipts/${receipt.id}`} className="mt-2 inline-block underline">
                Open file
              </Link>
            </div>
          )}
        </div>

        <ActionForm action={reviewReceiptAction} successMessage="Receipt saved." className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-5">
          <input type="hidden" name="receiptId" value={receipt.id} />
          <div className="space-y-1.5">
            <Label htmlFor="vendor">Vendor</Label>
            <Input id="vendor" name="vendor" defaultValue={receipt.vendor ?? ""} className="h-11 text-base" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={receipt.receiptDate ? receipt.receiptDate.toISOString().slice(0, 10) : ""}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="total">Total ($)</Label>
              <Input id="total" name="total" type="number" min="0.01" step="0.01" required defaultValue={dollars(receipt.totalCents)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subtotal">Subtotal ($)</Label>
              <Input id="subtotal" name="subtotal" type="number" min="0" step="0.01" defaultValue={dollars(receipt.subtotalCents)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax">Tax ($)</Label>
              <Input id="tax" name="tax" type="number" min="0" step="0.01" defaultValue={dollars(receipt.extractedTaxCents)} className="h-11" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              name="category"
              className="h-11 w-full rounded-lg border border-input px-3 text-base"
              defaultValue={receipt.category ?? "OTHER"}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assignment">Assign this receipt</Label>
            <select
              id="assignment"
              name="assignment"
              className="h-11 w-full rounded-lg border border-input px-3 text-base"
              defaultValue={receipt.assignment}
            >
              {ASSIGNMENTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="jobId">Job</Label>
            <select id="jobId" name="jobId" className="h-11 w-full rounded-lg border border-input px-3 text-base" defaultValue={receipt.jobId ?? ""}>
              <option value="">Choose a job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobNumber} · {job.customer.firstName} {job.customer.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vehicleId">Truck</Label>
            <select id="vehicleId" name="vehicleId" className="h-11 w-full rounded-lg border border-input px-3 text-base" defaultValue={receipt.vehicleId ?? ""}>
              <option value="">Choose a truck</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
                  {vehicle.unitNumber ? ` · ${vehicle.unitNumber}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={receipt.description ?? ""} rows={3} />
          </div>
          {receipt.confidence != null ? (
            <p className="text-xs text-[var(--muted-foreground)]">Read confidence: {receipt.confidence}%</p>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">
              Automatic reading was not available. Enter the numbers from the receipt.
            </p>
          )}
          {receipt.duplicateStatus === "POSSIBLE" ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ignoreDuplicate" value="yes" />
              This is not a duplicate
            </label>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="submit" name="confirm" value="" variant="outline" className="h-12">
              Save for later
            </Button>
            <Button type="submit" name="confirm" value="yes" className="h-12">
              Confirm receipt
            </Button>
          </div>
          {receipt.expense ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Linked expense {formatMoney(receipt.expense.amountCents)}. Confirming again updates that record.
            </p>
          ) : null}
        </ActionForm>
      </div>

      <ActionForm action={createVehicleAction} successMessage="Truck added." className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Add a truck</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Truck 3" required className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unitNumber">Unit #</Label>
            <Input id="unitNumber" name="unitNumber" className="h-11" />
          </div>
        </div>
        <Button type="submit" variant="outline">
          Add truck
        </Button>
      </ActionForm>
    </div>
  );
}
