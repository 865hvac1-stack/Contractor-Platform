import type { PrismaClient } from "@prisma/client";
import { IMPORT_MODE_HISTORICAL } from "@/lib/imports/modes";
import { QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";
import { splitFullName } from "@/lib/imports/normalize";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { mappingScopeWhere, type QuickBooksScope } from "@/lib/quickbooks/ownership";
import {
  dollarsToCents,
  parseQboDate,
  qboPage,
  readOnlyQuickBooksTransport,
  usableServiceAddress,
  type QboAddress,
} from "@/lib/quickbooks/read-only";
import { classifyAccountType } from "@/lib/quickbooks/inbound-match";
import { upsertInboundMapping } from "@/lib/quickbooks/inbound-mapping";
import {
  IMPORT_CONFIRMATION,
  INBOUND_STAGES,
  type InboundObjectType,
} from "@/lib/quickbooks/inbound-types";
import { QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE } from "@/lib/quickbooks/writeback";

const PAGE = 50;
const BUDGET_MS = 18_000;

type Checkpoint = { start: number; finished: boolean };

type QboCustomer = {
  Id?: string;
  SyncToken?: string;
  DisplayName?: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  Active?: boolean;
  Notes?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: QboAddress;
  ShipAddr?: QboAddress;
  MetaData?: { LastUpdatedTime?: string };
};

type QboVendor = {
  Id?: string;
  DisplayName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Active?: boolean;
  Notes?: string;
};

type QboAccount = {
  Id?: string;
  Name?: string;
  FullyQualifiedName?: string;
  AccountType?: string;
  AccountSubType?: string;
  Active?: boolean;
};

type QboItem = {
  Id?: string;
  Name?: string;
  Sku?: string;
  Description?: string;
  Type?: string;
  Active?: boolean;
  UnitPrice?: number;
  PurchaseCost?: number;
  IncomeAccountRef?: { name?: string };
  ExpenseAccountRef?: { name?: string };
  SalesTaxCodeRef?: { value?: string };
};

type QboInvoice = {
  Id?: string;
  SyncToken?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  PrivateNote?: string;
  CustomerRef?: { value?: string };
  Line?: Array<{
    Id?: string;
    Amount?: number;
    Description?: string;
    DetailType?: string;
    SalesItemLineDetail?: { ItemRef?: { value?: string; name?: string }; Qty?: number; UnitPrice?: number };
  }>;
  MetaData?: { LastUpdatedTime?: string };
};

type QboPayment = {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: number;
  PaymentMethodRef?: { name?: string };
  PaymentRefNum?: string;
  DepositToAccountRef?: { name?: string };
  CustomerRef?: { value?: string };
  Line?: Array<{ LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }> }>;
  MetaData?: { LastUpdatedTime?: string };
};

type QboPurchase = {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: number;
  PaymentType?: string;
  PrivateNote?: string;
  EntityRef?: { value?: string; name?: string };
  AccountRef?: { value?: string; name?: string };
  MetaData?: { LastUpdatedTime?: string };
};

export function assertImportConfirmation(value: string) {
  return value.trim() === IMPORT_CONFIRMATION;
}

function stageIncludes(stage: number, objectType: InboundObjectType) {
  return (INBOUND_STAGES[stage - 1] ?? []).includes(objectType);
}

