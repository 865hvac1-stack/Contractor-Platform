import type { PrismaClient } from "@prisma/client";

export async function customerHasActiveMembership(prisma: PrismaClient, companyId: string, customerId: string) {
  const row = await prisma.customerMembership.findFirst({
    where: { companyId, customerId, status: "ACTIVE" },
    select: { id: true, plan: { select: { discountPercent: true } } },
  });
  return row;
}

export function unitPriceForCustomer(input: {
  standardPriceCents: number;
  memberPriceCents: number | null;
  eligible: boolean;
}) {
  if (input.eligible && input.memberPriceCents != null) return input.memberPriceCents;
  return input.standardPriceCents;
}

export function searchPricebookWhere(companyId: string, q: string) {
  const term = q.trim();
  if (!term) return { companyId, active: true, category: { archived: false } };
  return {
    companyId,
    active: true,
    category: { archived: false },
    OR: [
      { name: { contains: term, mode: "insensitive" as const } },
      { internalName: { contains: term, mode: "insensitive" as const } },
      { sku: { contains: term, mode: "insensitive" as const } },
      { customerDescription: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
    ],
  };
}
