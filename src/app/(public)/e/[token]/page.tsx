import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, lineTotalCents } from "@/lib/money";
import { optionTotals, membershipSavingsCents } from "@/lib/estimates/totals";
import { publicApproveEstimateAction } from "@/server/actions/public-billing";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const estimate = await prisma.estimate.findFirst({
    where: { publicToken: token },
    include: {
      company: true,
      customer: true,
      property: true,
      job: { select: { jobNumber: true } },
      options: { orderBy: { sortOrder: "asc" }, include: { lineItems: { orderBy: { sortOrder: "asc" } } } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!estimate) notFound();

  const groups =
    estimate.options.length > 0
      ? estimate.options.map((option) => ({
          id: option.id,
          name: option.name,
          description: option.description,
          items: option.lineItems,
          totals: optionTotals(option.lineItems),
          savings: membershipSavingsCents(
            option.lineItems.map((item) => ({
              standardPriceCents: item.unitPriceCents,
              unitPriceCents: item.unitPriceCents,
              quantity: item.quantity,
            }))
          ),
        }))
      : [
          {
            id: "",
            name: "Proposed work",
            description: null,
            items: estimate.lineItems,
            totals: optionTotals(estimate.lineItems),
            savings: 0,
          },
        ];

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          {estimate.company.businessName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Estimate {estimate.estimateNumber}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {estimate.customer.firstName} {estimate.customer.lastName}
          {estimate.property ? ` · ${estimate.property.address}` : ""}
          {estimate.job ? ` · ${estimate.job.jobNumber}` : ""}
        </p>
      </div>

      {estimate.status === "APPROVED" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          This estimate was approved
          {estimate.approvedAt ? ` on ${estimate.approvedAt.toLocaleString()}` : ""}.
          The approved work cannot be changed here.
        </p>
      ) : null}

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.id || group.name} className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-[var(--cy-navy)]">{group.name}</h2>
                {group.description ? (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">{group.description}</p>
                ) : null}
              </div>
              <p className="text-xl font-semibold tabular-nums">{formatMoney(group.totals.totalCents)}</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {group.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <div>
                    <p>{item.name}</p>
                    {item.description ? (
                      <p className="text-xs text-[var(--muted-foreground)]">{item.description}</p>
                    ) : null}
                  </div>
                  <span className="tabular-nums">
                    {formatMoney(lineTotalCents(Number(item.quantity), item.unitPriceCents))}
                  </span>
                </li>
              ))}
            </ul>
            {estimate.status !== "APPROVED" ? (
              <ActionForm action={publicApproveEstimateAction} className="mt-4" successMessage="Approved. Thank you.">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="estimateId" value={estimate.id} />
                <input type="hidden" name="optionId" value={group.id} />
                <Button type="submit">Approve {group.name}</Button>
              </ActionForm>
            ) : null}
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 text-sm text-[var(--muted-foreground)]">
        <p className="font-medium text-[var(--foreground)]">Terms</p>
        <p className="mt-2">
          Approval authorizes the selected work at the price shown. This page does not collect card numbers.
        </p>
      </section>
    </main>
  );
}