export async function importApprovedQuickBooksRecords(input: {
  prisma: PrismaClient;
  companyId: string;
  userId: string;
  stage: number;
  confirmation: string;
  resumeRunId?: string | null;
}) {
  if (!assertImportConfirmation(input.confirmation)) {
    return { ok: false as const, error: `Type ${IMPORT_CONFIRMATION} to import approved records. Nothing was imported.` };
  }
  if (input.stage < 1 || input.stage > 5) {
    return { ok: false as const, error: "Choose a valid import stage (1–5)." };
  }
  const loaded = await loadQuickBooksTransport(input.companyId);
  if (!loaded.ok) return { ok: false as const, error: loaded.error };
  const transport = readOnlyQuickBooksTransport(loaded.transport);
  const prisma = input.prisma;
  const scope = loaded.scope;

  let run = input.resumeRunId
    ? await prisma.quickBooksSyncRun.findFirst({
        where: { id: input.resumeRunId, companyId: input.companyId, type: "IMPORT", objectType: `STAGE_${input.stage}` },
      })
    : null;
  if (!run) {
    run = await prisma.quickBooksSyncRun.create({
      data: {
        companyId: input.companyId,
        initiatedById: input.userId,
        realmId: scope.realmId,
        environment: scope.environment,
        type: "IMPORT",
        objectType: `STAGE_${input.stage}`,
        status: "RUNNING",
        writeBackAttempted: false,
        checkpoint: { start: 1, finished: false } satisfies Checkpoint,
      },
    });
  }

  const checkpoint: Checkpoint = { start: 1, finished: false, ...((run.checkpoint as Checkpoint | null) ?? {}) };
  const started = Date.now();
  const stats = {
    examined: run.recordsExamined,
    created: run.createdCount,
    updated: run.updatedCount,
    linked: run.linkedCount,
    skipped: run.skippedCount,
    failed: run.failedCount,
    conflicts: run.conflictCount,
  };

  try {
    if (stageIncludes(input.stage, "CUSTOMER")) {
      await importCustomers({ prisma, companyId: input.companyId, userId: input.userId, scope, transport, checkpoint, stats, started, runId: run.id });
    }
    if (stageIncludes(input.stage, "VENDOR") && Date.now() - started < BUDGET_MS) {
      checkpoint.start = 1;
      await importVendors({ prisma, companyId: input.companyId, scope, transport, checkpoint, stats, started, runId: run.id });
    }
    if (stageIncludes(input.stage, "ACCOUNT") && Date.now() - started < BUDGET_MS) {
      checkpoint.start = 1;
      await importAccounts({ prisma, companyId: input.companyId, scope, transport, checkpoint, stats, started });
    }
    if (stageIncludes(input.stage, "ITEM") && Date.now() - started < BUDGET_MS) {
      checkpoint.start = 1;
      await importItems({ prisma, companyId: input.companyId, scope, transport, checkpoint, stats, started, runId: run.id });
    }
    if (stageIncludes(input.stage, "INVOICE") && Date.now() - started < BUDGET_MS) {
      await importInvoices({ prisma, companyId: input.companyId, scope, transport, checkpoint, stats, started, runId: run.id });
    }
    if (stageIncludes(input.stage, "PAYMENT") && Date.now() - started < BUDGET_MS) {
      await importPayments({ prisma, companyId: input.companyId, scope, transport, checkpoint, stats, started, runId: run.id });
    }
    if (stageIncludes(input.stage, "PURCHASE") && Date.now() - started < BUDGET_MS) {
      await importPurchases({ prisma, companyId: input.companyId, userId: input.userId, scope, transport, checkpoint, stats, started, runId: run.id });
    }
  } catch (error) {
    await finishRun(prisma, run.id, input.companyId, stats, checkpoint, false, error instanceof Error ? error.message : "Import paused.");
    return { ok: true as const, runId: run.id, paused: true, ...stats, writeBack: QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE };
  }

  await finishRun(prisma, run.id, input.companyId, stats, checkpoint, checkpoint.finished, null);
  return { ok: true as const, runId: run.id, paused: !checkpoint.finished, ...stats, writeBack: QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE };
}

async function finishRun(
  prisma: PrismaClient,
  runId: string,
  companyId: string,
  stats: { examined: number; created: number; updated: number; linked: number; skipped: number; failed: number; conflicts: number },
  checkpoint: Checkpoint,
  finished: boolean,
  error: string | null
) {
  await prisma.quickBooksSyncRun.update({
    where: { id: runId },
    data: {
      status: finished ? "COMPLETE" : "PAUSED",
      completedAt: finished ? new Date() : null,
      recordsExamined: stats.examined,
      createdCount: stats.created,
      updatedCount: stats.updated,
      linkedCount: stats.linked,
      skippedCount: stats.skipped,
      failedCount: stats.failed,
      conflictCount: stats.conflicts,
      checkpoint,
      errorMessage: error,
      writeBackAttempted: false,
    },
  });
  await prisma.quickBooksSettings.updateMany({
    where: { companyId },
    data: {
      lastAttemptedInboundSyncAt: new Date(),
      lastSuccessfulInboundSyncAt: finished ? new Date() : undefined,
      inboundSyncHealth: finished ? "IMPORTED" : "PAUSED",
    },
  });
}

type LoopCtx = {
  prisma: PrismaClient;
  companyId: string;
  userId?: string;
  scope: QuickBooksScope;
  transport: ReturnType<typeof readOnlyQuickBooksTransport>;
  checkpoint: Checkpoint;
  stats: { examined: number; created: number; updated: number; linked: number; skipped: number; failed: number; conflicts: number };
  started: number;
  runId?: string;
};

