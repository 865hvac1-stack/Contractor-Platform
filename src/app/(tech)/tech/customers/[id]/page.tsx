import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { jobAccessFilter, requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { getCustomer360 } from "@/lib/customers/workspace";
import { Customer360View } from "@/components/customers/customer-360-view";

export const dynamic = "force-dynamic";

export default async function TechCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const ctx = await requirePermission("customers:view");
  const { id } = await params;
  const query = await searchParams;
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const allowed = await prisma.customer.findFirst({
    where: {
      id,
      companyId: ctx.company.id,
      ...(access.assignments ? { jobs: { some: { companyId: ctx.company.id, ...access } } } : {}),
    },
    select: { id: true },
  });
  if (!allowed) notFound();

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
      backHref="/tech/customers"
      backLabel="Customers"
      canManage={false}
      canJob={false}
      canPay={false}
      canAsk={can(ctx.role, "intelligence:view")}
      jobBase="/tech/jobs"
      selfHref={`/tech/customers/${workspace.customer.id}`}
    />
  );
}
