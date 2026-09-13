import type { Prisma, PrismaClient, QuickBooksMapping } from "@prisma/client";
import { quickbooksApiBase, QUICKBOOKS_PROVIDER_KEY, type QuickBooksEnvironment } from "@/lib/quickbooks/config";
import type { QboTransport } from "@/lib/quickbooks/client";
import { isHistoricalImport } from "@/lib/imports/safety";

export const QBO_SCOPED = "SCOPED";
export const QBO_LEGACY_UNSCOPED = "LEGACY_UNSCOPED";
export const QBO_SCOPE_MISMATCH_MESSAGE =
  "QuickBooks sync blocked because this record belongs to a different QuickBooks realm or environment.";

export function isProtectedQuickBooksImport(importMode?: string | null) {
  return isHistoricalImport(importMode) || importMode === "REFERENCE";
}

export type QuickBooksScope = {
  companyId: string;
  environment: QuickBooksEnvironment;
  realmId: string;
};

export function isQuickBooksSyncActivated(
  settings:
    | {
        syncActivated: boolean;
        syncEnvironment?: string | null;
        syncRealmId?: string | null;
        syncActivatedAt?: Date | null;
      }
    | null
    | undefined,
  scope: QuickBooksScope
) {
  return Boolean(
    settings?.syncActivated &&
      settings.syncActivatedAt &&
      settings.syncEnvironment === scope.environment &&
      settings.syncRealmId === scope.realmId
  );
}

export function normalizedQuickBooksEnvironment(value?: string | null): QuickBooksEnvironment | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "sandbox" || normalized === "production" ? normalized : null;
}

export function mappingScopeWhere(scope: QuickBooksScope): Prisma.QuickBooksMappingWhereInput {
  return {
    companyId: scope.companyId,
    environment: scope.environment,
    realmId: scope.realmId,
    ownershipStatus: QBO_SCOPED,
  };
}

export function eventScopeWhere(scope: QuickBooksScope): Prisma.QuickBooksSyncEventWhereInput {
  return {
    companyId: scope.companyId,
    environment: scope.environment,
    realmId: scope.realmId,
    ownershipStatus: QBO_SCOPED,
  };
}

export function mappingBelongsToScope(
  mapping: Pick<QuickBooksMapping, "companyId" | "environment" | "realmId" | "ownershipStatus"> | null | undefined,
  scope: QuickBooksScope
) {
  return Boolean(
    mapping &&
      mapping.ownershipStatus === QBO_SCOPED &&
      mapping.companyId === scope.companyId &&
      mapping.environment === scope.environment &&
      mapping.realmId === scope.realmId
  );
}

export async function getActiveQuickBooksScope(
  prisma: PrismaClient,
  companyId: string
): Promise<{ ok: true; scope: QuickBooksScope } | { ok: false; error: string }> {
  const connection = await prisma.integrationConnection.findFirst({
    where: { companyId, providerKey: QUICKBOOKS_PROVIDER_KEY },
    select: { status: true, externalAccountId: true, environment: true },
  });
  if (!connection || connection.status !== "CONNECTED") {
    return { ok: false, error: "Connect QuickBooks before syncing." };
  }
  const environment = normalizedQuickBooksEnvironment(connection.environment);
  const realmId = connection.externalAccountId?.trim();
  if (!environment || !realmId) {
    return { ok: false, error: "QuickBooks connection ownership is incomplete. Reconnect before syncing." };
  }
  return { ok: true, scope: { companyId, environment, realmId } };
}

export type QuickBooksWriteGuardInput = {
  scope: QuickBooksScope;
  transport: QboTransport;
  entityType: string;
  internalId?: string | null;
  importMode?: string | null;
  eligible?: boolean;
  mapping?: Pick<QuickBooksMapping, "companyId" | "environment" | "realmId" | "ownershipStatus"> | null;
};

export function evaluateQuickBooksWriteGuard(input: QuickBooksWriteGuardInput) {
  const context = input.transport.context;
  const expectedHost = new URL(quickbooksApiBase(input.scope.environment)).host;
  if (
    !context ||
    (context.companyId && context.companyId !== input.scope.companyId) ||
    context.realmId !== input.scope.realmId ||
    context.environment !== input.scope.environment ||
    context.apiHost !== expectedHost
  ) {
    return { ok: false as const, error: QBO_SCOPE_MISMATCH_MESSAGE };
  }
  if (input.mapping && !mappingBelongsToScope(input.mapping, input.scope)) {
    return { ok: false as const, error: QBO_SCOPE_MISMATCH_MESSAGE };
  }
  if (isProtectedQuickBooksImport(input.importMode)) {
    return {
      ok: false as const,
      error: "Historical or reference records are protected from QuickBooks writes.",
    };
  }
  if (input.eligible === false) {
    return { ok: false as const, error: "This record is not eligible for live QuickBooks sync." };
  }
  return { ok: true as const };
}