export async function approvedMap(prisma: PrismaClient, companyId: string, scope: QuickBooksScope, objectType: InboundObjectType) {
  const rows = await prisma.quickBooksImportReview.findMany({
    where: {
      companyId,
      environment: scope.environment,
      realmId: scope.realmId,
      objectType,
      status: "APPROVED",
      proposedAction: { in: ["LINK", "CREATE"] },
      confidence: { in: ["EXACT", "HIGH", "NONE"] },
    },
  });
  return new Map(rows.map((row) => [row.quickbooksId, row]));
}

async function importCustomers(ctx: LoopCtx) {
  const reviews = await approvedMap(ctx.prisma, ctx.companyId, ctx.scope, "CUSTOMER");
  let start = ctx.checkpoint.start || 1;
  while (Date.now() - ctx.started < BUDGET_MS) {
    const page = await qboPage<QboCustomer>(ctx.transport, "Customer", "Customer", start, PAGE);
    if (!page.ok) {
      ctx.stats.failed += 1;
      break;
    }
    if (!page.rows.length) {
      ctx.checkpoint.finished = true;
      ctx.checkpoint.start = 0;
      break;
    }
    for (const row of page.rows) {
      if (!row.Id) continue;
      ctx.stats.examined += 1;
      try {
        const review = reviews.get(row.Id);
        const existing = await ctx.prisma.customer.findFirst({
          where: {
            companyId: ctx.companyId,
            OR: [{ quickbooksCustomerId: row.Id }, { sourceSystem: QUICKBOOKS_SOURCE, externalId: row.Id }],
          },
        });
        const mapping = await ctx.prisma.quickBooksMapping.findFirst({
          where: { ...mappingScopeWhere(ctx.scope), entityType: "CUSTOMER", quickbooksId: row.Id },
        });
        if (existing || mapping) {
          const customerId = existing?.id || mapping!.internalId;
          await stampCustomer(ctx, customerId, row);
          ctx.stats.updated += 1;
          ctx.stats.linked += 1;
          continue;
        }
        if (!review) {
          ctx.stats.skipped += 1;
          continue;
        }
        if (review.proposedAction === "LINK" && review.proposedInternalId) {
          const target = await ctx.prisma.customer.findFirst({
            where: { id: review.proposedInternalId, companyId: ctx.companyId },
          });
          if (!target) {
            ctx.stats.conflicts += 1;
            continue;
          }
          await stampCustomer(ctx, target.id, row);
          ctx.stats.linked += 1;
          await markReview(ctx.prisma, review.id, "LINKED");
          continue;
        }
        if (review.proposedAction === "CREATE" && review.confidence === "NONE") {
          const names = splitFullName(row.DisplayName || `${row.GivenName || ""} ${row.FamilyName || ""}`);
          const created = await ctx.prisma.customer.create({
            data: {
              companyId: ctx.companyId,
              firstName: row.GivenName || names.firstName || "QuickBooks",
              lastName: row.FamilyName || names.lastName || "Customer",
              businessName: row.CompanyName || row.DisplayName || null,
              email: row.PrimaryEmailAddr?.Address || null,
              phone: row.PrimaryPhone?.FreeFormNumber || null,
              notes: row.Notes || null,
              status: row.Active === false ? "INACTIVE" : "ACTIVE",
              sourceSystem: QUICKBOOKS_SOURCE,
              externalId: row.Id,
              importMode: IMPORT_MODE_HISTORICAL,
              quickbooksCustomerId: row.Id,
              quickbooksRealmId: ctx.scope.realmId,
              quickbooksLastModifiedAt: parseQboDate(row.MetaData?.LastUpdatedTime),
              lastSyncedAt: new Date(),
              syncStatus: "SYNCED",
            },
          });
          const ship = usableServiceAddress(row.ShipAddr);
          const bill = usableServiceAddress(row.BillAddr);
          const approvedProperty = ship || bill;
          if (approvedProperty) {
            await ctx.prisma.property.create({
              data: {
                companyId: ctx.companyId,
                customerId: created.id,
                address: approvedProperty.address,
                city: approvedProperty.city,
                state: approvedProperty.state,
                zip: approvedProperty.zip,
                isPrimary: true,
                sourceSystem: QUICKBOOKS_SOURCE,
                externalId: `${row.Id}:${ship ? "ship" : "bill"}`,
                importMode: IMPORT_MODE_HISTORICAL,
              },
            });
          }
          await upsertInboundMapping(ctx.prisma, {
            scope: ctx.scope,
            objectType: "CUSTOMER",
            internalId: created.id,
            quickbooksId: row.Id,
            syncToken: row.SyncToken,
            lastModified: parseQboDate(row.MetaData?.LastUpdatedTime),
          });
          ctx.stats.created += 1;
          await markReview(ctx.prisma, review.id, "CREATED");
        } else {
          ctx.stats.skipped += 1;
        }
      } catch (error) {
        ctx.stats.failed += 1;
        await ctx.prisma.quickBooksImportReview.updateMany({
          where: { companyId: ctx.companyId, objectType: "CUSTOMER", quickbooksId: row.Id },
          data: { errorMessage: error instanceof Error ? error.message : "Customer import failed", status: "FAILED" },
        });
      }
    }
    start += page.rows.length;
    ctx.checkpoint.start = start;
    if (page.rows.length < PAGE) {
      ctx.checkpoint.finished = true;
      break;
    }
  }
}

