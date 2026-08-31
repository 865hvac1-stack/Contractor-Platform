import Link from "next/link";
import { redirect } from "next/navigation";
import { NewJobForm } from "@/components/jobs/new-job-form";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";

export default async function OfficeNewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const ctx = await requirePermission("jobs:manage");
  if (!canAccessWorkspace(ctx.role, "office")) {
    redirect(landingPath(ctx.role));
  }
  const { customerId } = await searchParams;

  const [customers, properties, memberships, playbooks] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: ctx.company.id, status: { not: "ARCHIVED" } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 400,
    }),
    prisma.property.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { address: "asc" },
    }),
    prisma.membership.findMany({
      where: {
        companyId: ctx.company.id,
        status: "ACTIVE",
        role: { in: ["TECHNICIAN", "INSTALLER"] },
      },
      include: { user: true },
    }),
    prisma.playbook.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const defaultCustomerId =
    customerId && customers.some((customer) => customer.id === customerId) ? customerId : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/office" className="text-sm text-[var(--muted-foreground)]">
          ← Customer Hub
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
          New job
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Leave the technician blank to send it to Dispatch. One job record — no duplicate lead.
        </p>
      </div>
      {customers.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Add a <Link href="/office/customers/new" className="underline">customer</Link> first.
        </p>
      ) : (
        <div className="rounded-2xl border bg-white p-5">
          <NewJobForm
            defaultCustomerId={defaultCustomerId}
            returnTo="office"
            canAssign={can(ctx.role, "schedule:manage")}
            submitLabel={
              can(ctx.role, "schedule:manage") ? "Create job" : "Create and send to Dispatch"
            }
            customers={customers.map((customer) => ({
              id: customer.id,
              label: customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim(),
            }))}
            properties={properties.map((property) => ({
              id: property.id,
              customerId: property.customerId,
              label: `${property.address}, ${property.city}`,
            }))}
            members={memberships.map((member) => ({
              id: member.user.id,
              label: `${member.user.firstName} ${member.user.lastName}`,
            }))}
            playbooks={playbooks.map((playbook) => ({ id: playbook.id, label: playbook.name }))}
          />
        </div>
      )}
    </div>
  );
}
