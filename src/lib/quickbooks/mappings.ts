import type { PrismaClient, QuickBooksMapping, QuickBooksSyncStatus } from "@prisma/client";
import { humanQuickBooksError } from "@/lib/quickbooks/errors";

export const DEFAULT_ITEM_INTERNAL_ID = "default";
export const ENTITY_DEFAULT_ITEM = "DEFAULT_ITEM";
export const ENTITY_SERVICE_ITEM = "SERVICE_ITEM";
export const ENTITY_EXPENSE_ACCOUNT = "EXPENSE_ACCOUNT";
export const ENTITY_INVOICE = "INVOICE";
export const ENTITY_PAYMENT = "PAYMENT";
export const INVOICE_MISSING_IN_QBO = "Invoice is not in QuickBooks yet.";

export function invoiceMappingIdentity(input: { companyId: string; invoiceId: string }) {
  return {
    companyId: input.companyId,
    entityType: ENTITY_INVOICE,
    internalId: input.invoiceId,
  };
}

export function paymentMappingIdentity(input: { companyId: string; paymentId: string }) {
  return {
    companyId: input.companyId,
    entityType: ENTITY_PAYMENT,
    internalId: input.paymentId,
  };
}

export type QboItemOption = {
  id: string;
  name: string;
  type?: string;
  active?: boolean;
};

export type ItemMappingRecord = {
  entityType: string;
  internalId: string;
  quickbooksId: string;
  status: QuickBooksSyncStatus;
  lastSyncError: string | null;
  name?: string | null;
  realmId?: string | null;
};

export type SavedItemMappings = {
  defaultItem: ItemMappingRecord | null;
  serviceItems: ItemMappingRecord[];
  expenseAccount: ItemMappingRecord | null;
};

type MappingRow = Pick<
  QuickBooksMapping,
  "entityType" | "internalId" | "quickbooksId" | "status" | "lastSyncError" | "metadata"
>;

