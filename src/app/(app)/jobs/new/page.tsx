import Link from "next/link";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { NewJobForm } from "@/components/jobs/new-job-form";
import { ensureCompanyServiceTypes, listActiveServiceTypes } from "@/lib/trades/service-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { customerLabel } from "@/lib/tech/today";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; returnTo?: string }>;
}) {
  const ctx = await requirePermission("jobs:manage");
  const { customerId, returnTo } = await searchParams;

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
      where: { companyId: ctx.company.id, status: "ACTIVE" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
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
        <Link
          href="/jobs"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Jobs
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">New job</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Type a first or last name to find the customer, then schedule when you&apos;re ready.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job details</CardTitle>
        </CardHeader>
        <CardContent>
          {customerCount === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Add a{" "}
              <Link href="/customers/new" className="underline">
                customer
              </Link>{" "}
              before creating a job.
            </p>
          ) : (
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
              returnTo={returnTo === "dispatch" || returnTo === "office" ? returnTo : undefined}
              canAssign={can(ctx.role, "schedule:manage")}
              submitLabel={returnTo === "dispatch" || returnTo === "office" ? "Create and send to Dispatch" : "Create job"}
              members={memberships.map((m) => ({
                id: m.user.id,
                label: `${m.user.firstName} ${m.user.lastName} · ${m.role.replaceAll("_", " ")}`,
              }))}
              playbooks={playbooks.map((p) => ({ id: p.id, label: p.name }))}
              serviceTypes={serviceTypes}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
