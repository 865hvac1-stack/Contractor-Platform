import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { searchPricebookWhere, customerHasActiveMembership, unitPriceForCustomer } from "@/lib/pricebook/pricing";
import { PricebookPicker } from "@/components/pricebook/picker";

export default async function EstimatePricebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ optionId?: string; q?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermission("estimates:manage");
  const estimate = await prisma.estimate.findFirst({
    where: { id, companyId: ctx.company.id },
    include: { customer: true, options: { orderBy: { sortOrder: "asc" } } },
  });
  if (!estimate) notFound();
  const membership = await customerHasActiveMembership(prisma, ctx.company.id, estimate.customerId);
  const items = await prisma.pricebookItem.findMany({
    where: searchPricebookWhere(ctx.company.id, query.q ?? ""),
    include: { category: { select: { name: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 40,
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href={`/estimates/${estimate.id}`} className="text-sm text-[var(--muted-foreground)]">
        ← {estimate.estimateNumber}
      </Link>
      <div>
        <h1 className="font-display text-2xl tracking-tight">Pricebook</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {estimate.customer.firstName} {estimate.customer.lastName}
          {membership ? " · Active membership pricing applies" : ""}
        </p>
      </div>
      {estimate.options.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {estimate.options.map((option) => (
            <Link
              key={option.id}
              href={`/estimates/${estimate.id}/pricebook?optionId=${option.id}`}
              className={`rounded-full px-3 py-1 text-sm ${
                query.optionId === option.id
                  ? "bg-[var(--cy-navy)] text-white"
                  : "bg-[var(--muted)] text-[var(--foreground)]"
              }`}
            >
              {option.name}
            </Link>
          ))}
        </div>
      ) : null}
      <PricebookPicker
        estimateId={estimate.id}
        optionId={query.optionId ?? estimate.options[0]?.id}
        customerId={estimate.customerId}
        initialItems={items.map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          type: item.type,
          category: item.category.name,
          customerDescription: item.customerDescription,
          technicianNotes: item.technicianNotes,
          standardPriceCents: item.standardPriceCents,
          memberPriceCents: item.memberPriceCents,
          unitPriceCents: unitPriceForCustomer({
            standardPriceCents: item.standardPriceCents,
            memberPriceCents: item.memberPriceCents,
            eligible: Boolean(membership),
          }),
          memberEligible: Boolean(membership) && item.memberPriceCents != null,
          unit: item.unit,
        }))}
      />
    </div>
  );
}