function metadataName(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const name = (metadata as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function metadataRealm(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const realmId = (metadata as { realmId?: unknown }).realmId;
  return typeof realmId === "string" ? realmId : null;
}

function isPersistedQboId(value?: string | null) {
  const id = (value || "").trim();
  return Boolean(id) && id !== "REVIEW";
}

export function mappingFromRow(row: MappingRow): ItemMappingRecord {
  return {
    entityType: row.entityType,
    internalId: row.internalId,
    quickbooksId: row.quickbooksId,
    status: row.status,
    lastSyncError: row.lastSyncError,
    name: metadataName(row.metadata),
    realmId: metadataRealm(row.metadata),
  };
}

export function loadSavedItemMappings(rows: MappingRow[]): SavedItemMappings {
  const mapped = rows.map(mappingFromRow);
  return {
    defaultItem: mapped.find((row) => row.entityType === ENTITY_DEFAULT_ITEM && row.internalId === DEFAULT_ITEM_INTERNAL_ID) ?? null,
    serviceItems: mapped.filter((row) => row.entityType === ENTITY_SERVICE_ITEM),
    expenseAccount:
      mapped.find((row) => row.entityType === ENTITY_EXPENSE_ACCOUNT && row.internalId === DEFAULT_ITEM_INTERNAL_ID) ?? null,
  };
}

export async function listCompanyItemMappings(prisma: PrismaClient, companyId: string) {
  const rows = await prisma.quickBooksMapping.findMany({
    where: {
      companyId,
      entityType: { in: [ENTITY_DEFAULT_ITEM, ENTITY_SERVICE_ITEM, ENTITY_EXPENSE_ACCOUNT] },
    },
  });
  return loadSavedItemMappings(rows);
}

function findActiveItem(items: QboItemOption[] | undefined, id: string) {
  if (!items) return { known: false as const };
  const match = items.find((item) => item.id === id);
  if (!match) return { known: true as const, item: null };
  if (match.active === false) return { known: true as const, item: null };
  return { known: true as const, item: match };
}

export async function persistItemMapping(
  prisma: PrismaClient,
  input: {
    companyId: string;
    entityType: string;
    internalId: string;
    quickbooksId: string;
    name?: string | null;
    realmId?: string | null;
  }
) {
  const metadata = {
    name: input.name ?? null,
    realmId: input.realmId ?? null,
  };
  return prisma.quickBooksMapping.upsert({
    where: {
      companyId_entityType_internalId: {
        companyId: input.companyId,
        entityType: input.entityType,
        internalId: input.internalId,
      },
    },
    create: {
      companyId: input.companyId,
      entityType: input.entityType,
      internalId: input.internalId,
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      metadata,
    },
    update: {
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      metadata,
    },
  });
}

export async function markItemMappingNeedsReview(
  prisma: PrismaClient,
  input: { companyId: string; entityType: string; internalId: string; error: string }
) {
  await prisma.quickBooksMapping.updateMany({
    where: {
      companyId: input.companyId,
      entityType: input.entityType,
      internalId: input.internalId,
    },
    data: { status: "NEEDS_REVIEW", lastSyncError: input.error },
  });
}

export async function saveCompanyItemMappings(
  prisma: PrismaClient,
  input: {
    companyId: string;
    realmId?: string | null;
    defaultItemId?: string | null;
    serviceItems?: Array<{ serviceTypeId: string; quickbooksId: string }>;
    expenseAccountId?: string | null;
    activeItems?: QboItemOption[];
    activeAccounts?: QboItemOption[];
  }
) {
  const saved: string[] = [];
  if (input.defaultItemId) {
    const check = findActiveItem(input.activeItems, input.defaultItemId);
    if (check.known && !check.item) {
      return { ok: false as const, error: "That QuickBooks Product/Service is not active on this company." };
    }
    await persistItemMapping(prisma, {
      companyId: input.companyId,
      entityType: ENTITY_DEFAULT_ITEM,
      internalId: DEFAULT_ITEM_INTERNAL_ID,
      quickbooksId: input.defaultItemId,
      name: check.item?.name ?? null,
      realmId: input.realmId,
    });
    saved.push("default");
  }
  for (const row of input.serviceItems ?? []) {
    if (!row.quickbooksId) continue;
    const check = findActiveItem(input.activeItems, row.quickbooksId);
    if (check.known && !check.item) {
      return { ok: false as const, error: "A service mapping points to a QuickBooks item that is not active on this company." };
    }
    await persistItemMapping(prisma, {
      companyId: input.companyId,
      entityType: ENTITY_SERVICE_ITEM,
      internalId: row.serviceTypeId,
      quickbooksId: row.quickbooksId,
      name: check.item?.name ?? null,
      realmId: input.realmId,
    });
    saved.push(row.serviceTypeId);
  }
  if (input.expenseAccountId) {
    const check = findActiveItem(input.activeAccounts, input.expenseAccountId);
    if (check.known && !check.item) {
      return { ok: false as const, error: "That QuickBooks expense account is not active on this company." };
    }
    await persistItemMapping(prisma, {
      companyId: input.companyId,
      entityType: ENTITY_EXPENSE_ACCOUNT,
      internalId: DEFAULT_ITEM_INTERNAL_ID,
      quickbooksId: input.expenseAccountId,
      name: check.item?.name ?? null,
      realmId: input.realmId,
    });
  }
  if (!saved.length && !input.expenseAccountId) {
    return { ok: false as const, error: "Choose a QuickBooks Product/Service before saving mappings." };
  }
  return { ok: true as const };
}

export async function resolveInvoiceItemMapping(
  prisma: PrismaClient,
  input: {
    companyId: string;
    serviceTypeId?: string | null;
    realmId?: string | null;
    activeItems?: QboItemOption[];
  }
): Promise<{ itemId: string; name?: string | null } | { error: string; review: true }> {
  const service = input.serviceTypeId
    ? await prisma.quickBooksMapping.findFirst({
        where: { companyId: input.companyId, entityType: ENTITY_SERVICE_ITEM, internalId: input.serviceTypeId },
      })
    : null;
  const fallback = await prisma.quickBooksMapping.findFirst({
    where: {
      companyId: input.companyId,
      entityType: ENTITY_DEFAULT_ITEM,
      internalId: DEFAULT_ITEM_INTERNAL_ID,
    },
  });
  const chosen = service?.quickbooksId ? service : fallback;
  if (!chosen?.quickbooksId) {
    return { error: humanQuickBooksError({ missing: "item" }), review: true };
  }
  if (chosen.status === "NEEDS_REVIEW" || chosen.status === "FAILED") {
    return { error: chosen.lastSyncError || humanQuickBooksError({ missing: "item" }), review: true };
  }
  const savedRealm = metadataRealm(chosen.metadata);
  if (input.realmId && savedRealm && savedRealm !== input.realmId) {
    await markItemMappingNeedsReview(prisma, {
      companyId: input.companyId,
      entityType: chosen.entityType,
      internalId: chosen.internalId,
      error: "This Product/Service mapping belongs to a different QuickBooks company.",
    });
    return { error: "This Product/Service mapping belongs to a different QuickBooks company.", review: true };
  }
  const check = findActiveItem(input.activeItems, chosen.quickbooksId);
  if (check.known && !check.item) {
    await markItemMappingNeedsReview(prisma, {
      companyId: input.companyId,
      entityType: chosen.entityType,
      internalId: chosen.internalId,
      error: "The saved QuickBooks Product/Service is missing or inactive.",
    });
    return { error: "The saved QuickBooks Product/Service is missing or inactive.", review: true };
  }
  return { itemId: chosen.quickbooksId, name: check.item?.name ?? metadataName(chosen.metadata) };
}

export async function persistInvoiceMapping(
  prisma: PrismaClient,
  input: {
    companyId: string;
    invoiceId: string;
    quickbooksId: string;
    realmId?: string | null;
    syncToken?: string | null;
    qboBalance?: string | null;
    qboTotal?: number | null;
  }
) {
  const identity = invoiceMappingIdentity({ companyId: input.companyId, invoiceId: input.invoiceId });
  const metadata = {
    realmId: input.realmId ?? null,
    qboBalance: input.qboBalance ?? null,
    qboTotal: input.qboTotal ?? null,
  };
  return prisma.quickBooksMapping.upsert({
    where: { companyId_entityType_internalId: identity },
    create: {
      ...identity,
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      syncToken: input.syncToken ?? null,
      metadata,
    },
    update: {
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      syncToken: input.syncToken ?? undefined,
      metadata,
    },
  });
}

export async function persistPaymentMapping(
  prisma: PrismaClient,
  input: {
    companyId: string;
    paymentId: string;
    quickbooksId: string;
    invoiceId: string;
    qboInvoiceId: string;
    realmId?: string | null;
  }
) {
  const identity = paymentMappingIdentity({ companyId: input.companyId, paymentId: input.paymentId });
  const metadata = {
    realmId: input.realmId ?? null,
    invoiceId: input.invoiceId,
    qboInvoiceId: input.qboInvoiceId,
  };
  return prisma.quickBooksMapping.upsert({
    where: { companyId_entityType_internalId: identity },
    create: {
      ...identity,
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      metadata,
    },
    update: {
      quickbooksId: input.quickbooksId,
      status: "SYNCED",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      metadata,
    },
  });
}

async function loadInvoiceMappingRow(
  prisma: PrismaClient,
  input: { companyId: string; invoiceId: string }
) {
  const identity = invoiceMappingIdentity(input);
  const unique = await prisma.quickBooksMapping.findUnique({
    where: { companyId_entityType_internalId: identity },
  });
  if (unique) return unique;
  return prisma.quickBooksMapping.findFirst({
    where: identity,
  });
}

async function healInvoiceMappingFromEvent(
  prisma: PrismaClient,
  input: { companyId: string; invoiceId: string; realmId?: string | null }
) {
  const event = await prisma.quickBooksSyncEvent.findFirst({
    where: {
      companyId: input.companyId,
      entityType: ENTITY_INVOICE,
      internalId: input.invoiceId,
      status: "SYNCED",
      quickbooksId: { not: null },
      action: { in: ["invoice.create", "invoice.update"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!isPersistedQboId(event?.quickbooksId)) return null;
  return persistInvoiceMapping(prisma, {
    companyId: input.companyId,
    invoiceId: input.invoiceId,
    quickbooksId: event!.quickbooksId!,
    realmId: input.realmId,
  });
}

export async function resolveQuickBooksInvoiceMapping(
  prisma: PrismaClient,
  input: { companyId: string; invoiceId: string; realmId?: string | null }
): Promise<{ quickbooksId: string; invoiceId: string; identity: ReturnType<typeof invoiceMappingIdentity> } | { error: string; review: true }> {
  const invoiceId = (input.invoiceId || "").trim();
  if (!invoiceId) {
    return { error: INVOICE_MISSING_IN_QBO, review: true };
  }
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId: input.companyId },
    select: { id: true },
  });
  if (!invoice) {
    return { error: INVOICE_MISSING_IN_QBO, review: true };
  }
  const canonical = invoiceMappingIdentity({ companyId: input.companyId, invoiceId: invoice.id });
  let row = await loadInvoiceMappingRow(prisma, { companyId: input.companyId, invoiceId: invoice.id });
  if (!isPersistedQboId(row?.quickbooksId) || row?.status === "FAILED") {
    row = await healInvoiceMappingFromEvent(prisma, {
      companyId: input.companyId,
      invoiceId: invoice.id,
      realmId: input.realmId,
    });
  }
  if (!isPersistedQboId(row?.quickbooksId)) {
    return { error: INVOICE_MISSING_IN_QBO, review: true };
  }
  if (row!.status === "NEEDS_REVIEW" && row!.lastSyncError) {
    return { error: row!.lastSyncError, review: true };
  }
  const savedRealm = metadataRealm(row!.metadata);
  if (input.realmId && savedRealm && savedRealm !== input.realmId) {
    await markItemMappingNeedsReview(prisma, {
      ...canonical,
      error: "This invoice mapping belongs to a different QuickBooks company.",
    });
    return { error: "This invoice mapping belongs to a different QuickBooks company.", review: true };
  }
  return { quickbooksId: row!.quickbooksId, invoiceId: invoice.id, identity: canonical };
}

export async function resolveQuickBooksPaymentMapping(
  prisma: PrismaClient,
  input: { companyId: string; paymentId: string }
) {
  const identity = paymentMappingIdentity(input);
  const row = await prisma.quickBooksMapping.findUnique({
    where: { companyId_entityType_internalId: identity },
  });
  if (row?.status === "SYNCED" && isPersistedQboId(row.quickbooksId)) {
    return { quickbooksId: row.quickbooksId, identity };
  }
  return null;
}