async function stampCustomer(ctx: LoopCtx, customerId: string, row: QboCustomer) {
  await ctx.prisma.customer.update({
    where: { id: customerId },
    data: {
      quickbooksCustomerId: row.Id,
      quickbooksRealmId: ctx.scope.realmId,
      lastSyncedAt: new Date(),
      syncStatus: "SYNCED",
      quickbooksLastModifiedAt: parseQboDate(row.MetaData?.LastUpdatedTime),
    },
  });
  await upsertInboundMapping(ctx.prisma, {
    scope: ctx.scope,
    objectType: "CUSTOMER",
    internalId: customerId,
    quickbooksId: row.Id!,
    syncToken: row.SyncToken,
    lastModified: parseQboDate(row.MetaData?.LastUpdatedTime),
  });
}

async function importVendors(ctx: LoopCtx) {
  let start = 1;
  while (Date.now() - ctx.started < BUDGET_MS) {
    const page = await qboPage<QboVendor>(ctx.transport, "Vendor", "Vendor", start, PAGE);
    if (!page.ok || !page.rows.length) {
      if (!page.ok) ctx.stats.failed += 1;
      break;
    }
    for (const row of page.rows) {
      if (!row.Id) continue;
      ctx.stats.examined += 1;
      const existing = await ctx.prisma.vendor.findFirst({
        where: { companyId: ctx.companyId, OR: [{ quickbooksVendorId: row.Id }, { externalId: row.Id }] },
      });
      if (existing) {
        await ctx.prisma.vendor.update({
          where: { id: existing.id },
          data: {
            name: row.DisplayName || existing.name,
            email: row.PrimaryEmailAddr?.Address || existing.email,
            phone: row.PrimaryPhone?.FreeFormNumber || existing.phone,
            active: row.Active !== false,
            lastSyncedAt: new Date(),
            quickbooksVendorId: row.Id,
            quickbooksRealmId: ctx.scope.realmId,
            sourceSystem: QUICKBOOKS_SOURCE,
            externalId: row.Id,
            syncStatus: "SYNCED",
          },
        });
        await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "VENDOR", internalId: existing.id, quickbooksId: row.Id });
        ctx.stats.updated += 1;
        continue;
      }
      const created = await ctx.prisma.vendor.create({
        data: {
          companyId: ctx.companyId,
          name: row.DisplayName || "Vendor",
          email: row.PrimaryEmailAddr?.Address || null,
          phone: row.PrimaryPhone?.FreeFormNumber || null,
          notes: row.Notes || null,
          active: row.Active !== false,
          sourceSystem: QUICKBOOKS_SOURCE,
          externalId: row.Id,
          quickbooksVendorId: row.Id,
          quickbooksRealmId: ctx.scope.realmId,
          lastSyncedAt: new Date(),
          syncStatus: "SYNCED",
        },
      });
      await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "VENDOR", internalId: created.id, quickbooksId: row.Id });
      ctx.stats.created += 1;
    }
    start += page.rows.length;
    if (page.rows.length < PAGE) break;
  }
}

