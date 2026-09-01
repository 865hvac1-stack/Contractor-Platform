import Link from "next/link";
import { redirect } from "next/navigation";
import { NewJobForm } from "@/components/jobs/new-job-form";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { ensureCompanyServiceTypes, listActiveServiceTypes } from "@/lib/trades/service-types";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";
import { customerLabel } from "@/lib/tech/today";

export default async function OfficeNewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; propertyId?: string }>;
}) {
  const ctx = await requirePermission("jobs:manage");
  if (!canAccessWorkspace(ctx.role, "office")) {
    redirect(landingPath(ctx.role));
  }
  const { customerId, propertyId } = await searchParams;

  await ensureCompanyServiceTypes(prisma, ctx.company.id, ctx.company.industry);
  const [customerCount, selectedCustomer, memberships, playbooks, serviceTypes] = await Promise.all([
    prisma.customer.count({
      where: { companyId: ctx.company.id, status: { not: "ARCHIVED" } },
    }),
    customerId
      ? prisma.customer.findFirst({
          where: { id: customerId, companyId: ctx.company.id, status: { not: "ARCHIVED" } },
          include: {
            properties: { orderBy: [{ isPrimary: "desc" }, { address: "asc" }] },
          },
        })
      : Promise.resolve(null),
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
    listActiveServiceTypes(prisma, ctx.company.id),
  ]);

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
          Type a first or last name to find the customer. Leave the technician blank to send it to Dispatch.
        </p>
      </div>
      {customerCount === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Add a <Link href="/office/customers/new" className="underline">customer</Link> first.
        </p>
      ) : (
        <div className="rounded-2xl border bg-white p-5">
          <NewJobForm
            defaultCustomer={
              selectedCustomer
                ? {
                    id: selectedCustomer.id,
                    name: customerLabel(selectedCustomer),
                    phone: selectedCustomer.phone,
                    properties: selectedCustomer.properties.map((property) => ({
                      id: property.id,
                      label: `${property.address}, ${property.city}${property.name ? ` (${property.name})` : ""}`,
                    })),
                  }
                : null
            }
            defaultPropertyId={propertyId}
            returnTo="office"
            canAssign={can(ctx.role, "schedule:manage")}
            submitLabel={
              can(ctx.role, "schedule:manage") ? "Create job" : "Create and send to Dispatch"
            }
            members={memberships.map((member) => ({
              id: member.user.id,
              label: `${member.user.firstName} ${member.user.lastName}`,
            }))}
            playbooks={playbooks.map((playbook) => ({ id: playbook.id, label: playbook.name }))}
            serviceTypes={serviceTypes}
          />
        </div>
      )}
    </div>
  );
}
