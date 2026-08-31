import Link from "next/link";
import { notFound } from "next/navigation";
import type { EstimateStatus } from "@prisma/client";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney, lineTotalCents } from "@/lib/money";
import { optionTotals } from "@/lib/estimates/totals";
import { updateEstimateStatusAction } from "@/server/actions/billing";
import { createEstimateOptionAction, presentEstimateAction } from "@/server/actions/estimate-options";
import { sellMembershipAction } from "@/server/actions/memberships";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";

const STATUS_ACTIONS: { status: EstimateStatus; label: string }[] = [
  { status: "SENT", label: "Mark sent" },
  { status: "VIEWED", label: "Mark viewed" },
  { status: "APPROVED", label: "Approve" },
  { status: "DECLINED", label: "Decline" },
  { status: "EXPIRED", label: "Mark expired" },
  { status: "CANCELED", label: "Cancel" },
];

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("estimates:view");
  const estimate = await prisma.estimate.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      customer: true,
      property: true,
      job: true,
      lineItems: { orderBy: { sortOrder: "asc" } },
      options: { orderBy: { sortOrder: "asc" }, include: { lineItems: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!estimate) notFound();
  const canManage = can(ctx.role, "estimates:manage");
  const plans = can(ctx.role, "memberships:manage")
    ? await prisma.membershipPlan.findMany({
        where: { companyId: ctx.company.id, active: true },
        orderBy: { name: "asc" },
      })
    : [];
  const presentUrl = estimate.publicToken ? `/e/${estimate.publicToken}` : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/estimates" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            ← Estimates
          </Link>
          <h1 className="mt-2 font-display text-3xl tracking-tight">{estimate.estimateNumber}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {estimate.customer.firstName} {estimate.customer.lastName}
            {estimate.job ? ` · Job ${estimate.job.jobNumber}` : ""}
            {estimate.approvalMethod ? ` · Approved via ${estimate.approvalMethod.replaceAll("_", " ")}` : ""}
          </p>
        </div>
        <StatusBadge status={estimate.status} className="text-sm" />
      </div>

      <div className="flex flex-wrap gap-2">
        {canManage ? (
          <Link
            href={`/estimates/${estimate.id}/pricebook`}
            className={cn(buttonVariants())}
          >
            Open Pricebook
          </Link>
        ) : null}
        {canManage ? (
          <form
            action={async () => {
              "use server";
              await presentEstimateAction(id);
            }}
          >
            <Button type="submit" variant="outline">
              Present to customer
            </Button>
          </form>
        ) : null}
        {presentUrl ? (
          <Link href={presentUrl} className={cn(buttonVariants({ variant: "outline" }))} target="_blank">
            Customer view
          </Link>
        ) : null}
        {estimate.jobId ? (
          <Link href={`/jobs/${estimate.jobId}`} className={cn(buttonVariants({ variant: "ghost" }))}>
            Job
          </Link>
        ) : null}
      </div>

      {estimate.options.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {estimate.options.map((option) => {
            const totals = optionTotals(option.lineItems);
            const approved = estimate.approvedOptionId === option.id;
            return (
              <div
                key={option.id}
                className={`rounded-xl border bg-white p-4 ${
                  approved ? "border-[var(--cy-orange)]" : "border-[var(--border)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{option.name}</p>
                    {option.description ? (
                      <p className="text-sm text-[var(--muted-foreground)]">{option.description}</p>
                    ) : null}
                  </div>
                  {approved ? <StatusBadge status="APPROVED" /> : null}
                </div>
                <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(totals.totalCents)}</p>
                <ul className="mt-3 space-y-1 text-sm">
                  {option.lineItems.length === 0 ? (
                    <li className="text-[var(--muted-foreground)]">No items yet.</li>
                  ) : (
                    option.lineItems.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3">
                        <span>{item.name}</span>
                        <span className="tabular-nums">
                          {formatMoney(lineTotalCents(Number(item.quantity), item.unitPriceCents))}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
                {canManage && estimate.status !== "APPROVED" ? (
                  <Link
                    href={`/estimates/${estimate.id}/pricebook?optionId=${option.id}`}
                    className="mt-3 inline-block text-sm font-medium text-[var(--cy-orange)]"
                  >
                    Add from Pricebook
                  </Link>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          {estimate.lineItems.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No line items yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {estimate.lineItems.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span>{item.name}</span>
                  <span className="tabular-nums">
                    {formatMoney(lineTotalCents(Number(item.quantity), item.unitPriceCents))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Subtotal</p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(estimate.subtotalCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Tax</p>
          <p className="mt-1 text-xl tabular-nums">{formatMoney(estimate.taxCents)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Total</p>
          <p className="mt-1 text-xl font-medium tabular-nums">{formatMoney(estimate.totalCents)}</p>
        </div>
      </div>

      {canManage && estimate.status !== "APPROVED" ? (
        <ActionForm
          action={createEstimateOptionAction}
          successMessage="Option added."
          className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-white p-4"
        >
          <input type="hidden" name="estimateId" value={estimate.id} />
          <Input name="name" placeholder="Option name (Repair, Replace…)" required className="max-w-xs" />
          <Input name="description" placeholder="Customer-facing explanation" className="max-w-sm" />
          <Button type="submit" size="sm">
            Add option
          </Button>
        </ActionForm>
      ) : null}

      {can(ctx.role, "memberships:manage") && plans.length > 0 ? (
        <ActionForm
          action={sellMembershipAction}
          successMessage="Membership recorded."
          className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
        >
          <h2 className="font-medium">Sell a membership</h2>
          <input type="hidden" name="customerId" value={estimate.customerId} />
          <input type="hidden" name="estimateId" value={estimate.id} />
          {estimate.jobId ? <input type="hidden" name="jobId" value={estimate.jobId} /> : null}
          <select name="planId" required className="h-8 max-w-sm rounded-lg border border-input px-2.5 text-sm">
            <option value="">Choose a plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {formatMoney(plan.priceCents)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="activate" value="true" />
            Activate now
          </label>
          <Button type="submit" size="sm">
            Record membership
          </Button>
        </ActionForm>
      ) : null}

      {estimate.notes ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Internal notes</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{estimate.notes}</p>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <p className="mb-3 text-sm font-medium">Update status</p>
        <div className="flex flex-wrap gap-2">
          {STATUS_ACTIONS.filter((action) => action.status !== estimate.status).map((action) => (
            <form
              key={action.status}
              action={async () => {
                "use server";
                await updateEstimateStatusAction(id, action.status);
              }}
            >
              <Button type="submit" variant={action.status === "APPROVED" ? "default" : "outline"} size="sm">
                {action.label}
              </Button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