export async function recordBlockedQuickBooksWrite(
  prisma: PrismaClient,
  input: {
    scope: QuickBooksScope;
    entityType: string;
    internalId?: string | null;
    error: string;
  }
) {
  await prisma.quickBooksSyncEvent.create({
    data: {
      companyId: input.scope.companyId,
      environment: input.scope.environment,
      realmId: input.scope.realmId,
      ownershipStatus: QBO_SCOPED,
      entityType: input.entityType,
      internalId: input.internalId ?? null,
      status: "NEEDS_REVIEW",
      action: "write.blocked",
      errorMessage: input.error,
    },
  });
}

export async function assertQuickBooksWriteSafety(
  prisma: PrismaClient,
  input: Omit<QuickBooksWriteGuardInput, "scope"> & { companyId: string }
): Promise<{ ok: true; scope: QuickBooksScope } | { ok: false; error: string }> {
  const active = await getActiveQuickBooksScope(prisma, input.companyId);
  if (!active.ok) return active;
  const result = evaluateQuickBooksWriteGuard({ ...input, scope: active.scope });
  if (!result.ok) {
    await recordBlockedQuickBooksWrite(prisma, {
      scope: active.scope,
      entityType: input.entityType,
      internalId: input.internalId,
      error: result.error,
    });
    return result;
  }
  return { ok: true, scope: active.scope };
}

export async function quickBooksOwnershipCounts(prisma: PrismaClient, companyId: string) {
  const [sandboxMappings, productionMappings, legacyMappings, sandboxEvents, productionEvents, legacyEvents] =
    await Promise.all([
      prisma.quickBooksMapping.count({ where: { companyId, environment: "sandbox", ownershipStatus: QBO_SCOPED } }),
      prisma.quickBooksMapping.count({ where: { companyId, environment: "production", ownershipStatus: QBO_SCOPED } }),
      prisma.quickBooksMapping.count({ where: { companyId, ownershipStatus: QBO_LEGACY_UNSCOPED } }),
      prisma.quickBooksSyncEvent.count({ where: { companyId, environment: "sandbox", ownershipStatus: QBO_SCOPED } }),
      prisma.quickBooksSyncEvent.count({ where: { companyId, environment: "production", ownershipStatus: QBO_SCOPED } }),
      prisma.quickBooksSyncEvent.count({ where: { companyId, ownershipStatus: QBO_LEGACY_UNSCOPED } }),
    ]);
  return {
    sandbox: { mappings: sandboxMappings, events: sandboxEvents },
    production: { mappings: productionMappings, events: productionEvents },
    legacyUnscoped: { mappings: legacyMappings, events: legacyEvents },
    ambiguousBlocked: legacyMappings + legacyEvents,
  };
}

export const CONTRACTORYOU_OWNS = [
  "customer_operational_profile",
  "property",
  "job",
  "service_type",
  "dispatch",
  "technician",
  "job_notes",
  "equipment",
  "photos",
  "scheduling",
  "estimate_workflow",
  "invoice_workflow",
  "customer_communications",
  "waiting_status",
  "membership_operations",
] as const;

export const QUICKBOOKS_OWNS = [
  "accounting_account",
  "posted_transaction_state",
  "accounting_balances",
  "profit_and_loss",
  "accounting_tax_treatment",
  "finalized_expense_category",
  "ledger_state",
] as const;

export type SharedAccountingEntity = "CUSTOMER" | "INVOICE" | "PAYMENT" | "EXPENSE";

export function fieldOwner(entity: SharedAccountingEntity, field: string): "contractoryou" | "quickbooks" | "mapped" {
  if (entity === "CUSTOMER") {
    if (["firstName", "lastName", "phone", "email", "notes", "tags", "status"].includes(field)) return "contractoryou";
    if (["balance", "accountingDisplayName"].includes(field)) return "quickbooks";
    return "mapped";
  }
  if (entity === "INVOICE") {
    if (["invoiceNumber", "lineItems", "notes", "status", "jobId"].includes(field)) return "contractoryou";
    if (["qboBalance", "qboPaidStatus"].includes(field)) return "quickbooks";
    return "mapped";
  }
  if (entity === "PAYMENT") {
    if (["amountCents", "paidAt", "method", "externalRef"].includes(field)) return "contractoryou";
    return "mapped";
  }
  if (["category", "vendor", "amountCents", "date", "jobId"].includes(field)) return "contractoryou";
  return "quickbooks";
}

export function shouldOverwriteOperationalField() {
  return false;
}
