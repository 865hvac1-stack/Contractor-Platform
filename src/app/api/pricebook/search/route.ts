import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { searchPricebookWhere, customerHasActiveMembership, unitPriceForCustomer } from "@/lib/pricebook/pricing";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("pricebook:view");
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const customerId = url.searchParams.get("customerId");
    const items = await prisma.pricebookItem.findMany({
      where: searchPricebookWhere(ctx.company.id, q),
      include: { category: { select: { name: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 40,
    });
    const membership = customerId
      ? await customerHasActiveMembership(prisma, ctx.company.id, customerId)
      : null;
    const showCost = can(ctx.role, "pricebook:cost");
    return NextResponse.json({
      items: items.map((item) => ({
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
        internalCostCents: showCost ? item.internalCostCents : null,
        unit: item.unit,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
