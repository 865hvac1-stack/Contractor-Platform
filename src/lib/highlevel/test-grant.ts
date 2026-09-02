import type { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { writeAudit } from "@/lib/audit";
import { companyAllowsExternalIntegrationTesting } from "@/lib/demo/guard";

export const PROVIDER_TEST_ONLY_MODE = "TEST_ONLY";

export type HighLevelTestGrantView = {
  id: string;
  tenantCompanyId: string;
  ownerCompanyId: string;
  ownerCompanyName: string;
  ownerLocationId: string;
  accountLabel: string | null;
  mode: string;
  status: string;
  providerKey: string;
};

export async function findHighLevelOwnerConnection(prisma: PrismaClient, locationId: string) {
  if (!locationId) return null;
  return prisma.integrationConnection.findFirst({
    where: {
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      externalAccountId: locationId,
    },
    include: { company: { select: { id: true, businessName: true, isDemo: true } } },
  });
}

export async function getHighLevelTestGrant(prisma: PrismaClient, tenantCompanyId: string) {
  return prisma.providerTestGrant.findUnique({
    where: {
      tenantCompanyId_providerKey: {
        tenantCompanyId,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
      },
    },
    include: {
      ownerCompany: { select: { id: true, businessName: true } },
    },
  });
}

export function toHighLevelTestGrantView(
  grant: Awaited<ReturnType<typeof getHighLevelTestGrant>>
): HighLevelTestGrantView | null {
  if (!grant) return null;
  return {
    id: grant.id,
    tenantCompanyId: grant.tenantCompanyId,
    ownerCompanyId: grant.ownerCompanyId,
    ownerCompanyName: grant.ownerCompany.businessName,
    ownerLocationId: grant.ownerLocationId,
    accountLabel: grant.accountLabel,
    mode: grant.mode,
    status: grant.status,
    providerKey: grant.providerKey,
  };
}

/**
 * Authorize a HighLevel location for a sandbox tenant without claiming ownership.
 * Tokens from the OAuth exchange are discarded here — this pass only records TEST_ONLY authorization.
 */
export async function authorizeHighLevelTestGrant(
  prisma: PrismaClient,
  input: {
    tenantCompanyId: string;
    actorId?: string | null;
    locationId: string;
    accountLabel?: string | null;
    scopes?: string[];
  }
) {
  const allowed = await companyAllowsExternalIntegrationTesting(input.tenantCompanyId, prisma);
  if (!allowed) {
    return { ok: false as const, error: "This company is not enabled for external integration testing." };
  }
  const owner = await findHighLevelOwnerConnection(prisma, input.locationId);
  if (!owner) {
    return { ok: false as const, error: "That HighLevel location is not owned by another ContractorYou company, so TEST_ONLY access does not apply." };
  }
  if (owner.companyId === input.tenantCompanyId) {
    return { ok: false as const, error: "A company cannot create a TEST_ONLY grant for a location it already owns." };
  }

  const grant = await prisma.providerTestGrant.upsert({
    where: {
      tenantCompanyId_providerKey: {
        tenantCompanyId: input.tenantCompanyId,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
      },
    },
    create: {
      tenantCompanyId: input.tenantCompanyId,
      ownerCompanyId: owner.companyId,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      ownerLocationId: input.locationId,
      mode: PROVIDER_TEST_ONLY_MODE,
      status: "AUTHORIZED",
      accountLabel: input.accountLabel || owner.accountLabel || owner.company.businessName,
      scopes: input.scopes ?? [],
    },
    update: {
      ownerCompanyId: owner.companyId,
      ownerLocationId: input.locationId,
      mode: PROVIDER_TEST_ONLY_MODE,
      status: "AUTHORIZED",
      accountLabel: input.accountLabel || owner.accountLabel || owner.company.businessName,
      scopes: input.scopes ?? [],
    },
    include: { ownerCompany: { select: { id: true, businessName: true } } },
  });

  await writeAudit({
    companyId: input.tenantCompanyId,
    actorId: input.actorId ?? null,
    action: "highlevel.test_grant.authorized",
    entityType: "ProviderTestGrant",
    entityId: grant.id,
    metadata: {
      mode: PROVIDER_TEST_ONLY_MODE,
      ownerCompanyId: owner.companyId,
      locationId: input.locationId,
    },
  });

  return {
    ok: true as const,
    mode: PROVIDER_TEST_ONLY_MODE,
    grant: toHighLevelTestGrantView(grant),
    ownerCompanyId: owner.companyId,
    ownerLocationId: input.locationId,
  };
}