async function importAccounts(ctx: LoopCtx) {
  let start = 1;
  while (Date.now() - ctx.started < BUDGET_MS) {
    const page = await qboPage<QboAccount>(ctx.transport, "Account", "Account", start, PAGE);
    if (!page.ok || !page.rows.length) {
      if (!page.ok) ctx.stats.failed += 1;
      break;
    }
    for (const row of page.rows) {
      if (!row.Id) continue;
      ctx.stats.examined += 1;
      const classification = classifyAccountType(row.AccountType, row.AccountSubType);
      const existing = await ctx.prisma.accountingAccount.findFirst({
        where: { companyId: ctx.companyId, OR: [{ quickbooksAccountId: row.Id }, { externalId: row.Id }] },
      });
      const data = {
        name: row.Name || "Account",
        accountType: row.AccountType || "Other",
        classification,
        fullyQualifiedName: row.FullyQualifiedName || null,
        active: row.Active !== false,
        sourceSystem: QUICKBOOKS_SOURCE,
        externalId: row.Id,
        quickbooksAccountId: row.Id,
        quickbooksRealmId: ctx.scope.realmId,
        lastSyncedAt: new Date(),
      };
      if (existing) {
        await ctx.prisma.accountingAccount.update({ where: { id: existing.id }, data });
        await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "ACCOUNT", internalId: existing.id, quickbooksId: row.Id });
        ctx.stats.updated += 1;
      } else {
        const created = await ctx.prisma.accountingAccount.create({ data: { companyId: ctx.companyId, ...data } });
        await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "ACCOUNT", internalId: created.id, quickbooksId: row.Id });
        ctx.stats.created += 1;
      }
    }
    start += page.rows.length;
    if (page.rows.length < PAGE) break;
  }
}

async function importItems(ctx: LoopCtx) {
  const reviews = await approvedMap(ctx.prisma, ctx.companyId, ctx.scope, "ITEM");
  let category = await ctx.prisma.pricebookCategory.findFirst({
    where: { companyId: ctx.companyId, name: "QuickBooks" },
  });
  if (!category) {
    category = await ctx.prisma.pricebookCategory.create({
      data: { companyId: ctx.companyId, name: "QuickBooks", sortOrder: 90 },
    });
  }
  let start = 1;
  while (Date.now() - ctx.started < BUDGET_MS) {
    const page = await qboPage<QboItem>(ctx.transport, "Item", "Item", start, PAGE);
    if (!page.ok || !page.rows.length) {
      if (!page.ok) ctx.stats.failed += 1;
      break;
    }
    for (const row of page.rows) {
      if (!row.Id) continue;
      ctx.stats.examined += 1;
      const existing = await ctx.prisma.pricebookItem.findFirst({
        where: { companyId: ctx.companyId, OR: [{ quickbooksItemId: row.Id }, { externalId: row.Id }] },
      });
      const review = reviews.get(row.Id);
      const targetId = existing?.id || (review?.proposedAction === "LINK" ? review.proposedInternalId : null);
      const payload = {
        name: row.Name || "Item",
        sku: row.Sku || null,
        customerDescription: row.Description || null,
        standardPriceCents: dollarsToCents(row.UnitPrice),
        internalCostCents: dollarsToCents(row.PurchaseCost),
        active: row.Active !== false,
        type: row.Type === "Inventory" || row.Type === "NonInventory" ? "PRODUCT" as const : "SERVICE" as const,
        sourceSystem: QUICKBOOKS_SOURCE,
        externalId: row.Id,
        quickbooksItemId: row.Id,
        quickbooksRealmId: ctx.scope.realmId,
        incomeAccount: row.IncomeAccountRef?.name || null,
        cogsAccount: row.ExpenseAccountRef?.name || null,
        taxCode: row.SalesTaxCodeRef?.value || null,
        lastSyncedAt: new Date(),
        syncStatus: "SYNCED",
        importMode: IMPORT_MODE_HISTORICAL,
      };
      if (targetId) {
        const target = await ctx.prisma.pricebookItem.findFirst({ where: { id: targetId, companyId: ctx.companyId } });
        if (!target) {
          ctx.stats.skipped += 1;
          continue;
        }
        await ctx.prisma.pricebookItem.update({ where: { id: target.id }, data: payload });
        await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "ITEM", internalId: target.id, quickbooksId: row.Id });
        ctx.stats.updated += 1;
        if (review) await markReview(ctx.prisma, review.id, "LINKED");
        continue;
      }
      if (!review || review.proposedAction !== "CREATE") {
        ctx.stats.skipped += 1;
        continue;
      }
      const created = await ctx.prisma.pricebookItem.create({
        data: { companyId: ctx.companyId, categoryId: category.id, ...payload },
      });
      await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "ITEM", internalId: created.id, quickbooksId: row.Id });
      ctx.stats.created += 1;
      await markReview(ctx.prisma, review.id, "CREATED");
    }
    start += page.rows.length;
    if (page.rows.length < PAGE) break;
  }
}

