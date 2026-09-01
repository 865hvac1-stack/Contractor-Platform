import type { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";

export type IdentityEntity = "CUSTOMER" | "LEAD" | "USER" | "COMPANY" | "CONTACT";

export async function getIdentityMap(
  prisma: PrismaClient,
  input: { companyId: string; entityType: IdentityEntity; internalId?: string; externalId?: string }
) {
  if (input.internalId) {
    return prisma.providerIdentityMap.findFirst({
      where: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: input.entityType,
        internalId: input.internalId,
      },
    });
  }
  if (input.externalId) {
    return prisma.providerIdentityMap.findFirst({
      where: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: input.entityType,
        externalId: input.externalId,
      },
    });
  }
  return null;
}

export async function upsertIdentityMap(
  prisma: PrismaClient,
  input: {
    companyId: string;
    entityType: IdentityEntity;
    internalId: string;
    externalId: string;
    metadata?: Record<string, string>;
  }
) {
  return prisma.providerIdentityMap.upsert({
    where: {
      companyId_provider_entityType_internalId: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: input.entityType,
        internalId: input.internalId,
      },
    },
    create: {
      companyId: input.companyId,
      provider: HIGHLEVEL_PROVIDER_KEY,
      entityType: input.entityType,
      internalId: input.internalId,
      externalId: input.externalId,
      metadata: input.metadata,
    },
    update: {
      externalId: input.externalId,
      metadata: input.metadata,
    },
  });
}

export function normalizePhoneDigits(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

export function normalizeEmailValue(email?: string | null) {
  const value = email?.trim().toLowerCase();
  return value || null;
}
