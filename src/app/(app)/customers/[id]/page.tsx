import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/tenant";
import { getCustomer360 } from "@/lib/customers/workspace";
import { Customer360View } from "@/components/customers/customer-360-view";
import { CustomerRecordEditor } from "@/components/customers/customer-record-editor";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const ctx = await requirePermission("customers:view");
  const { id } = await params;
  const query = await searchParams;
  const workspace = await getCustomer360({
    companyId: ctx.company.id,
    customerId: id,
    propertyId: query.propertyId,
    role: ctx.role,
    userId: ctx.user.id,
  });
  if (!workspace) notFound();

  return (
    <div className="space-y-8">
      <Customer360View
        workspace={workspace}
        role={ctx.role}
        backHref="/customers"
        backLabel="Customers"
        canManage={can(ctx.role, "customers:manage")}
        canJob={can(ctx.role, "jobs:manage")}
        canPay={workspace.canSeeMoney}
        canAsk={can(ctx.role, "intelligence:view")}
        jobBase="/jobs"
        selfHref={`/customers/${workspace.customer.id}`}
      />
      {can(ctx.role, "customers:manage") ? (
        <CustomerRecordEditor
          customerId={workspace.customer.id}
          firstName={workspace.customer.firstName}
          lastName={workspace.customer.lastName}
          phone={workspace.customer.phone}
          email={workspace.customer.email}
          preferredContactMethod={workspace.customer.preferredContactMethod}
        />
      ) : null}
    </div>
  );
}
