import { prisma } from "@/lib/db";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";

/**
 * Stored insights must be generated from verified metrics.
 * This phase does not invent sample insights.
 */
export async function listActiveInsights(companyId: string) {
  return prisma.insight.findMany({
    where: scopedCompanyWhere(companyId, {
      resolvedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    }),
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}
