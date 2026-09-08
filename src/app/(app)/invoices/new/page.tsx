import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { createInvoiceAction } from "@/server/actions/billing";
import { ActionForm } from "@/components/action-form";
import { LineItemsEditor } from "@/components/line-items-editor";
import { ServiceTypePicker } from "@/components/service-type-picker";
import { CustomerJobFields } from "@/components/customers/customer-job-fields";
import { ensureCompanyServiceTypes, listActiveServiceTypes } from "@/lib/trades/service-types";
import { IsoDateField } from "@/components/iso-date-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { customerLabel } from "@/lib/tech/today";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const ctx = await requirePermission("invoices:manage");
  const { customerId } = await searchParams;
  await ensureCompanyServiceTypes(prisma, ctx.company.id, ctx.company.industry);
  const [selectedCustomer, serviceTypes] = await Promise.all([
    customerId
      ? prisma.customer.findFirst({
          where: { id: customerId, companyId: ctx.company.id, status: { not: "ARCHIVED" } },
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
      : Promise.resolve(null),
    listActiveServiceTypes(prisma, ctx.company.id),
  ]);
  const canCreateCustomer = can(ctx.role, "customers:manage");
  const property = selectedCustomer?.properties[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">New invoice</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Choose a service type, add what you are charging, then save.
          </p>
        </div>
        <Link href="/invoices" className={cn(buttonVariants({ variant: "outline" }))}>
          Cancel
        </Link>
      </div>

      <ActionForm
        action={createInvoiceAction}
        className="space-y-6 rounded-xl border border-[var(--border)] bg-white p-6"
      >
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
              createHref="/customers/new?returnTo=/invoices/new"
            />
          </div>
          <IsoDateField name="dueDate" label="Due date" />
          <div className="space-y-1.5">
            <Label htmlFor="tax">Tax ($)</Label>
            <Input id="tax" name="tax" type="number" min="0" step="0.01" defaultValue="0" />
          </div>
          <div className="sm:col-span-2">
            <ServiceTypePicker
              types={serviceTypes}
              descriptionName="notes"
              descriptionLabel="Description"
              writingAssist
              jobFieldId="jobId"
            />
          </div>
        </div>

        <LineItemsEditor />

        <Button type="submit">Create invoice</Button>
      </ActionForm>
    </div>
  );
}
