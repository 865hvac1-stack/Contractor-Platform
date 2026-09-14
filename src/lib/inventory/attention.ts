import type { PrismaClient } from "@prisma/client";
import type { AttentionItem } from "@/lib/attention";

export async function detectInventoryAttention(
  prisma: PrismaClient,
  companyId: string
): Promise<AttentionItem[]> {
  const stocks = await prisma.inventoryStock.findMany({
    where: { companyId, minimumStock: { gt: 0 }, location: { active: true }, part: { active: true } },
    include: {
      part: { select: { id: true, name: true, sku: true } },
      location: { select: { name: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: 250,
  });
  return stocks
    .filter((stock) => stock.onHand - stock.reserved < stock.minimumStock)
    .slice(0, 25)
    .map((stock) => ({
      id: `inventory-low-${stock.id}`,
      type: "inventory_low_stock",
      title: "Low stock",
      description: `${stock.part.name}${stock.part.sku ? ` · ${stock.part.sku}` : ""} · ${stock.onHand - stock.reserved} available at ${stock.location.name}`,
      severity: stock.onHand - stock.reserved <= 0 ? "critical" as const : "warning" as const,
      href: `/pricebook?q=${encodeURIComponent(stock.part.sku || stock.part.name)}`,
      entityType: "PricebookItem",
      entityId: stock.part.id,
      createdAt: stock.updatedAt,
      recommendedAction: "Review stock and receive or transfer inventory.",
      category: "operations" as const,
    }));
}
