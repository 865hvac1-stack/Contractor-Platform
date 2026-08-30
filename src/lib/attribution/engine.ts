import type { AttributionModel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Attribution writes are always company-scoped.
 * Revenue and profit are stored only when the caller supplies verified cents.
 */
export async function recordAttribution(input: {
  companyId: string;
  leadId?: string | null;
  customerId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  estimateId?: string | null;
  model: AttributionModel;
  source: string;
  campaignId?: string | null;
  revenueCents?: number | null;
  costCents?: number | null;
  note?: string | null;
  overriddenById?: string | null;
}) {
  return prisma.attributionEvent.create({
    data: {
      companyId: input.companyId,
      leadId: input.leadId ?? null,
      customerId: input.customerId ?? null,
      jobId: input.jobId ?? null,
      invoiceId: input.invoiceId ?? null,
      estimateId: input.estimateId ?? null,
      model: input.model,
      source: input.source,
      campaignId: input.campaignId ?? null,
      revenueCents: input.revenueCents ?? null,
      costCents: input.costCents ?? null,
      note: input.note ?? null,
      overriddenById: input.overriddenById ?? null,
    },
  });
}

export async function attributedRevenueCents(
  companyId: string,
  range: { start: Date; end: Date },
  source?: string
) {
  const where: Prisma.AttributionEventWhereInput = {
    companyId,
    createdAt: { gte: range.start, lte: range.end },
    revenueCents: { not: null },
    ...(source ? { source } : {}),
  };
  const agg = await prisma.attributionEvent.aggregate({
    where,
    _sum: { revenueCents: true },
    _count: true,
  });
  return {
    cents: agg._sum.revenueCents ?? 0,
    events: agg._count,
  };
}

export async function attributedGrossProfitCents(
  companyId: string,
  range: { start: Date; end: Date }
) {
  const leads = await prisma.lead.findMany({
    where: {
      companyId,
      attributedGrossProfitCents: { not: null },
      convertedAt: { gte: range.start, lte: range.end },
    },
    select: { attributedGrossProfitCents: true },
  });
  return leads.reduce((sum, lead) => sum + (lead.attributedGrossProfitCents ?? 0), 0);
}
