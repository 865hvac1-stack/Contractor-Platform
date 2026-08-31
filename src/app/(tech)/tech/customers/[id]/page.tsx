import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { customerLabel } from "@/lib/tech/today";

export default async function TechCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("customers:view");
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const customer = await prisma.customer.findFirst({
    where: {
      id,
      companyId: ctx.company.id,
      ...(access.assignments ? { jobs: { some: { companyId: ctx.company.id, ...access } } } : {}),
    },
    include: {
      properties: { take: 3 },
      jobs: { orderBy: { createdAt: "desc" }, take: 8, select: { id: true, jobType: true, status: true, createdAt: true } },
      customerMemberships: { include: { plan: true }, take: 1 },
    },
  });
  if (!customer) notFound();

  return (
    <div className="space-y-4">
      <Link href="/tech/customers" className="text-xs text-[var(--muted-foreground)]">
        ← Customers
      </Link>
      <h1 className="font-display text-2xl tracking-tight">{customerLabel(customer)}</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        {customer.phone ?? "No phone"} · {customer.email ?? "No email"}
      </p>
      {customer.customerMemberships[0] ? (
        <p className="text-sm text-emerald-800">
          {customer.customerMemberships[0].plan.name} · {customer.customerMemberships[0].status}
        </p>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No membership on this property.</p>
      )}
      <h2 className="text-sm font-semibold">Previous jobs</h2>
      {customer.jobs.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No previous service history.</p>
      ) : (
        <ul className="space-y-2">
          {customer.jobs.map((job) => (
            <li key={job.id} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm">
              {job.jobType || "Job"} · {job.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
