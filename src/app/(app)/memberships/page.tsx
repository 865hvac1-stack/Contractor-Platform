import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import {
  createMembershipPlanAction,
  sellMembershipAction,
  updateMembershipStatusAction,
} from "@/server/actions/memberships";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function MembershipsPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const ctx = await requirePermission("memberships:view");
  const canManage = can(ctx.role, "memberships:manage");
  const { customerId } = await searchParams;
  const [plans, memberships, customers] = await Promise.all([
    prisma.membershipPlan.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { name: "asc" },
    }),
    prisma.customerMembership.findMany({
      where: { companyId: ctx.company.id, ...(customerId ? { customerId } : {}) },
      include: {
        customer: true,
        plan: true,
        soldBy: { select: { firstName: true, lastName: true } },
        job: { select: { jobNumber: true } },
      },
      orderBy: { saleDate: "desc" },
      take: 100,
    }),
    prisma.customer.findMany({
      where: { companyId: ctx.company.id, status: { not: "ARCHIVED" } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Memberships</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Service agreements are real records — not just a Pricebook line. Recurring billing is not configured.
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Recurring billing is not configured. Annual and manual memberships can still be tracked and activated.
      </div>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm
            action={createMembershipPlanAction}
            successMessage="Plan saved."
            className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
          >
            <h2 className="font-medium">New membership plan</h2>
            <Input name="name" placeholder="Plan name" required />
            <Input name="description" placeholder="Description" />
            <Input name="price" type="number" min="0" step="0.01" placeholder="Price" required />
            <select name="billingFrequency" className="h-8 w-full rounded-lg border border-input px-2.5 text-sm">
              <option value="ANNUAL">Annual</option>
              <option value="MONTHLY">Monthly</option>
            </select>
            <Input name="includedVisits" type="number" min="0" placeholder="Included visits (optional)" />
            <Input name="discountPercent" type="number" min="0" max="100" placeholder="Discount %" />
            <Input name="benefits" placeholder="Benefits" />
            <Input name="terms" placeholder="Terms" />
            <Button type="submit" size="sm">
              Save plan
            </Button>
          </ActionForm>
          <ActionForm
            action={sellMembershipAction}
            successMessage="Membership recorded."
            className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
          >
            <h2 className="font-medium">Record a membership sale</h2>
            <select name="customerId" required className="h-8 w-full rounded-lg border border-input px-2.5 text-sm">
              <option value="">Customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.lastName}, {customer.firstName}
                </option>
              ))}
            </select>
            <select name="planId" required className="h-8 w-full rounded-lg border border-input px-2.5 text-sm">
              <option value="">Plan</option>
              {plans
                .filter((plan) => plan.active)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {formatMoney(plan.priceCents)}
                  </option>
                ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="activate" value="true" />
              Activate now (manual / annual)
            </label>
            <Button type="submit" size="sm">
              Record sale
            </Button>
          </ActionForm>
        </div>
      ) : null}

      {plans.length === 0 ? (
        <EmptyState
          title="No memberships sold yet."
          description="Create a plan first. Plans are not seeded. Recurring card billing is not configured."
        />
      ) : (
        <section className="space-y-3">
          <h2 className="font-medium">Plans</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {plans.map((plan) => (
              <li key={plan.id} className="rounded-xl border border-[var(--border)] bg-white p-4">
                <p className="font-medium">{plan.name}</p>
                <p className="text-sm text-[var(--muted-foreground)]">{plan.description || "No description"}</p>
                <p className="mt-2 tabular-nums">{formatMoney(plan.priceCents)} · {plan.billingFrequency}</p>
                {plan.includedVisits != null ? (
                  <p className="text-sm text-[var(--muted-foreground)]">{plan.includedVisits} included visits</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Sold memberships</h2>
          {customerId ? (
            <Link href="/memberships" className="text-sm text-[var(--cy-orange)] hover:underline">
              All memberships
            </Link>
          ) : null}
        </div>
        {memberships.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No memberships sold yet.</p>
        ) : (
          <ul className="space-y-2">
            {memberships.map((row) => (
              <li key={row.id} className="rounded-xl border border-[var(--border)] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      <Link href={`/customers/${row.customerId}`} className="hover:underline">
                        {row.customer.firstName} {row.customer.lastName}
                      </Link>
                    </p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {row.plan.name} · {formatMoney(row.priceCents)}
                      {row.soldBy ? ` · Sold by ${row.soldBy.firstName} ${row.soldBy.lastName}` : ""}
                      {row.job ? ` · ${row.job.jobNumber}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                {canManage && row.status === "PENDING" ? (
                  <form
                    className="mt-3"
                    action={async () => {
                      "use server";
                      await updateMembershipStatusAction(row.id, "ACTIVE");
                    }}
                  >
                    <Button type="submit" size="sm" variant="outline">
                      Activate
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
