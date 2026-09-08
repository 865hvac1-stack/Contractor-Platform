import type { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { canonicalizeUsPhone } from "@/lib/phone";

export type IdentityEntity = "CUSTOMER" | "LEAD" | "USER" | "COMPANY" | "CONTACT";

export class ProviderIdentityConflictError extends Error {
  readonly code = "PROVIDER_IDENTITY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ProviderIdentityConflictError";
  }
}

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

/**
 * Idempotent HighLevel identity write.
 * The database unique keys are:
 *   (companyId, provider, entityType, internalId)
 *   (companyId, provider, entityType, externalId)
 * Never insert when the provider entity already exists.
 */
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
  const whereBase = {
    companyId: input.companyId,
    provider: HIGHLEVEL_PROVIDER_KEY,
    entityType: input.entityType,
  };
  const [byInternal, byExternal] = await Promise.all([
    prisma.providerIdentityMap.findFirst({
      where: { ...whereBase, internalId: input.internalId },
    }),
    prisma.providerIdentityMap.findFirst({
      where: { ...whereBase, externalId: input.externalId },
    }),
  ]);

  if (byInternal && byExternal) {
    if (byInternal.id === byExternal.id) {
      if (input.metadata) {
        return prisma.providerIdentityMap.update({
          where: { id: byInternal.id },
          data: { metadata: input.metadata },
        });
      }
      return byInternal;
    }
    throw new ProviderIdentityConflictError(
      `HighLevel ${input.entityType.toLowerCase()} ${input.externalId} is already linked to another ContractorYou record in this company.`
    );
  }

  if (byInternal) {
    if (byInternal.externalId === input.externalId) return byInternal;
    return prisma.providerIdentityMap.update({
      where: { id: byInternal.id },
      data: {
        externalId: input.externalId,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  }

  if (byExternal) {
    return byExternal;
  }

  // Canonical provider-entity unique. The old upsert used
  // companyId_provider_entityType_internalId, which created a new row when
  // this customer had no mapping yet and then collided on externalId.
  return prisma.providerIdentityMap.upsert({
    where: {
      companyId_provider_entityType_externalId: {
        companyId: input.companyId,
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: input.entityType,
        externalId: input.externalId,
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
    update: input.metadata ? { metadata: input.metadata } : {},
  });
}

export function normalizePhoneDigits(phone?: string | null) {
  return canonicalizeUsPhone(phone);
}

export function normalizeEmailValue(email?: string | null) {
  const value = email?.trim().toLowerCase();
  return value || null;
}