async function importInvoices(ctx: LoopCtx) {
  const customerMaps = await ctx.prisma.quickBooksMapping.findMany({
    where: { ...mappingScopeWhere(ctx.scope), entityType: "CUSTOMER" },
    select: { internalId: true, quickbooksId: true },
  });
  const customerByQbo = new Map(customerMaps.map((row) => [row.quickbooksId, row.internalId]));
  let start = ctx.checkpoint.start || 1;
  while (Date.now() - ctx.started < BUDGET_MS) {
    const page = await qboPage<QboInvoice>(ctx.transport, "Invoice", "Invoice", start, PAGE);
    if (!page.ok) {
      ctx.stats.failed += 1;
      break;
    }
    if (!page.rows.length) {
      ctx.checkpoint.finished = true;
      break;
    }
    for (const row of page.rows) {
      if (!row.Id) continue;
      ctx.stats.examined += 1;
      try {
        const existing = await ctx.prisma.invoice.findFirst({
          where: {
            companyId: ctx.companyId,
            OR: [{ quickbooksInvoiceId: row.Id }, { sourceSystem: QUICKBOOKS_SOURCE, externalId: row.Id }],
          },
          include: { lineItems: true },
        });
        const customerId = row.CustomerRef?.value ? customerByQbo.get(row.CustomerRef.value) : null;
        if (!customerId) {
          ctx.stats.skipped += 1;
          ctx.stats.conflicts += 1;
          continue;
        }
        const total = dollarsToCents(row.TotalAmt);
        const balance = dollarsToCents(row.Balance);
        const paid = Math.max(0, total - balance);
        const status = /void/i.test(row.PrivateNote || "") || /void/i.test(row.DocNumber || "")
          ? "VOID"
          : balance <= 0
            ? "PAID"
            : paid > 0
              ? "PARTIALLY_PAID"
              : "SENT";
        const lineItems = (row.Line || [])
          .filter((line) => line.DetailType === "SalesItemLineDetail")
          .map((line, index) => ({
            name: line.SalesItemLineDetail?.ItemRef?.name || line.Description || "Line",
            description: line.Description || null,
            quantity: line.SalesItemLineDetail?.Qty ?? 1,
            unitPriceCents: dollarsToCents(line.SalesItemLineDetail?.UnitPrice),
            amountCents: dollarsToCents(line.Amount),
            externalId: line.Id || null,
            quickbooksItemId: line.SalesItemLineDetail?.ItemRef?.value || null,
            sortOrder: index,
          }));
        const invoiceNumber = (row.DocNumber || `QBO-${row.Id}`).slice(0, 40);
        if (existing) {
          await ctx.prisma.invoice.update({
            where: { id: existing.id },
            data: {
              status,
              issueDate: parseQboDate(row.TxnDate) || existing.issueDate,
              dueDate: parseQboDate(row.DueDate),
              subtotalCents: total,
              totalCents: total,
              amountPaidCents: paid,
              balanceCents: balance,
              notes: row.PrivateNote || existing.notes,
              quickbooksInvoiceId: row.Id,
              quickbooksRealmId: ctx.scope.realmId,
              lastSyncedAt: new Date(),
              syncStatus: "SYNCED",
              sourceSystem: QUICKBOOKS_SOURCE,
              externalId: row.Id,
              importMode: IMPORT_MODE_HISTORICAL,
            },
          });
          if (!existing.lineItems.length && lineItems.length) {
            await ctx.prisma.invoiceLineItem.createMany({
              data: lineItems.map((line) => ({ invoiceId: existing.id, ...line, taxable: true })),
            });
          }
          await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "INVOICE", internalId: existing.id, quickbooksId: row.Id });
          ctx.stats.updated += 1;
          continue;
        }
        const clash = await ctx.prisma.invoice.findFirst({
          where: { companyId: ctx.companyId, invoiceNumber },
          select: { id: true },
        });
        const created = await ctx.prisma.invoice.create({
          data: {
            companyId: ctx.companyId,
            customerId,
            invoiceNumber: (clash ? `${invoiceNumber}-QBO` : invoiceNumber).slice(0, 40),
            status,
            issueDate: parseQboDate(row.TxnDate) || new Date(),
            dueDate: parseQboDate(row.DueDate),
            subtotalCents: total,
            totalCents: total,
            amountPaidCents: paid,
            balanceCents: balance,
            notes: row.PrivateNote || "Historical QuickBooks invoice. Not a ContractorYou job.",
            sourceSystem: QUICKBOOKS_SOURCE,
            externalId: row.Id,
            importMode: IMPORT_MODE_HISTORICAL,
            quickbooksInvoiceId: row.Id,
            quickbooksRealmId: ctx.scope.realmId,
            lastSyncedAt: new Date(),
            syncStatus: "SYNCED",
            lineItems: { create: lineItems.map((line) => ({ ...line, taxable: true })) },
          },
        });
        await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "INVOICE", internalId: created.id, quickbooksId: row.Id });
        ctx.stats.created += 1;
      } catch (error) {
        ctx.stats.failed += 1;
        await ctx.prisma.quickBooksImportReview.upsert({
          where: {
            companyId_environment_realmId_objectType_quickbooksId: {
              companyId: ctx.companyId,
              environment: ctx.scope.environment,
              realmId: ctx.scope.realmId,
              objectType: "INVOICE",
              quickbooksId: row.Id,
            },
          },
          create: {
            companyId: ctx.companyId,
            environment: ctx.scope.environment,
            realmId: ctx.scope.realmId,
            objectType: "INVOICE",
            quickbooksId: row.Id,
            displayName: row.DocNumber || row.Id,
            confidence: "POSSIBLE",
            status: "FAILED",
            proposedAction: "REVIEW",
            reason: "Invoice import failed; other records continued.",
            payload: row,
            errorMessage: error instanceof Error ? error.message : "Invoice import failed",
          },
          update: { status: "FAILED", errorMessage: error instanceof Error ? error.message : "Invoice import failed" },
        });
      }
    }
    start += page.rows.length;
    ctx.checkpoint.start = start;
    if (page.rows.length < PAGE) {
      ctx.checkpoint.finished = true;
      break;
    }
  }
}

