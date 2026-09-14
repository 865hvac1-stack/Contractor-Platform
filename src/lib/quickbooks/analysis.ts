import type { Prisma, PrismaClient } from "@prisma/client";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { mappingScopeWhere, type QuickBooksScope } from "@/lib/quickbooks/ownership";
import { loadQuickBooksProductionPreview } from "@/lib/quickbooks/production-preview";
import {
  INBOUND_LABELS,
  INBOUND_OBJECT_TYPES,
  MAPPING_ENTITY,
  type InboundObjectType,
} from "@/lib/quickbooks/inbound-types";
import { buildInboundCustomerIndex, classifyInboundCustomer, classifyPricebookItem } from "@/lib/quickbooks/inbound-match";
import {
  qboCount,
  qboPage,
  readOnlyQuickBooksTransport,
  type QboAddress,
} from "@/lib/quickbooks/read-only";

const PAGE = 50;
const BUDGET_MS = 8_000;

export type AnalysisCheckpoint = {
  customerStart: number;
  vendorStart: number;
  itemStart: number;
  accountStart: number;
  invoiceStart: number;
  paymentStart: number;
  purchaseStart: number;
  finished: boolean;
};

const EMPTY_CHECKPOINT: AnalysisCheckpoint = {
  customerStart: 1,
  vendorStart: 1,
  itemStart: 1,
  accountStart: 1,
  invoiceStart: 1,
  paymentStart: 1,
  purchaseStart: 1,
  finished: false,
};

type QboCustomer = {
  Id?: string;
  DisplayName?: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  Active?: boolean;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: QboAddress;
  ShipAddr?: QboAddress;
  Notes?: string;
  MetaData?: { LastUpdatedTime?: string };
};

type QboItem = {
  Id?: string;
  Name?: string;
  Sku?: string;
  Active?: boolean;
  Type?: string;
  Description?: string;
  UnitPrice?: number;
  PurchaseCost?: number;
};

type QboInvoice = {
  Id?: string;
  DocNumber?: string;
  Balance?: number;
  TotalAmt?: number;
  PrivateNote?: string;
  CustomerRef?: { value?: string };
};

type QboPayment = {
  Id?: string;
  TotalAmt?: number;
  CustomerRef?: { value?: string };
  Line?: Array<{ LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }> }>;
};

type QboPurchase = {
  Id?: string;
  TotalAmt?: number;
  EntityRef?: { value?: string; name?: string };
  AccountRef?: { value?: string; name?: string };
  PaymentType?: string;
  PrivateNote?: string;
};

type QboVendor = { Id?: string; DisplayName?: string; Active?: boolean };
type QboAccount = { Id?: string; Name?: string; AccountType?: string; AccountSubType?: string; Active?: boolean };

export type ImportPlan = {
  generatedAt: string;
  writeBack: "disabled";
  stages: Array<{
    stage: number;
    objects: InboundObjectType[];
    summary: string;
  }>;
  approvalsRequired: string[];
  categories: Record<
    InboundObjectType,
    {
      availableInQbo: number;
      alreadyLinked: number;
      exact: number;
      high: number;
      possible: number;
      none: number;
      newCount: number;
      missingRelationships: number;
      skipped: number;
      details: Record<string, number>;
    }
  >;
};

export type AnalysisProgress = {
  category: InboundObjectType | "COMPLETE";
  categoryLabel: string;
  recordsExamined: number;
  totalAvailable: number;
  percent: number;
};

function emptyCategory() {
  return {
    availableInQbo: 0,
    alreadyLinked: 0,
    exact: 0,
    high: 0,
    possible: 0,
    none: 0,
    newCount: 0,
    missingRelationships: 0,
    skipped: 0,
    details: {} as Record<string, number>,
  };
}

