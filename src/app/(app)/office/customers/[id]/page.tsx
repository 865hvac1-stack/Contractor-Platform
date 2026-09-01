import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/tenant";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";
import { getCustomer360 } from "@/lib/customers/workspace";
import { Customer360View } from "@/components/customers/customer-360-view";

export const dynamic = "force-dynamic";

export default async function OfficeCustomer360Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const ctx = await requirePermission("customers:view");
  if (!canAccessWorkspace(ctx.role, "office")) {
    redirect(landingPath(ctx.role));
  }
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
    <Customer360View
      workspace={workspace}
      role={ctx.role}
      backHref="/office"
      backLabel="Customer Hub"
      canManage={can(ctx.role, "customers:manage")}
      canJob={can(ctx.role, "jobs:manage")}
      canPay={workspace.canSeeMoney}
      canAsk={can(ctx.role, "intelligence:view")}
      jobBase="/jobs"
      selfHref={`/office/customers/${workspace.customer.id}`}
      newJobHref={`/office/jobs/new?customerId=${workspace.customer.id}${
        workspace.selectedProperty ? `&propertyId=${workspace.selectedProperty.id}` : ""
      }`}
    />
  );
}
