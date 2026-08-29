import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { createExpenseAction } from "@/server/actions/expenses";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "MATERIALS",
  "EQUIPMENT",
  "FUEL",
  "SUBCONTRACTOR",
  "PERMITS",
  "TOOLS",
  "VEHICLE",
  "OFFICE",
  "ADVERTISING",
  "INSURANCE",
  "OTHER",
] as const;

export default async function NewExpensePage() {
  const ctx = await requirePermission("expenses:manage");
  const jobs = await prisma.job.findMany({
    where: { companyId: ctx.company.id, status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">New expense</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Amounts in dollars; stored as cents. Receipts stay uploaded — no automatic extraction.
          </p>
        </div>
        <Link href="/expenses" className={cn(buttonVariants({ variant: "outline" }))}>
          Cancel
        </Link>
      </div>

      <ActionForm
        action={createExpenseAction}
        className="space-y-4 rounded-xl border border-[var(--border)] bg-white p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" required defaultValue={today} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount ($)</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              required
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax">Tax ($)</Label>
            <Input id="tax" name="tax" type="number" min="0" step="0.01" defaultValue="0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              name="category"
              required
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              defaultValue="OTHER"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Input id="vendor" name="vendor" placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paymentMethod">Payment method</Label>
            <select
              id="paymentMethod"
              name="paymentMethod"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              defaultValue=""
            >
              <option value="">None</option>
              <option value="CASH">Cash</option>
              <option value="CHECK">Check</option>
              <option value="CREDIT_CARD">Credit card</option>
              <option value="ACH">ACH</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="jobId">Job (optional)</Label>
            <select
              id="jobId"
              name="jobId"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              defaultValue=""
            >
              <option value="">None</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.jobNumber}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={3} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="receipt">Receipt file</Label>
            <Input
              id="receipt"
              name="receipt"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              JPEG, PNG, WebP, or PDF up to 10MB. Stored as uploaded — no AI extraction.
            </p>
          </div>
          <input type="hidden" name="status" value="SUBMITTED" />
        </div>
        <Button type="submit">Save expense</Button>
      </ActionForm>
    </div>
  );
}