async function mappingCount(prisma: PrismaClient, scope: QuickBooksScope, objectType: InboundObjectType) {
  return prisma.quickBooksMapping.count({
    where: { ...mappingScopeWhere(scope), entityType: MAPPING_ENTITY[objectType] },
  });
}

async function upsertReview(
  prisma: PrismaClient,
  input: {
    companyId: string;
    scope: QuickBooksScope;
    runId: string;
    objectType: InboundObjectType;
    quickbooksId: string;
    displayName: string;
    confidence: string;
    proposedInternalId?: string | null;
    proposedAction: string;
    reason: string;
    payload: object;
    matchSignals?: unknown;
  }
) {
  await prisma.quickBooksImportReview.upsert({
    where: {
      companyId_environment_realmId_objectType_quickbooksId: {
        companyId: input.companyId,
        environment: input.scope.environment,
        realmId: input.scope.realmId,
        objectType: input.objectType,
        quickbooksId: input.quickbooksId,
      },
    },
    create: {
      companyId: input.companyId,
      runId: input.runId,
      environment: input.scope.environment,
      realmId: input.scope.realmId,
      objectType: input.objectType,
      quickbooksId: input.quickbooksId,
      displayName: input.displayName,
      confidence: input.confidence,
      status: input.proposedAction === "REVIEW" ? "OPEN" : "READY",
      proposedInternalId: input.proposedInternalId ?? null,
      proposedAction: input.proposedAction,
      reason: input.reason,
      payload: input.payload as Prisma.InputJsonValue,
      matchSignals: input.matchSignals as Prisma.InputJsonValue,
    },
    update: {
      runId: input.runId,
      displayName: input.displayName,
      confidence: input.confidence,
      proposedInternalId: input.proposedInternalId ?? null,
      proposedAction: input.proposedAction,
      reason: input.reason,
      payload: input.payload as Prisma.InputJsonValue,
      matchSignals: input.matchSignals as Prisma.InputJsonValue,
      status: input.proposedAction === "REVIEW" ? "OPEN" : "READY",
      errorMessage: null,
    },
  });
}

