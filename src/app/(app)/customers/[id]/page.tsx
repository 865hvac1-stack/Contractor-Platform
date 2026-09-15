import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/tenant";
import { getCustomer360 } from "@/lib/customers/workspace";
import { Customer360View } from "@/components/customers/customer-360-view";
import { prisma } from "@/lib/db";
import { projectAccessFilter, friendlyProject } from "@/lib/projects/core";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";

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
  const projects = can(ctx.role, "projects:view")
    ? await prisma.project.findMany({
        where: { companyId: ctx.company.id, customerId: id, ...projectAccessFilter(ctx.role, ctx.user.id) },
        include: { property: true },
        orderBy: { updatedAt: "desc" },
        take: 20,
      })
    : [];

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
        timeZone={ctx.company.timezone}
      />
      {projects.length ? (
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Projects</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {projects.map((project) => <Link key={project.id} href={`/projects/${project.id}`} className="rounded-xl border p-3 hover:bg-[var(--cy-gray)]"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{project.name}</p><p className="text-xs text-[var(--muted-foreground)]">{project.projectNumber} · {friendlyProject(project.type)} · {project.property.address}</p></div><StatusBadge status={project.status} /></div></Link>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}
