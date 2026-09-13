import type { PrismaClient } from "@prisma/client";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";
import { mappingScopeWhere, QBO_SCOPED } from "@/lib/quickbooks/ownership";
import { QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";
import { MAPPING_ENTITY, type InboundObjectType } from "@/lib/quickbooks/inbound-types";

export async function findScopedMappingByQuickBooksId(
  prisma: PrismaClient,
  scope: QuickBooksScope,
  objectType: InboundObjectType,
  quickbooksId: string
) {
  return prisma.quickBooksMapping.findFirst({
    where: {
      ...mappingScopeWhere(scope),
      entityType: MAPPING_ENTITY[objectType],
      quickbooksId,
    },
  });
}

export async function upsertInboundMapping(
  prisma: PrismaClient,
  input: {
    scope: QuickBooksScope;
    objectType: InboundObjectType;
    internalId: string;
    quickbooksId: string;
    syncToken?: string | null;
    lastModified?: Date | null;
  }
) {
  const existingByQbo = await findScopedMappingByQuickBooksId(
    prisma,
    input.scope,
    input.objectType,
    input.quickbooksId
  );
  const data = {
    ...input.scope,
    ownershipStatus: QBO_SCOPED,
    entityType: MAPPING_ENTITY[input.objectType],
    internalId: input.internalId,
    quickbooksId: input.quickbooksId,
    status: "SYNCED" as const,
    lastSyncedAt: new Date(),
    lastSyncError: null as string | null,
    syncToken: input.syncToken ?? undefined,
    metadata: {
      source: QUICKBOOKS_SOURCE,
      direction: "PULL",
      lastModified: input.lastModified?.toISOString() ?? null,
    },
  };
  if (existingByQbo) {
    return prisma.quickBooksMapping.update({
      where: { id: existingByQbo.id },
      data: {
        internalId: input.internalId,
        status: "SYNCED",
        lastSyncedAt: new Date(),
        lastSyncError: null,
        syncToken: input.syncToken ?? existingByQbo.syncToken,
        metadata: data.metadata,
      },
    });
  }
  return prisma.quickBooksMapping.upsert({
    where: {
      companyId_environment_realmId_entityType_internalId: {
        ...input.scope,
        entityType: MAPPING_ENTITY[input.objectType],
        internalId: input.internalId,
      },
    },
    create: data,
    update: {
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      ownershipStatus: QBO_SCOPED,
      metadata: data.metadata,
    },
  });
}