export async function runQuickBooksImportAnalysis(input: {
  prisma: PrismaClient;
  companyId: string;
  userId: string;
  resumeRunId?: string | null;
}) {
  const loaded = await loadQuickBooksTransport(input.companyId);
  if (!loaded.ok) return { ok: false as const, error: loaded.error };
  const transport = readOnlyQuickBooksTransport(loaded.transport);
  const scope = loaded.scope;
  const prisma = input.prisma;

  let run = input.resumeRunId
    ? await prisma.quickBooksSyncRun.findFirst({
        where: { id: input.resumeRunId, companyId: input.companyId, type: "ANALYSIS" },
      })
    : null;
  if (!run) {
    run = await prisma.quickBooksSyncRun.create({
      data: {
        companyId: input.companyId,
        initiatedById: input.userId,
        realmId: scope.realmId,
        environment: scope.environment,
        type: "ANALYSIS",
        status: "RUNNING",
        writeBackAttempted: false,
        checkpoint: EMPTY_CHECKPOINT,
      },
    });
  } else {
    await prisma.quickBooksSyncRun.update({
      where: { id: run.id },
      data: { status: "RUNNING", errorMessage: null, writeBackAttempted: false },
    });
  }

  await prisma.quickBooksSettings.upsert({
    where: { companyId: input.companyId },
    create: {
      companyId: input.companyId,
      lastAttemptedInboundSyncAt: new Date(),
      inboundSyncHealth: "ANALYZING",
    },
    update: { lastAttemptedInboundSyncAt: new Date(), inboundSyncHealth: "ANALYZING" },
  });

  const checkpoint: AnalysisCheckpoint = {
    ...EMPTY_CHECKPOINT,
    ...((run.checkpoint as AnalysisCheckpoint | null) ?? {}),
  };

  const preview = await loadQuickBooksProductionPreview(prisma, input.companyId).catch(() => null);
  const counts: Record<InboundObjectType, number> = {
    CUSTOMER: preview?.customers.count ?? 0,
    INVOICE: preview?.invoices.count ?? 0,
    PAYMENT: preview?.payments.count ?? 0,
    ITEM: preview?.items.count ?? 0,
    PURCHASE: preview?.expenses.count ?? 0,
    VENDOR: 0,
    ACCOUNT: 0,
  };
  if (!preview) {
    for (const objectType of INBOUND_OBJECT_TYPES) {
      const entity = objectType === "PURCHASE" ? "Purchase" : objectType === "ITEM" ? "Item" : title(objectType);
      const counted = await qboCount(transport, entity);
      counts[objectType] = counted.count;
    }
  } else {
    counts.VENDOR = (await qboCount(transport, "Vendor")).count;
    counts.ACCOUNT = (await qboCount(transport, "Account")).count;
  }

  const linked: Record<InboundObjectType, number> = {
    CUSTOMER: await mappingCount(prisma, scope, "CUSTOMER"),
    VENDOR: await mappingCount(prisma, scope, "VENDOR"),
    ITEM: await mappingCount(prisma, scope, "ITEM"),
    ACCOUNT: await mappingCount(prisma, scope, "ACCOUNT"),
    INVOICE: await mappingCount(prisma, scope, "INVOICE"),
    PAYMENT: await mappingCount(prisma, scope, "PAYMENT"),
    PURCHASE: await mappingCount(prisma, scope, "PURCHASE"),
  };

  const previousCategories = await prisma.quickBooksSyncRunCategory.findMany({
    where: { runId: run.id },
  });
  const plan = restorePlan(counts, linked, previousCategories);
  const started = Date.now();
  let examined = run.recordsExamined;
  let conflicts = run.conflictCount;
  let failed = run.failedCount;

  const existingCustomers = await prisma.customer.findMany({
    where: { companyId: input.companyId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      email: true,
      phone: true,
      sourceSystem: true,
      externalId: true,
      quickbooksCustomerId: true,
      properties: { select: { address: true, city: true, zip: true } },
    },
  });
  const customerMaps = await prisma.quickBooksMapping.findMany({
    where: { ...mappingScopeWhere(scope), entityType: "CUSTOMER" },
    select: { internalId: true, quickbooksId: true },
  });
  const index = buildInboundCustomerIndex(
    existingCustomers.map((row) => ({
      ...row,
      externalId: row.quickbooksCustomerId || row.externalId,
      sourceSystem: row.quickbooksCustomerId ? QUICKBOOKS_PROVIDER_KEY : row.sourceSystem,
    })),
    customerMaps.map((row) => ({ customerId: row.internalId, quickbooksId: row.quickbooksId }))
  );
  const mappedCustomerByQbo = new Map(customerMaps.map((row) => [row.quickbooksId, row.internalId]));

  try {
    while (!checkpoint.finished && Date.now() - started < BUDGET_MS) {
      if (checkpoint.customerStart > 0) {
        const page = await qboPage<QboCustomer>(transport, "Customer", "Customer", checkpoint.customerStart, PAGE);
        if (!page.ok) {
          failed += 1;
          break;
        }
        if (!page.rows.length) checkpoint.customerStart = 0;
        for (const row of page.rows) {
          if (!row.Id) continue;
          examined += 1;
          const match = classifyInboundCustomer(index, {
            quickbooksId: row.Id,
            displayName: row.DisplayName,
            givenName: row.GivenName,
            familyName: row.FamilyName,
            companyName: row.CompanyName,
            email: row.PrimaryEmailAddr?.Address,
            phone: row.PrimaryPhone?.FreeFormNumber,
            billAddr: row.BillAddr,
            shipAddr: row.ShipAddr,
          }, mappedCustomerByQbo.get(row.Id));
          bumpConfidence(plan, "CUSTOMER", match.confidence);
          if (match.confidence === "NONE") plan.CUSTOMER.newCount += 1;
          if (match.confidence === "POSSIBLE") {
            plan.CUSTOMER.possible += 0;
            conflicts += 1;
          }
          await upsertReview(prisma, {
            companyId: input.companyId,
            scope,
            runId: run.id,
            objectType: "CUSTOMER",
            quickbooksId: row.Id,
            displayName: row.DisplayName || row.CompanyName || row.Id,
            confidence: match.confidence,
            proposedInternalId: match.customerId,
            proposedAction: match.proposedAction,
            reason: match.reason,
            payload: row,
            matchSignals: match.signals,
          });
        }
        if (page.rows.length) checkpoint.customerStart += page.rows.length;
        if (page.rows.length < PAGE) checkpoint.customerStart = 0;
        if (Date.now() - started >= BUDGET_MS) break;
      }

      if (checkpoint.itemStart > 0) {
        const pricebook = await prisma.pricebookItem.findMany({
          where: { companyId: input.companyId },
          select: { id: true, name: true, sku: true, quickbooksItemId: true, externalId: true },
        });
        const itemMaps = await prisma.quickBooksMapping.findMany({
          where: { ...mappingScopeWhere(scope), entityType: "ITEM" },
          select: { internalId: true, quickbooksId: true },
        });
        const mappedItems = new Map(itemMaps.map((row) => [row.quickbooksId, row.internalId]));
        const page = await qboPage<QboItem>(transport, "Item", "Item", checkpoint.itemStart, PAGE);
        if (!page.ok) {
          failed += 1;
          break;
        }
        if (!page.rows.length) checkpoint.itemStart = 0;
        for (const row of page.rows) {
          if (!row.Id) continue;
          examined += 1;
          const nameMatches = pricebook.filter((item) => item.name.trim().toLowerCase() === (row.Name || "").trim().toLowerCase());
          const skuMatches = row.Sku
            ? pricebook.filter((item) => (item.sku || "").trim().toLowerCase() === row.Sku!.trim().toLowerCase())
            : [];
          const match = classifyPricebookItem({
            quickbooksId: row.Id,
            name: row.Name || row.Id,
            sku: row.Sku,
            mappedItemId: mappedItems.get(row.Id) || pricebook.find((item) => item.quickbooksItemId === row.Id || item.externalId === row.Id)?.id,
            nameMatches,
            skuMatches,
          });
          bumpConfidence(plan, "ITEM", match.confidence);
          if (match.confidence === "NONE") plan.ITEM.newCount += 1;
          if (row.Active === false) plan.ITEM.details.inactive = (plan.ITEM.details.inactive ?? 0) + 1;
          await upsertReview(prisma, {
            companyId: input.companyId,
            scope,
            runId: run.id,
            objectType: "ITEM",
            quickbooksId: row.Id,
            displayName: row.Name || row.Id,
            confidence: match.confidence,
            proposedInternalId: match.itemId,
            proposedAction: match.proposedAction,
            reason: match.reason,
            payload: row,
          });
        }
        if (page.rows.length) checkpoint.itemStart += page.rows.length;
        if (page.rows.length < PAGE) checkpoint.itemStart = 0;
        if (Date.now() - started >= BUDGET_MS) break;
      }

      if (checkpoint.invoiceStart > 0) {
        const page = await qboPage<QboInvoice>(transport, "Invoice", "Invoice", checkpoint.invoiceStart, PAGE);
        if (!page.ok) {
          failed += 1;
          break;
        }
        if (!page.rows.length) checkpoint.invoiceStart = 0;
        const invoiceMaps = await prisma.quickBooksMapping.findMany({
          where: { ...mappingScopeWhere(scope), entityType: "INVOICE" },
          select: { quickbooksId: true },
        });
        const knownInvoices = new Set(invoiceMaps.map((row) => row.quickbooksId));
        for (const row of page.rows) {
          if (!row.Id) continue;
          examined += 1;
          const linkedInvoice = knownInvoices.has(row.Id);
          const customerFound = Boolean(row.CustomerRef?.value && mappedCustomerByQbo.has(row.CustomerRef.value));
          if (linkedInvoice) plan.INVOICE.details.alreadyImported = (plan.INVOICE.details.alreadyImported ?? 0) + 1;
          else plan.INVOICE.newCount += 1;
          if (customerFound) plan.INVOICE.details.customerFound = (plan.INVOICE.details.customerFound ?? 0) + 1;
          else {
            plan.INVOICE.missingRelationships += 1;
            plan.INVOICE.details.customerMissing = (plan.INVOICE.details.customerMissing ?? 0) + 1;
          }
          if ((row.Balance ?? 0) > 0) plan.INVOICE.details.open = (plan.INVOICE.details.open ?? 0) + 1;
          else plan.INVOICE.details.paid = (plan.INVOICE.details.paid ?? 0) + 1;
          if (/void/i.test(row.PrivateNote || "") || /void/i.test(row.DocNumber || "")) {
            plan.INVOICE.details.voided = (plan.INVOICE.details.voided ?? 0) + 1;
          }
          if (!linkedInvoice && !customerFound) {
            await upsertReview(prisma, {
              companyId: input.companyId,
              scope,
              runId: run.id,
              objectType: "INVOICE",
              quickbooksId: row.Id,
              displayName: row.DocNumber || row.Id,
              confidence: "POSSIBLE",
              proposedAction: "REVIEW",
              reason: "Invoice customer is not linked in ContractorYou yet.",
              payload: row,
            });
            conflicts += 1;
          }
        }
        if (page.rows.length) checkpoint.invoiceStart += page.rows.length;
        if (page.rows.length < PAGE) checkpoint.invoiceStart = 0;
        if (Date.now() - started >= BUDGET_MS) break;
      }

      if (checkpoint.paymentStart > 0) {
        const page = await qboPage<QboPayment>(transport, "Payment", "Payment", checkpoint.paymentStart, PAGE);
        if (!page.ok) {
          failed += 1;
          break;
        }
        if (!page.rows.length) checkpoint.paymentStart = 0;
        const paymentMaps = await prisma.quickBooksMapping.findMany({
          where: { ...mappingScopeWhere(scope), entityType: "PAYMENT" },
          select: { quickbooksId: true },
        });
        const knownPayments = new Set(paymentMaps.map((row) => row.quickbooksId));
        const invoiceMaps = await prisma.quickBooksMapping.findMany({
          where: { ...mappingScopeWhere(scope), entityType: "INVOICE" },
          select: { quickbooksId: true },
        });
        const knownInvoices = new Set(invoiceMaps.map((row) => row.quickbooksId));
        for (const row of page.rows) {
          if (!row.Id) continue;
          examined += 1;
          const linkedInvoiceId = row.Line?.flatMap((line) => line.LinkedTxn || []).find((txn) => txn.TxnType === "Invoice")?.TxnId;
          if (knownPayments.has(row.Id)) plan.PAYMENT.details.alreadyImported = (plan.PAYMENT.details.alreadyImported ?? 0) + 1;
          else plan.PAYMENT.newCount += 1;
          if (linkedInvoiceId && knownInvoices.has(linkedInvoiceId)) plan.PAYMENT.details.invoiceFound = (plan.PAYMENT.details.invoiceFound ?? 0) + 1;
          else {
            plan.PAYMENT.missingRelationships += 1;
            plan.PAYMENT.details.invoiceMissing = (plan.PAYMENT.details.invoiceMissing ?? 0) + 1;
          }
          if (row.CustomerRef?.value && mappedCustomerByQbo.has(row.CustomerRef.value)) {
            plan.PAYMENT.details.customerFound = (plan.PAYMENT.details.customerFound ?? 0) + 1;
          } else {
            plan.PAYMENT.details.customerMissing = (plan.PAYMENT.details.customerMissing ?? 0) + 1;
            plan.PAYMENT.missingRelationships += 1;
          }
        }
        if (page.rows.length) checkpoint.paymentStart += page.rows.length;
        if (page.rows.length < PAGE) checkpoint.paymentStart = 0;
        if (Date.now() - started >= BUDGET_MS) break;
      }

      if (checkpoint.purchaseStart > 0) {
        const page = await qboPage<QboPurchase>(transport, "Purchase", "Purchase", checkpoint.purchaseStart, PAGE);
        if (!page.ok) {
          failed += 1;
          break;
        }
        if (!page.rows.length) checkpoint.purchaseStart = 0;
        const purchaseMaps = await prisma.quickBooksMapping.findMany({
          where: { ...mappingScopeWhere(scope), entityType: "EXPENSE" },
          select: { quickbooksId: true },
        });
        const known = new Set(purchaseMaps.map((row) => row.quickbooksId));
        for (const row of page.rows) {
          if (!row.Id) continue;
          examined += 1;
          if (known.has(row.Id)) plan.PURCHASE.details.alreadyImported = (plan.PURCHASE.details.alreadyImported ?? 0) + 1;
          else plan.PURCHASE.newCount += 1;
          if (row.EntityRef?.value) plan.PURCHASE.details.vendorPresent = (plan.PURCHASE.details.vendorPresent ?? 0) + 1;
          else plan.PURCHASE.details.vendorMissing = (plan.PURCHASE.details.vendorMissing ?? 0) + 1;
          if (row.AccountRef?.value) plan.PURCHASE.details.accountPresent = (plan.PURCHASE.details.accountPresent ?? 0) + 1;
          else plan.PURCHASE.details.accountMissing = (plan.PURCHASE.details.accountMissing ?? 0) + 1;
        }
        if (page.rows.length) checkpoint.purchaseStart += page.rows.length;
        if (page.rows.length < PAGE) checkpoint.purchaseStart = 0;
        if (Date.now() - started >= BUDGET_MS) break;
      }

      if (checkpoint.vendorStart > 0) {
        const page = await qboPage<QboVendor>(transport, "Vendor", "Vendor", checkpoint.vendorStart, PAGE);
        if (!page.ok) {
          failed += 1;
          break;
        }
        if (!page.rows.length) checkpoint.vendorStart = 0;
        for (const row of page.rows) {
          if (!row.Id) continue;
          examined += 1;
          const existing = await prisma.vendor.findFirst({
            where: { companyId: input.companyId, OR: [{ quickbooksVendorId: row.Id }, { externalId: row.Id }] },
            select: { id: true },
          });
          if (existing) plan.VENDOR.alreadyLinked += 0;
          else plan.VENDOR.newCount += 1;
        }
        if (page.rows.length) checkpoint.vendorStart += page.rows.length;
        if (page.rows.length < PAGE) checkpoint.vendorStart = 0;
        if (Date.now() - started >= BUDGET_MS) break;
      }

      if (checkpoint.accountStart > 0) {
        const page = await qboPage<QboAccount>(transport, "Account", "Account", checkpoint.accountStart, PAGE);
        if (!page.ok) {
          failed += 1;
          break;
        }
        if (!page.rows.length) checkpoint.accountStart = 0;
        for (const row of page.rows) {
          if (!row.Id) continue;
          examined += 1;
          const existing = await prisma.accountingAccount.findFirst({
            where: { companyId: input.companyId, OR: [{ quickbooksAccountId: row.Id }, { externalId: row.Id }] },
            select: { id: true },
          });
          if (!existing) plan.ACCOUNT.newCount += 1;
        }
        if (page.rows.length) checkpoint.accountStart += page.rows.length;
        if (page.rows.length < PAGE) checkpoint.accountStart = 0;
      }

      checkpoint.finished = [
        checkpoint.customerStart,
        checkpoint.itemStart,
        checkpoint.invoiceStart,
        checkpoint.paymentStart,
        checkpoint.purchaseStart,
        checkpoint.vendorStart,
        checkpoint.accountStart,
      ].every((value) => value === 0);
    }
  } catch (error) {
    failed += 1;
    await prisma.quickBooksSyncRun.update({
      where: { id: run.id },
      data: {
        status: "PAUSED",
        failedCount: failed,
        recordsExamined: examined,
        conflictCount: conflicts,
        checkpoint,
        errorMessage: error instanceof Error ? error.message : "Analysis paused after an isolated error.",
        writeBackAttempted: false,
      },
    });
    return {
      ok: true as const,
      runId: run.id,
      paused: true,
      finished: false,
      autoContinue: false,
      plan: toImportPlan(plan),
      progress: analysisProgress(checkpoint, examined, counts),
    };
  }

  const importPlan = toImportPlan(plan);
  const finished = checkpoint.finished;
  await persistCategoryRows(prisma, run.id, plan, linked, counts);
  await prisma.quickBooksSyncRun.update({
    where: { id: run.id },
    data: {
      status: finished ? "COMPLETE" : "PAUSED",
      completedAt: finished ? new Date() : null,
      recordsExamined: examined,
      conflictCount: conflicts,
      failedCount: failed,
      checkpoint,
      plan: importPlan as Prisma.InputJsonValue,
      writeBackAttempted: false,
    },
  });
  if (finished) {
    await prisma.quickBooksSettings.update({
      where: { companyId: input.companyId },
      data: { lastSuccessfulInboundSyncAt: new Date(), inboundSyncHealth: "READY" },
    });
  }
  return {
    ok: true as const,
    runId: run.id,
    paused: !finished,
    finished,
    autoContinue: !finished && failed === run.failedCount,
    plan: importPlan,
    progress: analysisProgress(checkpoint, examined, counts),
  };
}

