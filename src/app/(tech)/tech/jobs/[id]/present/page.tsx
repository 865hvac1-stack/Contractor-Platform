import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAssignedJob } from "@/lib/tech/access";
import { prisma } from "@/lib/db";
import { formatMoney, lineTotalCents } from "@/lib/money";
import { optionTotals } from "@/lib/estimates/totals";
import { publicApproveEstimateAction } from "@/server/actions/public-billing";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

export default async function TechPresentEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { job } = await requireAssignedJob(id);
  const estimate = await prisma.estimate.findFirst({
    where: { jobId: job.id, companyId: job.companyId },
    include: {
      company: { select: { businessName: true } },
      customer: true,
      options: { orderBy: { sortOrder: "asc" }, include: { lineItems: { orderBy: { sortOrder: "asc" } } } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "desc" },
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
        }))
      : [
          {
            id: "",
            name: "Proposed work",
            description: null,
            items: estimate.lineItems,
            totals: optionTotals(estimate.lineItems),
          },
        ];

  return (
    <div className="space-y-5">
      <Link href={`/tech/jobs/${job.id}`} className="text-xs text-[var(--muted-foreground)]">
        ← Back to job
      </Link>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          {estimate.company.businessName}
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Your options</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {estimate.customer.firstName} {estimate.customer.lastName} · {estimate.estimateNumber}
        </p>
      </div>
      {estimate.status === "APPROVED" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Approved {estimate.approvedAt ? `on ${estimate.approvedAt.toLocaleString()}` : ""}. This snapshot cannot be
          changed here.
        </p>
      ) : null}
      {groups.map((group) => (
        <section key={group.id || group.name} className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{group.name}</h2>
              {group.description ? <p className="mt-1 text-sm text-[var(--muted-foreground)]">{group.description}</p> : null}
            </div>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(group.totals.totalCents)}</p>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {group.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>{item.name}</span>
                <span className="tabular-nums">
                  {formatMoney(lineTotalCents(Number(item.quantity), item.unitPriceCents))}
                </span>
              </li>
            ))}
          </ul>
          {estimate.status !== "APPROVED" && estimate.publicToken ? (
            <ActionForm action={publicApproveEstimateAction} className="mt-4">
              <input type="hidden" name="token" value={estimate.publicToken} />
              <input type="hidden" name="optionId" value={group.id} />
              <Button type="submit" className="h-12 w-full">
                Approve {group.name}
              </Button>
            </ActionForm>
          ) : null}
        </section>
      ))}
      <p className="text-xs text-[var(--muted-foreground)]">
        Pricing shown is customer pricing. Internal cost, margin, and technician incentives are not included.
      </p>
    </div>
  );
}