async function importPayments(ctx: LoopCtx) {
  const invoiceMaps = await ctx.prisma.quickBooksMapping.findMany({
    where: { ...mappingScopeWhere(ctx.scope), entityType: "INVOICE" },
    select: { internalId: true, quickbooksId: true },
  });
  const invoiceByQbo = new Map(invoiceMaps.map((row) => [row.quickbooksId, row.internalId]));
  let start = ctx.checkpoint.start || 1;
  while (Date.now() - ctx.started < BUDGET_MS) {
    const page = await qboPage<QboPayment>(ctx.transport, "Payment", "Payment", start, PAGE);
    if (!page.ok) {
      ctx.stats.failed += 1;
      break;
    }
    if (!page.rows.length) {
      ctx.checkpoint.finished = true;
      break;
    }
    for (const row of page.rows) {
      if (!row.Id) continue;
      ctx.stats.examined += 1;
      try {
        const existing = await ctx.prisma.payment.findFirst({
          where: {
            companyId: ctx.companyId,
            OR: [
              { quickbooksPaymentId: row.Id },
              { sourceSystem: QUICKBOOKS_SOURCE, externalId: row.Id },
              { provider: "QUICKBOOKS", providerPaymentId: `qbo-${row.Id}` },
            ],
          },
        });
        const linkedInvoiceId = row.Line?.flatMap((line) => line.LinkedTxn || []).find((txn) => txn.TxnType === "Invoice")?.TxnId;
        const invoiceId = linkedInvoiceId ? invoiceByQbo.get(linkedInvoiceId) : null;
        if (!invoiceId) {
          ctx.stats.skipped += 1;
          ctx.stats.conflicts += 1;
          continue;
        }
        const invoice = await ctx.prisma.invoice.findFirst({
          where: { id: invoiceId, companyId: ctx.companyId },
          select: { customerId: true },
        });
        const data = {
          amountCents: dollarsToCents(row.TotalAmt),
          paidAt: parseQboDate(row.TxnDate) || new Date(),
          reference: row.PaymentRefNum || null,
          notes: row.DepositToAccountRef?.name
            ? `Deposited to ${row.DepositToAccountRef.name}`
            : "Historical QuickBooks payment.",
          method: "OTHER" as const,
          status: "RECORDED",
          provider: "QUICKBOOKS",
          providerPaymentId: `qbo-${row.Id}`,
          sourceSystem: QUICKBOOKS_SOURCE,
          externalId: row.Id,
          importMode: IMPORT_MODE_HISTORICAL,
          quickbooksPaymentId: row.Id,
          quickbooksRealmId: ctx.scope.realmId,
          lastSyncedAt: new Date(),
          syncStatus: "SYNCED",
          customerId: invoice?.customerId,
          invoiceId,
        };
        if (existing) {
          await ctx.prisma.payment.update({ where: { id: existing.id }, data });
          await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "PAYMENT", internalId: existing.id, quickbooksId: row.Id });
          ctx.stats.updated += 1;
        } else {
          const created = await ctx.prisma.payment.create({ data: { companyId: ctx.companyId, ...data } });
          await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "PAYMENT", internalId: created.id, quickbooksId: row.Id });
          ctx.stats.created += 1;
        }
      } catch {
        ctx.stats.failed += 1;
      }
    }
    start += page.rows.length;
    ctx.checkpoint.start = start;
    if (page.rows.length < PAGE) {
      ctx.checkpoint.finished = true;
      break;
    }
  }
}

