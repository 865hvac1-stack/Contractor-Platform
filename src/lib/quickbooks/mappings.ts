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
    qboDocNumber?: string | null;
  }
) {
  const identity = invoiceMappingIdentity({ companyId: input.companyId, invoiceId: input.invoiceId });
  const metadata = {
    realmId: input.realmId ?? null,
    qboInvoiceId: input.quickbooksId,
    qboDocNumber: input.qboDocNumber ?? null,
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

export type InvoicePaymentTrace = {
  paymentId: string | null;
  paymentInvoiceId: string | null;
  paymentCompanyId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceCompanyId: string | null;
  lookupCompanyId: string | null;
  lookupEntityType: string;
  lookupInternalId: string | null;
  realmId: string | null;
  mappingFound: boolean;
  mappingId: string | null;
  mappingInternalId: string | null;
  mappingCompanyId: string | null;
  mappingQuickbooksId: string | null;
  mappingStatus: string | null;
  mappingRealmId: string | null;
  eventInternalId: string | null;
  eventQuickbooksId: string | null;
  invoiceIdsEqual: boolean | null;
  companyIdsEqual: boolean | null;
  reason: string;
};

export function formatInvoicePaymentTrace(trace: InvoicePaymentTrace) {
  return [
    INVOICE_MISSING_IN_QBO,
    `payment.id=${trace.paymentId ?? "null"}`,
    `payment.invoiceId=${trace.paymentInvoiceId ?? "null"}`,
    `invoice.id=${trace.invoiceId ?? "null"}`,
    `invoice.invoiceNumber=${trace.invoiceNumber ?? "null"}`,
    `payment.companyId=${trace.paymentCompanyId ?? "null"}`,
    `invoice.companyId=${trace.invoiceCompanyId ?? "null"}`,
    `lookup.companyId=${trace.lookupCompanyId ?? "null"}`,
    `lookup.entityType=${trace.lookupEntityType}`,
    `lookup.internalId=${trace.lookupInternalId ?? "null"}`,
    `realmId=${trace.realmId ?? "null"}`,
    `mapping.found=${trace.mappingFound}`,
    `mapping.internalId=${trace.mappingInternalId ?? "null"}`,
    `mapping.quickbooksId=${trace.mappingQuickbooksId ?? "null"}`,
    `event.internalId=${trace.eventInternalId ?? "null"}`,
    `event.quickbooksId=${trace.eventQuickbooksId ?? "null"}`,
    `invoiceIdsEqual=${trace.invoiceIdsEqual}`,
    `companyIdsEqual=${trace.companyIdsEqual}`,
    `why=${trace.reason}`,
  ].join(" | ");
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
  input: {
    companyId: string;
    invoiceId: string;
    realmId?: string | null;
    paymentId?: string | null;
    paymentInvoiceId?: string | null;
    paymentCompanyId?: string | null;
    invoice?: { id: string; companyId: string; invoiceNumber: string } | null;
  }
): Promise<
  | { quickbooksId: string; invoiceId: string; identity: ReturnType<typeof invoiceMappingIdentity> }
  | { error: string; review: true; trace: InvoicePaymentTrace }
> {
  const invoiceId = (input.invoiceId || "").trim();
  const baseTrace = (): InvoicePaymentTrace => ({
    paymentId: input.paymentId ?? null,
    paymentInvoiceId: input.paymentInvoiceId ?? null,
    paymentCompanyId: input.paymentCompanyId ?? input.companyId,
    invoiceId: invoiceId || null,
    invoiceNumber: input.invoice?.invoiceNumber ?? null,
    invoiceCompanyId: input.invoice?.companyId ?? null,
    lookupCompanyId: input.companyId,
    lookupEntityType: ENTITY_INVOICE,
    lookupInternalId: invoiceId || null,
    realmId: input.realmId ?? null,
    mappingFound: false,
    mappingId: null,
    mappingInternalId: null,
    mappingCompanyId: null,
    mappingQuickbooksId: null,
    mappingStatus: null,
    mappingRealmId: null,
    eventInternalId: null,
    eventQuickbooksId: null,
    invoiceIdsEqual:
      input.paymentInvoiceId && invoiceId ? input.paymentInvoiceId === invoiceId : null,
    companyIdsEqual: null,
    reason: "unresolved",
  });

  if (!invoiceId) {
    return { error: INVOICE_MISSING_IN_QBO, review: true, trace: { ...baseTrace(), reason: "payment.invoiceId was empty" } };
  }

  const invoice =
    input.invoice && input.invoice.id === invoiceId
      ? input.invoice
      : await prisma.invoice.findFirst({
          where: { id: invoiceId, companyId: input.companyId },
          select: { id: true, companyId: true, invoiceNumber: true },
        });
  if (!invoice) {
    return {
      error: INVOICE_MISSING_IN_QBO,
      review: true,
      trace: { ...baseTrace(), reason: "no ContractorYou invoice row for payment.invoiceId" },
    };
  }

  const lookupCompanyId = invoice.companyId;
  const canonical = invoiceMappingIdentity({ companyId: lookupCompanyId, invoiceId: invoice.id });
  let row = await loadInvoiceMappingRow(prisma, { companyId: lookupCompanyId, invoiceId: invoice.id });
  let reason = row ? "canonical Invoice.id mapping" : "canonical mapping missing";

  if ((!isPersistedQboId(row?.quickbooksId) || row?.status === "FAILED") && invoice.invoiceNumber) {
    const byNumber = await loadInvoiceMappingRow(prisma, {
      companyId: lookupCompanyId,
      invoiceId: invoice.invoiceNumber,
    });
    if (byNumber && isPersistedQboId(byNumber.quickbooksId) && byNumber.status !== "FAILED") {
      row = await persistInvoiceMapping(prisma, {
        companyId: lookupCompanyId,
        invoiceId: invoice.id,
        quickbooksId: byNumber.quickbooksId,
        realmId: input.realmId ?? metadataRealm(byNumber.metadata),
      });
      reason = "repaired legacy mapping keyed by invoiceNumber onto Invoice.id";
    }
  }

  if (!isPersistedQboId(row?.quickbooksId) || row?.status === "FAILED") {
    const healed = await healInvoiceMappingFromEvent(prisma, {
      companyId: lookupCompanyId,
      invoiceId: invoice.id,
      realmId: input.realmId,
    });
    if (healed) {
      row = healed;
      reason = "healed from invoice.create/update event";
    } else if (invoice.invoiceNumber) {
      const numberedEvent = await prisma.quickBooksSyncEvent.findFirst({
        where: {
          companyId: lookupCompanyId,
          entityType: ENTITY_INVOICE,
          internalId: invoice.invoiceNumber,
          status: "SYNCED",
          quickbooksId: { not: null },
          action: { in: ["invoice.create", "invoice.update"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (isPersistedQboId(numberedEvent?.quickbooksId)) {
        row = await persistInvoiceMapping(prisma, {
          companyId: lookupCompanyId,
          invoiceId: invoice.id,
          quickbooksId: numberedEvent!.quickbooksId!,
          realmId: input.realmId,
        });
        reason = "healed event keyed by invoiceNumber onto Invoice.id";
      }
    }
  }

  const event = await prisma.quickBooksSyncEvent.findFirst({
    where: {
      companyId: lookupCompanyId,
      entityType: ENTITY_INVOICE,
      internalId: invoice.id,
      status: "SYNCED",
      action: { in: ["invoice.create", "invoice.update"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const trace: InvoicePaymentTrace = {
    ...baseTrace(),
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceCompanyId: invoice.companyId,
    lookupCompanyId,
    lookupInternalId: invoice.id,
    mappingFound: Boolean(row),
    mappingId: row?.id ?? null,
    mappingInternalId: row?.internalId ?? null,
    mappingCompanyId: row?.companyId ?? null,
    mappingQuickbooksId: row?.quickbooksId ?? null,
    mappingStatus: row?.status ?? null,
    mappingRealmId: metadataRealm(row?.metadata),
    eventInternalId: event?.internalId ?? null,
    eventQuickbooksId: event?.quickbooksId ?? null,
    invoiceIdsEqual: (input.paymentInvoiceId || invoiceId) === invoice.id,
    companyIdsEqual: (input.paymentCompanyId || input.companyId) === invoice.companyId,
    reason,
  };

  if (!isPersistedQboId(row?.quickbooksId)) {
    return {
      error: INVOICE_MISSING_IN_QBO,
      review: true,
      trace: { ...trace, reason: `${reason}; no persisted QBO Invoice.Id for this Invoice.id` },
    };
  }
  if (row!.status === "NEEDS_REVIEW" && row!.lastSyncError) {
    return { error: row!.lastSyncError, review: true, trace: { ...trace, reason: row!.lastSyncError } };
  }
  const savedRealm = metadataRealm(row!.metadata);
  if (input.realmId && savedRealm && savedRealm !== input.realmId) {
    await markItemMappingNeedsReview(prisma, {
      ...canonical,
      error: "This invoice mapping belongs to a different QuickBooks company.",
    });
    return {
      error: "This invoice mapping belongs to a different QuickBooks company.",
      review: true,
      trace: { ...trace, reason: "realmId on mapping does not match connected realm" },
    };
  }
  return { quickbooksId: row!.quickbooksId, invoiceId: invoice.id, identity: canonical };
}

export async function diagnoseCompanyInvoicePayments(prisma: PrismaClient, companyId: string) {
  const [invoices, payments, mappings, events, connection] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, status: { notIn: ["DRAFT", "VOID"] } },
      select: {
        id: true,
        invoiceNumber: true,
        companyId: true,
        customerId: true,
        jobId: true,
        status: true,
        totalCents: true,
        amountPaidCents: true,
        balanceCents: true,
        sourceSystem: true,
        externalId: true,
        importMode: true,
      },
      take: 20,
    }),
    prisma.payment.findMany({
      where: { companyId },
      select: {
        id: true,
        companyId: true,
        invoiceId: true,
        customerId: true,
        amountCents: true,
        status: true,
        provider: true,
        sourceSystem: true,
        externalId: true,
        externalRef: true,
        importMode: true,
      },
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
    prisma.quickBooksMapping.findMany({
      where: { companyId, entityType: { in: [ENTITY_INVOICE, ENTITY_PAYMENT] } },
    }),
    prisma.quickBooksSyncEvent.findMany({
      where: { companyId, entityType: { in: [ENTITY_INVOICE, ENTITY_PAYMENT] } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.integrationConnection.findFirst({
      where: { companyId, providerKey: "quickbooks_online" },
      select: { externalAccountId: true },
    }),
  ]);
  return {
    realmId: connection?.externalAccountId ?? null,
    invoices,
    payments,
    mappings: mappings.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      entityType: row.entityType,
      internalId: row.internalId,
      quickbooksId: row.quickbooksId,
      status: row.status,
      lastSyncError: row.lastSyncError,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    events: events.map((event) => ({
      action: event.action,
      entityType: event.entityType,
      internalId: event.internalId,
      quickbooksId: event.quickbooksId,
      status: event.status,
      errorMessage: event.errorMessage,
      createdAt: event.createdAt,
    })),
  };
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
