import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { isLiveOperational, isNonOperationalImport } from "@/lib/imports/modes";
import { isQuickBooksSource, QBO_RESET_CONFIRMATION, QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { ENTITY_DEFAULT_ITEM, ENTITY_EXPENSE_ACCOUNT, ENTITY_SERVICE_ITEM } from "@/lib/quickbooks/mappings";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";

export { QBO_RESET_CONFIRMATION };

export const PROTECTED_QBO_MAPPING_TYPES = [ENTITY_DEFAULT_ITEM, ENTITY_SERVICE_ITEM, ENTITY_EXPENSE_ACCOUNT] as const;
export const FINANCIAL_QBO_MAPPING_TYPES = ["CUSTOMER", "INVOICE", "PAYMENT", "EXPENSE"] as const;

export type QboResetDecision = {
  action: "delete" | "skip" | "block" | "mixed";
  reason?: string;
};

export type QboHistoricalResetCounts = {
  customers: number;
  invoices: number;
  payments: number;
  expenses: number;
  referenceRecords: number;
  mappings: number;
  externalRefs: number;
  importSessions: number;
  reviewItems: number;
  watchdogFindings: number;
};

export type QboRealmContext = {
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  environment: "sandbox" | "production" | "unknown";
  connectionStatus: string | null;
};

export type QboBlockedRecord = {
  model: string;
  id: string;
  label: string;
  reason: string;
};

export type QboMixedRecord = {
  model: "customer";
  id: string;
  label: string;
  reason: string;
};

export type QboPlannedIds = {
  customers: string[];
  invoices: string[];
  payments: string[];
  expenses: string[];
  mappings: string[];
  reviewItems: string[];
  externalRefs: string[];
  importSessions: string[];
};

export type QboHistoricalResetPlan = {
  companyId: string;
  sourceSystem: typeof QUICKBOOKS_SOURCE;
  realm: QboRealmContext;
  realmWarning: string | null;
  counts: QboHistoricalResetCounts;
  preserved: {
    nativeCustomers: number;
    nativeInvoices: number;
    nativePayments: number;
    stripePayments: number;
    liveJobs: number;
    liveMappings: number;
    mixedCustomers: number;
    unknownRecords: number;
    highLevelThreads: number;
    connectionIntact: boolean;
  };
  mixed: QboMixedRecord[];
  blocked: QboBlockedRecord[];
  deleteIds: QboPlannedIds;
  idempotent: boolean;
};

export type QboHistoricalResetResult = QboHistoricalResetPlan & {
  operationId: string;
  mode: "DRY_RUN" | "EXECUTE";
  executed: boolean;
};

export function isQuickBooksHistoricalImportRecord(input: {
  sourceSystem?: string | null;
  importMode?: string | null;
}): boolean {
  return isQuickBooksSource(input.sourceSystem) && isNonOperationalImport(input.importMode);
}

export function mappingMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function mappingRealmId(metadata: unknown): string | null {
  const realm = mappingMetadataRecord(metadata).realmId;
  return typeof realm === "string" && realm.trim() ? realm.trim() : null;
}

export function isHistoricalImportMapping(metadata: unknown): boolean {
  return mappingMetadataRecord(metadata).historicalImport === true;
}

export function isProtectedLiveMappingType(entityType: string): boolean {
  return (PROTECTED_QBO_MAPPING_TYPES as readonly string[]).includes(entityType);
}

export function historicalImportMappingMetadata(input: {
  realmId?: string | null;
  environment?: string | null;
}) {
  return {
    historicalImport: true as const,
    realmId: input.realmId || null,
    environment: input.environment || null,
  };
}

export function realmMismatch(storedRealm: string | null, currentRealm: string | null): boolean {
  return Boolean(storedRealm && currentRealm && storedRealm !== currentRealm);
}

export function decideQboHistoricalInvoice(input: {
  sourceSystem?: string | null;
  importMode?: string | null;
  mappingRealmId?: string | null;
  currentRealmId?: string | null;
  hasStripePayment: boolean;
  hasPreservedPayment: boolean;
  attachedToLiveJob: boolean;
}): QboResetDecision {
  if (!isQuickBooksHistoricalImportRecord(input)) return { action: "skip" };
  if (realmMismatch(input.mappingRealmId ?? null, input.currentRealmId ?? null)) {
    return {
      action: "block",
      reason: `Realm ${input.mappingRealmId} does not match the connected QuickBooks realm ${input.currentRealmId}. Left untouched.`,
    };
  }
  if (input.hasStripePayment) {
    return { action: "block", reason: "A Stripe payment is attached. Historical invoice is blocked so the Stripe payment stays." };
  }
  if (input.hasPreservedPayment) {
    return {
      action: "block",
      reason: "A native ContractorYou payment is attached. Historical invoice is blocked so the live payment stays.",
    };
  }
  if (input.attachedToLiveJob) {
    return { action: "block", reason: "Attached to a live ContractorYou job. Blocked for review." };
  }
  return { action: "delete" };
}

export function decideQboHistoricalPayment(input: {
  sourceSystem?: string | null;
  importMode?: string | null;
  provider?: string | null;
  mappingRealmId?: string | null;
  currentRealmId?: string | null;
}): QboResetDecision {
  if ((input.provider || "").toUpperCase() === "STRIPE") return { action: "skip" };
  if (!isQuickBooksHistoricalImportRecord(input)) return { action: "skip" };
  if (realmMismatch(input.mappingRealmId ?? null, input.currentRealmId ?? null)) {
    return {
      action: "block",
      reason: `Realm ${input.mappingRealmId} does not match the connected QuickBooks realm ${input.currentRealmId}. Left untouched.`,
    };
  }
  return { action: "delete" };
}

export function decideQboHistoricalCustomer(input: {
  sourceSystem?: string | null;
  importMode?: string | null;
  mappingRealmId?: string | null;
  currentRealmId?: string | null;
  hasLiveRelationship: boolean;
}): QboResetDecision {
  if (!isQuickBooksHistoricalImportRecord(input)) return { action: "skip" };
  if (realmMismatch(input.mappingRealmId ?? null, input.currentRealmId ?? null)) {
    return {
      action: "block",
      reason: `Realm ${input.mappingRealmId} does not match the connected QuickBooks realm ${input.currentRealmId}. Left untouched.`,
    };
  }
  if (input.hasLiveRelationship) {
    return {
      action: "mixed",
      reason:
        "QuickBooks history was attached to a customer that now has live ContractorYou relationships. Customer and live mappings stay.",
    };
  }
  return { action: "delete" };
}

export function mappingEligibleForHistoricalDelete(input: {
  entityType: string;
  internalId: string;
  metadata?: unknown;
  deletedIds: { customers: Set<string>; invoices: Set<string>; payments: Set<string>; expenses: Set<string> };
}): boolean {
  if (isProtectedLiveMappingType(input.entityType)) return false;
  if (input.entityType === "INVOICE") return input.deletedIds.invoices.has(input.internalId);
  if (input.entityType === "PAYMENT") return input.deletedIds.payments.has(input.internalId);
  if (input.entityType === "CUSTOMER") return input.deletedIds.customers.has(input.internalId);
  if (input.entityType === "EXPENSE") return input.deletedIds.expenses.has(input.internalId);
  return false;
}

function emptyCounts(): QboHistoricalResetCounts {
  return {
    customers: 0,
    invoices: 0,
    payments: 0,
    expenses: 0,
    referenceRecords: 0,
    mappings: 0,
    externalRefs: 0,
    importSessions: 0,
    reviewItems: 0,
    watchdogFindings: 0,
  };
}

function emptyIds(): QboPlannedIds {
  return {
    customers: [],
    invoices: [],
    payments: [],
    expenses: [],
    mappings: [],
    reviewItems: [],
    externalRefs: [],
    importSessions: [],
  };
}

function customerLabel(row: { firstName: string; lastName: string; businessName: string | null }) {
  return row.businessName?.trim() || `${row.firstName} ${row.lastName}`.trim() || "Customer";
}

function addCustomerIds(target: Set<string>, rows: Array<{ customerId?: string | null }>) {
  for (const row of rows) {
    if (row.customerId) target.add(row.customerId);
  }
}

export function formatQboRealmEnvironment(environment: QboRealmContext["environment"]) {
  if (environment === "sandbox") return "Sandbox";
  if (environment === "production") return "Production";
  return "Unknown";
}

export function formatQboHistoricalResetMessage(
  plan: QboHistoricalResetPlan,
  mode: "DRY_RUN" | "EXECUTE",
  executed = false
) {
  const lines = [
    mode === "EXECUTE"
      ? executed
        ? "QuickBooks historical import reset completed."
        : "Nothing left to remove. QuickBooks historical import reset was idempotent."
      : "Dry run complete. Nothing was deleted.",
    `QuickBooks company: ${plan.realm.companyName || "Unknown"}`,
    `Realm ID: ${plan.realm.realmId || "Not stored on connection"}`,
    `Environment: ${formatQboRealmEnvironment(plan.realm.environment)}`,
    "This reset applies only to historical QuickBooks imports associated with this source/realm.",
    plan.realmWarning ? `Note: ${plan.realmWarning}` : null,
    "",
    "Confirmed historical QuickBooks records:",
    `Historical QuickBooks customers created: ${plan.counts.customers}`,
    `Historical invoices: ${plan.counts.invoices}`,
    `Historical payments: ${plan.counts.payments}`,
    `Historical expenses: ${plan.counts.expenses}`,
    `Historical products/services/reference records: ${plan.counts.referenceRecords}`,
    `ImportExternalRefs: ${plan.counts.externalRefs}`,
    `Import sessions: ${plan.counts.importSessions}`,
    `QuickBooks mappings (historical-only): ${plan.counts.mappings}`,
    `Import review items: ${plan.counts.reviewItems}`,
    `Billing Watchdog findings on those records: ${plan.counts.watchdogFindings}`,
    "",
    "Preserved:",
    `Protected native customers: ${plan.preserved.nativeCustomers}`,
    `Protected native invoices: ${plan.preserved.nativeInvoices}`,
    `Protected native payments: ${plan.preserved.nativePayments}`,
    `Protected Stripe payments: ${plan.preserved.stripePayments}`,
    `Protected QuickBooks LIVE mappings: ${plan.preserved.liveMappings}`,
    `Mixed records preserved: ${plan.preserved.mixedCustomers}`,
    `Unknown/unsafe records: ${plan.preserved.unknownRecords}`,
    `Blocked records: ${plan.blocked.length}`,
    `QuickBooks connection intact: ${plan.preserved.connectionIntact ? "yes" : "no"}`,
  ].filter((line) => line !== null);
  return lines.join("\n");
}

export async function loadQboRealmContext(prisma: PrismaClient, companyId: string): Promise<QboRealmContext> {
  const [connection, settings, app] = await Promise.all([
    prisma.integrationConnection.findFirst({
      where: { companyId, providerKey: QUICKBOOKS_PROVIDER_KEY },
      select: { status: true, externalAccountId: true, accountLabel: true },
    }),
    prisma.quickBooksSettings.findUnique({
      where: { companyId },
      select: { qboCompanyName: true, appEnvironment: true },
    }),
    loadQuickBooksAppCredentials(prisma, companyId),
  ]);
  const environment =
    app?.environment ??
    (settings?.appEnvironment === "production" ? "production" : settings?.appEnvironment === "sandbox" ? "sandbox" : "unknown");
  return {
    connected: connection?.status === "CONNECTED",
    realmId: connection?.externalAccountId ?? null,
    companyName: settings?.qboCompanyName ?? connection?.accountLabel ?? null,
    environment,
    connectionStatus: connection?.status ?? null,
  };
}

export async function planQuickBooksHistoricalReset(
  prisma: PrismaClient,
  companyId: string
): Promise<QboHistoricalResetPlan> {
  const realm = await loadQboRealmContext(prisma, companyId);
  const [
    customers,
    invoices,
    payments,
    expenses,
    mappings,
    threads,
    bookings,
    waiting,
    memberships,
    jobs,
    reviewItems,
    notes,
    estimates,
    properties,
    equipment,
    leads,
    callRecords,
    formSubmissions,
    externalRefs,
    importSessions,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        sourceSystem: true,
        importMode: true,
      },
    }),
    prisma.invoice.findMany({
      where: { companyId },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        jobId: true,
        sourceSystem: true,
        importMode: true,
      },
    }),
    prisma.payment.findMany({
      where: { companyId },
      select: {
        id: true,
        invoiceId: true,
        provider: true,
        sourceSystem: true,
        importMode: true,
      },
    }),
    prisma.expense.findMany({
      where: { companyId },
      select: { id: true, customerId: true, jobId: true, sourceSystem: true, importMode: true },
    }),
    prisma.quickBooksMapping.findMany({
      where: { companyId },
      select: { id: true, entityType: true, internalId: true, metadata: true },
    }),
    prisma.communicationThread.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.schedulingBooking.findMany({ where: { companyId }, select: { jobId: true } }),
    prisma.waitingRecord.findMany({ where: { companyId }, select: { customerId: true, jobId: true } }),
    prisma.customerMembership.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.job.findMany({
      where: { companyId },
      select: { id: true, customerId: true, importMode: true },
    }),
    prisma.importReviewItem.findMany({
      where: { companyId, sourceSystem: QUICKBOOKS_SOURCE },
      select: { id: true },
    }),
    prisma.customerNote.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.estimate.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.property.findMany({ where: { companyId }, select: { customerId: true, importMode: true } }),
    prisma.equipment.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.lead.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.callRecord.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.formSubmission.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.importExternalRef.findMany({
      where: { companyId, sourceSystem: "QUICKBOOKS" },
      select: { id: true, targetRecordId: true, recordType: true },
    }),
    prisma.importSession.findMany({
      where: { companyId, sourceType: "QUICKBOOKS" },
      select: {
        id: true,
        importMode: true,
        createdCustomers: { select: { id: true } },
        createdInvoices: { select: { id: true } },
        createdPayments: { select: { id: true } },
        createdExpenses: { select: { id: true } },
        createdJobs: { select: { id: true } },
        createdProperties: { select: { id: true } },
        createdEstimates: { select: { id: true } },
        createdEquipment: { select: { id: true } },
      },
    }),
  ]);

  const mappingByInvoice = new Map(mappings.filter((row) => row.entityType === "INVOICE").map((row) => [row.internalId, row]));
  const mappingByPayment = new Map(mappings.filter((row) => row.entityType === "PAYMENT").map((row) => [row.internalId, row]));
  const mappingByCustomer = new Map(mappings.filter((row) => row.entityType === "CUSTOMER").map((row) => [row.internalId, row]));
  const mappingByExpense = new Map(mappings.filter((row) => row.entityType === "EXPENSE").map((row) => [row.internalId, row]));

  const blocked: QboBlockedRecord[] = [];
  const mixed: QboMixedRecord[] = [];
  const deleteInvoices = new Set<string>();
  const deletePayments = new Set<string>();
  const deleteExpenses = new Set<string>();
  const deleteCustomers = new Set<string>();
  const deleteMappings = new Set<string>();
  let missingRealm = 0;

  function noteRealm(metadata: unknown | undefined, historical: boolean) {
    const stored = mappingRealmId(metadata);
    if (historical && !stored) missingRealm += 1;
    return stored;
  }

  for (const invoice of invoices) {
    const mapping = mappingByInvoice.get(invoice.id);
    const historical = isQuickBooksHistoricalImportRecord(invoice);
    const decision = decideQboHistoricalInvoice({
      sourceSystem: invoice.sourceSystem,
      importMode: invoice.importMode,
      mappingRealmId: noteRealm(mapping?.metadata, historical),
      currentRealmId: realm.realmId,
      hasStripePayment: payments.some(
        (payment) => payment.invoiceId === invoice.id && (payment.provider || "").toUpperCase() === "STRIPE"
      ),
      hasPreservedPayment: payments.some(
        (payment) =>
          payment.invoiceId === invoice.id &&
          (payment.provider || "").toUpperCase() !== "STRIPE" &&
          !isQuickBooksHistoricalImportRecord(payment)
      ),
      attachedToLiveJob: Boolean(invoice.jobId && jobs.some((job) => job.id === invoice.jobId && isLiveOperational(job.importMode))),
    });
    if (decision.action === "block") {
      blocked.push({ model: "invoice", id: invoice.id, label: invoice.invoiceNumber, reason: decision.reason || "Blocked." });
      continue;
    }
    if (decision.action === "delete") deleteInvoices.add(invoice.id);
  }

  for (const payment of payments) {
    const mapping = mappingByPayment.get(payment.id);
    const historical = isQuickBooksHistoricalImportRecord(payment);
    const decision = decideQboHistoricalPayment({
      sourceSystem: payment.sourceSystem,
      importMode: payment.importMode,
      provider: payment.provider,
      mappingRealmId: noteRealm(mapping?.metadata, historical),
      currentRealmId: realm.realmId,
    });
    if (decision.action === "block") {
      blocked.push({ model: "payment", id: payment.id, label: payment.id, reason: decision.reason || "Blocked." });
      continue;
    }
    if (decision.action === "delete") deletePayments.add(payment.id);
  }

  for (const expense of expenses) {
    if (!isQuickBooksHistoricalImportRecord(expense)) continue;
    const mapping = mappingByExpense.get(expense.id);
    noteRealm(mapping?.metadata, true);
    if (mapping && realmMismatch(mappingRealmId(mapping.metadata), realm.realmId)) {
      blocked.push({
        model: "expense",
        id: expense.id,
        label: expense.id,
        reason: `Realm ${mappingRealmId(mapping.metadata)} does not match the connected QuickBooks realm ${realm.realmId}. Left untouched.`,
      });
      continue;
    }
    if (expense.jobId && jobs.some((job) => job.id === expense.jobId && isLiveOperational(job.importMode))) {
      blocked.push({
        model: "expense",
        id: expense.id,
        label: expense.id,
        reason: "Attached to a live ContractorYou job. Blocked for review.",
      });
      continue;
    }
    deleteExpenses.add(expense.id);
  }

  const liveRelationshipByCustomer = new Set<string>();
  addCustomerIds(liveRelationshipByCustomer, jobs);
  addCustomerIds(
    liveRelationshipByCustomer,
    invoices.filter((invoice) => !deleteInvoices.has(invoice.id)).map((row) => ({ customerId: row.customerId }))
  );
  addCustomerIds(liveRelationshipByCustomer, estimates);
  addCustomerIds(liveRelationshipByCustomer, notes);
  addCustomerIds(liveRelationshipByCustomer, properties);
  addCustomerIds(liveRelationshipByCustomer, equipment);
  addCustomerIds(liveRelationshipByCustomer, leads);
  addCustomerIds(liveRelationshipByCustomer, callRecords);
  addCustomerIds(liveRelationshipByCustomer, formSubmissions);
  addCustomerIds(liveRelationshipByCustomer, threads);
  addCustomerIds(liveRelationshipByCustomer, waiting);
  addCustomerIds(liveRelationshipByCustomer, memberships);
  addCustomerIds(
    liveRelationshipByCustomer,
    invoices
      .filter((invoice) =>
        payments.some((payment) => payment.invoiceId === invoice.id && (payment.provider || "").toUpperCase() === "STRIPE")
      )
      .map((invoice) => ({ customerId: invoice.customerId }))
  );
  const bookedJobIds = new Set(bookings.map((row) => row.jobId));
  addCustomerIds(
    liveRelationshipByCustomer,
    jobs.filter((job) => bookedJobIds.has(job.id)).map((job) => ({ customerId: job.customerId }))
  );

  for (const customer of customers) {
    const mapping = mappingByCustomer.get(customer.id);
    const historical = isQuickBooksHistoricalImportRecord(customer);
    const decision = decideQboHistoricalCustomer({
      sourceSystem: customer.sourceSystem,
      importMode: customer.importMode,
      mappingRealmId: noteRealm(mapping?.metadata, historical),
      currentRealmId: realm.realmId,
      hasLiveRelationship: liveRelationshipByCustomer.has(customer.id),
    });
    if (decision.action === "block") {
      blocked.push({ model: "customer", id: customer.id, label: customerLabel(customer), reason: decision.reason || "Blocked." });
      continue;
    }
    if (decision.action === "mixed") {
      mixed.push({ model: "customer", id: customer.id, label: customerLabel(customer), reason: decision.reason || "Preserved." });
      continue;
    }
    if (decision.action === "delete") deleteCustomers.add(customer.id);
  }

  const deletedIds = {
    customers: deleteCustomers,
    invoices: deleteInvoices,
    payments: deletePayments,
    expenses: deleteExpenses,
  };

  for (const mapping of mappings) {
    if (
      mappingEligibleForHistoricalDelete({
        entityType: mapping.entityType,
        internalId: mapping.internalId,
        metadata: mapping.metadata,
        deletedIds,
      })
    ) {
      deleteMappings.add(mapping.id);
      continue;
    }
    if (
      isHistoricalImportMapping(mapping.metadata) &&
      !isProtectedLiveMappingType(mapping.entityType) &&
      !(FINANCIAL_QBO_MAPPING_TYPES as readonly string[]).includes(mapping.entityType)
    ) {
      blocked.push({
        model: "mapping",
        id: mapping.id,
        label: mapping.entityType,
        reason: "Reference mapping is not tied to a confirmed deletable historical financial record. Left untouched.",
      });
    }
  }

  const deletedTargets = new Set([...deleteCustomers, ...deleteInvoices, ...deletePayments, ...deleteExpenses]);
  const deleteExternalRefs = externalRefs.filter((row) => deletedTargets.has(row.targetRecordId)).map((row) => row.id);

  const deleteSessions: string[] = [];
  for (const session of importSessions) {
    if (session.createdJobs.length || session.createdProperties.length || session.createdEstimates.length || session.createdEquipment.length) {
      blocked.push({
        model: "importSession",
        id: session.id,
        label: session.id,
        reason: "QuickBooks import session still has operational or unmatched children. Left untouched.",
      });
      continue;
    }
    const leftoverCustomer = session.createdCustomers.some((row) => !deleteCustomers.has(row.id));
    const leftoverInvoice = session.createdInvoices.some((row) => !deleteInvoices.has(row.id));
    const leftoverPayment = session.createdPayments.some((row) => !deletePayments.has(row.id));
    const leftoverExpense = session.createdExpenses.some((row) => !deleteExpenses.has(row.id));
    if (leftoverCustomer || leftoverInvoice || leftoverPayment || leftoverExpense) {
      continue;
    }
    if (!isNonOperationalImport(session.importMode) && (session.createdCustomers.length || session.createdInvoices.length)) {
      blocked.push({
        model: "importSession",
        id: session.id,
        label: session.id,
        reason: "QuickBooks import session is not marked historical. Left untouched.",
      });
      continue;
    }
    deleteSessions.push(session.id);
  }

  const counts = emptyCounts();
  counts.invoices = deleteInvoices.size;
  counts.payments = deletePayments.size;
  counts.expenses = deleteExpenses.size;
  counts.customers = deleteCustomers.size;
  counts.mappings = deleteMappings.size;
  counts.reviewItems = reviewItems.length;
  counts.externalRefs = deleteExternalRefs.length;
  counts.importSessions = deleteSessions.length;
  counts.referenceRecords = 0;
  counts.watchdogFindings = await prisma.billingWatchdogFinding.count({
    where: {
      companyId,
      OR: [
        deleteInvoices.size ? { invoiceId: { in: [...deleteInvoices] } } : { id: { in: [] } },
        deletePayments.size ? { paymentId: { in: [...deletePayments] } } : { id: { in: [] } },
      ],
    },
  });

  const unknownRecords =
    invoices.filter((row) => isNonOperationalImport(row.importMode) && !isQuickBooksSource(row.sourceSystem)).length +
    payments.filter((row) => isNonOperationalImport(row.importMode) && !isQuickBooksSource(row.sourceSystem)).length +
    customers.filter((row) => isNonOperationalImport(row.importMode) && !isQuickBooksSource(row.sourceSystem)).length;

  return {
    companyId,
    sourceSystem: QUICKBOOKS_SOURCE,
    realm,
    realmWarning:
      missingRealm > 0
        ? `${missingRealm} historical QuickBooks records do not store a realm ID. They are identified only as QuickBooks HISTORICAL/REFERENCE imports on this ContractorYou company, not as a future production realm.`
        : realm.realmId
          ? "This reset applies only to historical QuickBooks imports associated with this source/realm."
          : "QuickBooks is not connected. Historical records are still identified by importer provenance on this company only.",
    counts,
    preserved: {
      nativeCustomers: customers.filter((row) => !deleteCustomers.has(row.id)).length,
      nativeInvoices: invoices.filter((row) => !deleteInvoices.has(row.id)).length,
      nativePayments: payments.filter((row) => !deletePayments.has(row.id)).length,
      stripePayments: payments.filter((row) => (row.provider || "").toUpperCase() === "STRIPE").length,
      liveJobs: jobs.filter((job) => isLiveOperational(job.importMode)).length,
      liveMappings: mappings.filter((row) => !deleteMappings.has(row.id)).length,
      mixedCustomers: mixed.length,
      unknownRecords,
      highLevelThreads: threads.length,
      connectionIntact: Boolean(realm.connectionStatus),
    },
    mixed,
    blocked,
    deleteIds: {
      customers: [...deleteCustomers],
      invoices: [...deleteInvoices],
      payments: [...deletePayments],
      expenses: [...deleteExpenses],
      mappings: [...deleteMappings],
      reviewItems: reviewItems.map((row) => row.id),
      externalRefs: deleteExternalRefs,
      importSessions: deleteSessions,
    },
    idempotent: Object.values(counts).every((value) => value === 0),
  };
}

