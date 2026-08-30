import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { NewJobForm } from "@/components/jobs/new-job-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const ctx = await requirePermission("jobs:manage");
  const { customerId } = await searchParams;

  const [customers, properties, memberships, playbooks] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: ctx.company.id, status: { not: "ARCHIVED" } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.property.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { address: "asc" },
    }),
    prisma.membership.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.playbook.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const defaultCustomerId =
    customerId && customers.some((c) => c.id === customerId) ? customerId : undefined;

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
          Link a customer and property, then schedule when you&apos;re ready.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job details</CardTitle>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Add a{" "}
              <Link href="/customers/new" className="underline">
                customer
              </Link>{" "}
              before creating a job.
            </p>
          ) : (
            <NewJobForm
              defaultCustomerId={defaultCustomerId}
              customers={customers.map((c) => ({
                id: c.id,
                label:
                  c.businessName?.trim() ||
                  `${c.firstName} ${c.lastName}`.trim(),
              }))}
              properties={properties.map((p) => ({
                id: p.id,
                customerId: p.customerId,
                label: `${p.address}, ${p.city}${p.name ? ` (${p.name})` : ""}`,
              }))}
              members={memberships.map((m) => ({
                id: m.user.id,
                label: `${m.user.firstName} ${m.user.lastName} · ${m.role.replaceAll("_", " ")}`,
              }))}
              playbooks={playbooks.map((p) => ({ id: p.id, label: p.name }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