function title(objectType: InboundObjectType) {
  return objectType[0] + objectType.slice(1).toLowerCase();
}

function emptyPlan(counts: Record<InboundObjectType, number>, linked: Record<InboundObjectType, number>) {
  const plan = {} as Record<InboundObjectType, ReturnType<typeof emptyCategory>>;
  for (const objectType of INBOUND_OBJECT_TYPES) {
    plan[objectType] = { ...emptyCategory(), availableInQbo: counts[objectType], alreadyLinked: linked[objectType] };
  }
  return plan;
}

function restorePlan(
  counts: Record<InboundObjectType, number>,
  linked: Record<InboundObjectType, number>,
  previous: Array<{
    objectType: string;
    newCount: number;
    updatedCount: number;
    duplicateCount: number;
    conflictCount: number;
    skippedCount: number;
    details: Prisma.JsonValue | null;
  }>
) {
  const plan = emptyPlan(counts, linked);
  for (const saved of previous) {
    if (!INBOUND_OBJECT_TYPES.includes(saved.objectType as InboundObjectType)) continue;
    const objectType = saved.objectType as InboundObjectType;
    const details =
      saved.details && typeof saved.details === "object" && !Array.isArray(saved.details)
        ? (saved.details as Record<string, number>)
        : {};
    plan[objectType] = {
      ...plan[objectType],
      newCount: saved.newCount,
      possible: saved.duplicateCount,
      missingRelationships: saved.conflictCount,
      skipped: saved.skippedCount,
      exact: Number(details.exact ?? 0),
      high: Number(details.high ?? 0),
      none: Number(details.none ?? 0),
      details,
    };
  }
  return plan;
}

