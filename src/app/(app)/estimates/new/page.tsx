import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { createEstimateAction } from "@/server/actions/billing";
import { ActionForm } from "@/components/action-form";
import { LineItemsEditor } from "@/components/line-items-editor";
import { IsoDateField } from "@/components/iso-date-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default async function NewEstimatePage() {
  const ctx = await requirePermission("estimates:manage");
  const [customers, jobs] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: ctx.company.id, status: { not: "ARCHIVED" } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.job.findMany({
      where: { companyId: ctx.company.id, status: { not: "CANCELED" } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">New estimate</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Add at least one line item. Prices are dollars; stored as integer cents.
          </p>
        </div>
        <Link href="/estimates" className={cn(buttonVariants({ variant: "outline" }))}>
          Cancel
        </Link>
      </div>

      {customers.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] bg-white p-4 text-sm text-[var(--muted-foreground)]">
          Add a customer before creating an estimate.
        </p>
      ) : (
        <ActionForm
          action={createEstimateAction}
          className="space-y-6 rounded-xl border border-[var(--border)] bg-white p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="customerId">Customer</Label>
              <select
                id="customerId"
                name="customerId"
                required
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.lastName}, {c.firstName}
                    {c.businessName ? ` (${c.businessName})` : ""}
                  </option>
                ))}
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
            <IsoDateField name="expirationDate" label="Expiration date" />
            <div className="space-y-1.5">
              <Label htmlFor="tax">Tax ($)</Label>
              <Input id="tax" name="tax" type="number" min="0" step="0.01" defaultValue="0" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>
          </div>

          <LineItemsEditor showCost />

          <Button type="submit">Create estimate</Button>
        </ActionForm>
      )}
    </div>
  );
}
