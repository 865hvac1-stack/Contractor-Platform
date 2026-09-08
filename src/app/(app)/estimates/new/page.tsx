import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { createEstimateAction } from "@/server/actions/billing";
import { ActionForm } from "@/components/action-form";
import { LineItemsEditor } from "@/components/line-items-editor";
import { CustomerJobFields } from "@/components/customers/customer-job-fields";
import { IsoDateField } from "@/components/iso-date-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { customerLabel } from "@/lib/tech/today";

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; leadId?: string }>;
}) {
  const ctx = await requirePermission("estimates:manage");
  const { customerId, leadId } = await searchParams;
  const lead = leadId
    ? await prisma.lead.findFirst({
        where: { id: leadId, companyId: ctx.company.id },
        select: { id: true, customerId: true, firstName: true, lastName: true },
      })
    : null;
  const customerFromLead = !customerId && lead?.customerId ? lead.customerId : customerId;
  const selectedCustomer = customerFromLead
    ? await prisma.customer.findFirst({
        where: { id: customerFromLead, companyId: ctx.company.id, status: { not: "ARCHIVED" } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true,
          email: true,
          properties: {
            take: 1,
            orderBy: [{ isPrimary: "desc" }, { address: "asc" }],
            select: { address: true, city: true, state: true },
          },
        },
      })
    : null;
  const canCreateCustomer = can(ctx.role, "customers:manage");
  const property = selectedCustomer?.properties[0];

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

      <ActionForm
        action={createEstimateAction}
        className="space-y-6 rounded-xl border border-[var(--border)] bg-white p-6"
      >
        {lead ? <input type="hidden" name="leadId" value={lead.id} /> : null}
        {lead && !selectedCustomer ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Creating an estimate from lead {lead.firstName} {lead.lastName}. Choose or create a
            customer first.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <CustomerJobFields
              defaultCustomer={
                selectedCustomer
                  ? {
                      id: selectedCustomer.id,
                      name: customerLabel(selectedCustomer),
                      phone: selectedCustomer.phone,
                      email: selectedCustomer.email,
                      address: property
                        ? `${property.address}, ${property.city}${property.state ? ` ${property.state}` : ""}`
                        : null,
                    }
                  : null
              }
              canCreateCustomer={canCreateCustomer}
              createHref="/customers/new?returnTo=/estimates/new"
            />
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
    </div>
  );
}
