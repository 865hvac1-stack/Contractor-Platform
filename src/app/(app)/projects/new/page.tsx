import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { customerLabel } from "@/lib/tech/today";
import { ProjectCreateForm } from "@/components/projects/project-create-form";

export default async function NewProjectPage() {
  const ctx = await requirePermission("projects:manage");
  const [customers, members] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: ctx.company.id, status: { not: "ARCHIVED" }, properties: { some: {} } },
      include: { properties: { orderBy: [{ isPrimary: "desc" }, { address: "asc" }] } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 500,
    }),
    prisma.membership.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE", role: { in: ["COMPANY_OWNER", "ADMIN", "MANAGER", "OFFICE"] } },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-[var(--muted-foreground)] hover:underline">← Projects</Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">New Project</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Start the long-running project record. Visits will use Jobs & Dispatch.</p>
      </div>
      {customers.length ? (
        <ProjectCreateForm
          customers={customers.map((customer) => ({ id: customer.id, label: customerLabel(customer), phone: customer.phone, properties: customer.properties.map((property) => ({ id: property.id, label: `${property.address}, ${property.city}, ${property.state} ${property.zip}` })) }))}
          managers={members.map((membership) => ({ id: membership.userId, label: `${membership.user.firstName} ${membership.user.lastName} · ${membership.role.replaceAll("_", " ")}` }))}
        />
      ) : (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center"><p className="font-semibold">Add a customer and property first.</p><Link href="/customers/new" className="mt-3 inline-block text-[var(--cy-orange)] underline">Create customer</Link></div>
      )}
    </div>
  );
}