export function analysisProgress(
  checkpoint: AnalysisCheckpoint,
  recordsExamined: number,
  counts: Record<InboundObjectType, number>
): AnalysisProgress {
  const order: Array<[keyof AnalysisCheckpoint, InboundObjectType]> = [
    ["customerStart", "CUSTOMER"],
    ["itemStart", "ITEM"],
    ["invoiceStart", "INVOICE"],
    ["paymentStart", "PAYMENT"],
    ["purchaseStart", "PURCHASE"],
    ["vendorStart", "VENDOR"],
    ["accountStart", "ACCOUNT"],
  ];
  const current = order.find(([key]) => key !== "finished" && Number(checkpoint[key]) > 0)?.[1] ?? "COMPLETE";
  const totalAvailable = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    category: current,
    categoryLabel: current === "COMPLETE" ? "Complete" : INBOUND_LABELS[current],
    recordsExamined,
    totalAvailable,
    percent: checkpoint.finished
      ? 100
      : totalAvailable
        ? Math.min(99, Math.round((recordsExamined / totalAvailable) * 100))
        : 0,
  };
}

function bumpConfidence(
  plan: Record<InboundObjectType, ReturnType<typeof emptyCategory>>,
  objectType: InboundObjectType,
  confidence: string
) {
  if (confidence === "EXACT") plan[objectType].exact += 1;
  else if (confidence === "HIGH") plan[objectType].high += 1;
  else if (confidence === "POSSIBLE") plan[objectType].possible += 1;
  else plan[objectType].none += 1;
}

