import type { LeadSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { matchCustomerForLead } from "@/lib/leads/matching";

export async function upsertExternalLead(input: {
  companyId: string;
  provider: string;
  externalLeadId: string;
  source: LeadSource;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  sourceDetail?: string | null;
  campaignName?: string | null;
  message?: string | null;
  receivedAt?: Date;
}) {
  const existing = await prisma.lead.findFirst({
    where: {
      companyId: input.companyId,
      provider: input.provider,
      externalLeadId: input.externalLeadId,
    },
  });
  if (existing) return { lead: existing, created: false };

  const match = await matchCustomerForLead(input.companyId, {
    email: input.email,
    phone: input.phone,
  });

  const lead = await prisma.lead.create({
    data: {
      companyId: input.companyId,
      customerId: match?.customer.id ?? null,
      provider: input.provider,
      externalLeadId: input.externalLeadId,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      campaignName: input.campaignName ?? null,
      firstName: input.firstName || "Unknown",
      lastName: input.lastName || "Lead",
      phone: input.phone ?? null,
      email: input.email ?? null,
      message: input.message ?? null,
      receivedAt: input.receivedAt ?? new Date(),
      firstTouch: input.provider,
      lastTouch: input.provider,
    },
  });
  return { lead, created: true };
}

export async function upsertExternalReview(input: {
  companyId: string;
  provider: string;
  externalId: string;
  rating: number;
  authorName?: string | null;
  body?: string | null;
  reviewedAt: Date;
  respondedAt?: Date | null;
}) {
  return prisma.review.upsert({
    where: {
      companyId_provider_externalId: {
        companyId: input.companyId,
        provider: input.provider,
        externalId: input.externalId,
      },
    },
    create: {
      companyId: input.companyId,
      provider: input.provider,
      externalId: input.externalId,
      rating: input.rating,
      authorName: input.authorName ?? null,
      body: input.body ?? null,
      reviewedAt: input.reviewedAt,
      respondedAt: input.respondedAt ?? null,
      needsResponse: !input.respondedAt,
    },
    update: {
      rating: input.rating,
      authorName: input.authorName ?? null,
      body: input.body ?? null,
      reviewedAt: input.reviewedAt,
      respondedAt: input.respondedAt ?? null,
      needsResponse: !input.respondedAt,
    },
  });
}

export async function upsertMarketingSpend(input: {
  companyId: string;
  source: string;
  provider: string;
  externalId: string;
  campaignName?: string | null;
  periodStart: Date;
  periodEnd: Date;
  amountCents: number;
}) {
  return prisma.marketingSpend.upsert({
    where: {
      companyId_provider_externalId: {
        companyId: input.companyId,
        provider: input.provider,
        externalId: input.externalId,
      },
    },
    create: input,
    update: {
      amountCents: input.amountCents,
      campaignName: input.campaignName ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      source: input.source,
    },
  });
}

export async function recordMetricSnapshot(input: {
  companyId: string;
  metricKey: string;
  periodStart: Date;
  periodEnd: Date;
  grain: string;
  value: number;
  sampleSize: number;
}) {
  return prisma.metricSnapshot.upsert({
    where: {
      companyId_metricKey_periodStart_periodEnd_grain: {
        companyId: input.companyId,
        metricKey: input.metricKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        grain: input.grain,
      },
    },
    create: input,
    update: { value: input.value, sampleSize: input.sampleSize },
  });
}

export type JsonObject = Prisma.InputJsonValue;