async function importPurchases(ctx: LoopCtx) {
  let start = ctx.checkpoint.start || 1;
  while (Date.now() - ctx.started < BUDGET_MS) {
    const page = await qboPage<QboPurchase>(ctx.transport, "Purchase", "Purchase", start, PAGE);
    if (!page.ok) {
      ctx.stats.failed += 1;
      break;
    }
    if (!page.rows.length) {
      ctx.checkpoint.finished = true;
      break;
    }
    for (const row of page.rows) {
      if (!row.Id) continue;
      ctx.stats.examined += 1;
      try {
        const existing = await ctx.prisma.expense.findFirst({
          where: {
            companyId: ctx.companyId,
            OR: [{ quickbooksPurchaseId: row.Id }, { sourceSystem: QUICKBOOKS_SOURCE, externalId: row.Id }],
          },
        });
        const vendor = row.EntityRef?.value
          ? await ctx.prisma.vendor.findFirst({
              where: { companyId: ctx.companyId, OR: [{ quickbooksVendorId: row.EntityRef.value }, { externalId: row.EntityRef.value }] },
            })
          : null;
        const account = row.AccountRef?.value
          ? await ctx.prisma.accountingAccount.findFirst({
              where: { companyId: ctx.companyId, OR: [{ quickbooksAccountId: row.AccountRef.value }, { externalId: row.AccountRef.value }] },
            })
          : null;
        const data = {
          vendor: row.EntityRef?.name || vendor?.name || null,
          date: parseQboDate(row.TxnDate) || new Date(),
          amountCents: dollarsToCents(row.TotalAmt),
          description: row.PrivateNote || row.AccountRef?.name || "QuickBooks purchase",
          status: "APPROVED" as const,
          category: "OTHER" as const,
          sourceSystem: QUICKBOOKS_SOURCE,
          externalId: row.Id,
          importMode: IMPORT_MODE_HISTORICAL,
          vendorId: vendor?.id || null,
          accountId: account?.id || null,
          transactionType: row.PaymentType || "Purchase",
          quickbooksPurchaseId: row.Id,
          quickbooksVendorId: row.EntityRef?.value || null,
          quickbooksRealmId: ctx.scope.realmId,
          lastSyncedAt: new Date(),
          syncStatus: "SYNCED",
        };
        if (existing) {
          await ctx.prisma.expense.update({ where: { id: existing.id }, data });
          await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "PURCHASE", internalId: existing.id, quickbooksId: row.Id });
          ctx.stats.updated += 1;
        } else {
          const created = await ctx.prisma.expense.create({
            data: { companyId: ctx.companyId, createdById: ctx.userId!, ...data },
          });
          await upsertInboundMapping(ctx.prisma, { scope: ctx.scope, objectType: "PURCHASE", internalId: created.id, quickbooksId: row.Id });
          ctx.stats.created += 1;
        }
      } catch {
        ctx.stats.failed += 1;
      }
    }
    start += page.rows.length;
    ctx.checkpoint.start = start;
    if (page.rows.length < PAGE) {
      ctx.checkpoint.finished = true;
      break;
    }
  }
}

async function markReview(prisma: PrismaClient, id: string, status: string) {
  await prisma.quickBooksImportReview.update({ where: { id }, data: { status } });
}