export async function dryRunQuickBooksHistoricalReset(input: {
  prisma: PrismaClient;
  companyId: string;
  actorId: string;
}): Promise<QboHistoricalResetResult> {
  const plan = await planQuickBooksHistoricalReset(input.prisma, input.companyId);
  const operation = await persistOperation(input.prisma, {
    companyId: input.companyId,
    actorId: input.actorId,
    mode: "DRY_RUN",
    plan,
  });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "import.reset.quickbooks_historical.dry_run",
    entityType: "ImportResetOperation",
    entityId: operation.id,
    metadata: { counts: plan.counts, blocked: plan.blocked.length, mixed: plan.mixed.length, realmId: plan.realm.realmId },
  });
  return { ...plan, operationId: operation.id, mode: "DRY_RUN", executed: false };
}

export async function executeQuickBooksHistoricalReset(input: {
  prisma: PrismaClient;
  companyId: string;
  actorId: string;
  confirmation: string;
}): Promise<QboHistoricalResetResult> {
  if (input.confirmation.trim() !== QBO_RESET_CONFIRMATION) {
    throw new Error(`Type ${QBO_RESET_CONFIRMATION} to confirm. Nothing was deleted.`);
  }
  const plan = await planQuickBooksHistoricalReset(input.prisma, input.companyId);
  const ids = plan.deleteIds ?? emptyIds();
  if (plan.idempotent) {
    const operation = await persistOperation(input.prisma, {
      companyId: input.companyId,
      actorId: input.actorId,
      mode: "EXECUTE",
      plan,
      idempotentReplay: true,
    });
    return { ...plan, operationId: operation.id, mode: "EXECUTE", executed: false };
  }

  await input.prisma.$transaction(async (tx) => {
    if (ids.invoices.length || ids.payments.length) {
      await tx.billingWatchdogFinding.deleteMany({
        where: {
          companyId: input.companyId,
          OR: [
            ids.invoices.length ? { invoiceId: { in: ids.invoices } } : { id: { in: [] } },
            ids.payments.length ? { paymentId: { in: ids.payments } } : { id: { in: [] } },
          ],
        },
      });
    }
    if (ids.payments.length) {
      await tx.payment.deleteMany({ where: { companyId: input.companyId, id: { in: ids.payments } } });
    }
    if (ids.invoices.length) {
      await tx.invoice.deleteMany({ where: { companyId: input.companyId, id: { in: ids.invoices } } });
    }
    if (ids.expenses.length) {
      await tx.expense.deleteMany({ where: { companyId: input.companyId, id: { in: ids.expenses } } });
    }
    if (ids.customers.length) {
      await tx.customer.deleteMany({ where: { companyId: input.companyId, id: { in: ids.customers } } });
    }
    if (ids.mappings.length) {
      await tx.quickBooksMapping.deleteMany({
        where: {
          companyId: input.companyId,
          id: { in: ids.mappings },
          entityType: { notIn: [...PROTECTED_QBO_MAPPING_TYPES] },
        },
      });
    }
    if (ids.reviewItems.length) {
      await tx.importReviewItem.deleteMany({
        where: { companyId: input.companyId, id: { in: ids.reviewItems }, sourceSystem: QUICKBOOKS_SOURCE },
      });
    }
    if (ids.externalRefs.length) {
      await tx.importExternalRef.deleteMany({
        where: { companyId: input.companyId, id: { in: ids.externalRefs }, sourceSystem: "QUICKBOOKS" },
      });
    }
    if (ids.importSessions.length) {
      await tx.importSession.deleteMany({
        where: { companyId: input.companyId, id: { in: ids.importSessions }, sourceType: "QUICKBOOKS" },
      });
    }
  });

  const operation = await persistOperation(input.prisma, {
    companyId: input.companyId,
    actorId: input.actorId,
    mode: "EXECUTE",
    plan,
  });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "import.reset.quickbooks_historical",
    entityType: "ImportResetOperation",
    entityId: operation.id,
    metadata: { counts: plan.counts, blocked: plan.blocked.length, mixed: plan.mixed.length, realmId: plan.realm.realmId },
  });
  return { ...plan, operationId: operation.id, mode: "EXECUTE", executed: true };
}

async function persistOperation(
  prisma: PrismaClient,
  input: {
    companyId: string;
    actorId: string;
    mode: "DRY_RUN" | "EXECUTE";
    plan: QboHistoricalResetPlan;
    idempotentReplay?: boolean;
  }
) {
  return prisma.importResetOperation.create({
    data: {
      companyId: input.companyId,
      initiatedById: input.actorId,
      sourceSystem: QUICKBOOKS_SOURCE,
      mode: input.mode,
      status: "COMPLETED",
      confirmationPhrase: input.mode === "EXECUTE" ? QBO_RESET_CONFIRMATION : null,
      counts: input.plan.counts,
      preserved: input.plan.preserved,
      blocked: input.plan.blocked,
      mixed: input.plan.mixed,
      census: { realm: input.plan.realm, realmWarning: input.plan.realmWarning },
      idempotentReplay: input.idempotentReplay ?? input.plan.idempotent,
      completedAt: new Date(),
    },
  });
}