function toImportPlan(plan: Record<InboundObjectType, ReturnType<typeof emptyCategory>>): ImportPlan {
  return {
    generatedAt: new Date().toISOString(),
    writeBack: "disabled",
    stages: [
      { stage: 1, objects: ["CUSTOMER"], summary: "Link or create approved customers. Possible matches stay in review." },
      { stage: 2, objects: ["VENDOR", "ITEM", "ACCOUNT"], summary: "Map vendors, products/services, and accounts before transactions." },
      { stage: 3, objects: ["INVOICE"], summary: "Import invoices only when the customer is linked." },
      { stage: 4, objects: ["PAYMENT"], summary: "Import payments only when the invoice and customer exist." },
      { stage: 5, objects: ["PURCHASE"], summary: "Import expenses as company financial activity, never as customer payments." },
    ],
    approvalsRequired: [
      "Possible customer matches must be reviewed before import.",
      "Type the confirmation phrase to import approved records for one stage only.",
      "QuickBooks write-back remains disabled.",
    ],
    categories: plan,
  };
}

async function persistCategoryRows(
  prisma: PrismaClient,
  runId: string,
  plan: Record<InboundObjectType, ReturnType<typeof emptyCategory>>,
  linked: Record<InboundObjectType, number>,
  counts: Record<InboundObjectType, number>
) {
  for (const objectType of INBOUND_OBJECT_TYPES) {
    const row = plan[objectType];
    await prisma.quickBooksSyncRunCategory.upsert({
      where: { runId_objectType: { runId, objectType } },
      create: {
        runId,
        objectType,
        availableInQbo: counts[objectType],
        alreadyLinked: linked[objectType],
        newCount: row.newCount,
        updatedCount: row.high + row.exact,
        duplicateCount: row.possible,
        conflictCount: row.missingRelationships,
        skippedCount: row.skipped,
        failedCount: 0,
        details: {
          ...row.details,
          exact: row.exact,
          high: row.high,
          possible: row.possible,
          none: row.none,
          missingRelationships: row.missingRelationships,
        },
      },
      update: {
        availableInQbo: counts[objectType],
        alreadyLinked: linked[objectType],
        newCount: row.newCount,
        updatedCount: row.high + row.exact,
        duplicateCount: row.possible,
        conflictCount: row.missingRelationships,
        details: {
          ...row.details,
          exact: row.exact,
          high: row.high,
          possible: row.possible,
          none: row.none,
          missingRelationships: row.missingRelationships,
        },
      },
    });
  }
}

export { INBOUND_LABELS };
