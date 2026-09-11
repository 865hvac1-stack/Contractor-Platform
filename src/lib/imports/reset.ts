import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { isLiveOperational } from "@/lib/imports/modes";
import { HCP_RESET_CONFIRMATION, HOUSECALL_PRO_SOURCE } from "@/lib/imports/provenance";
import {
  buildProvenanceCensus,
  loadHousecallProSessionIds,
  loadHousecallProTargetIds,
  type ProvenanceCensus,
} from "@/lib/imports/census";

export { HCP_RESET_CONFIRMATION };

export type ResetCountKey =
  | "customers"
  | "properties"
  | "jobs"
  | "estimates"
  | "invoices"
  | "payments"
  | "equipment"
  | "expenses"
  | "notes"
  | "photos"
  | "assignments"
  | "workflowEvents"
  | "checklistItems"
  | "watchdogFindings"
  | "externalRefs";

export type ResetCounts = Record<ResetCountKey, number>;

export type MixedRecord = {
  model: "customer" | "property";
  id: string;
  label: string;
  reason: string;
};

export type BlockedRecord = {
  model: string;
  id: string;
  label: string;
  reason: string;
};

export type HousecallResetPlan = {
  companyId: string;
  sourceSystem: typeof HOUSECALL_PRO_SOURCE;
  counts: ResetCounts;
  preserved: {
    nativeCustomers: number;
    nativeProperties: number;
    nativeJobs: number;
    nativeInvoices: number;
    nativeEstimates: number;
    nativePayments: number;
    stripePayments: number;
    quickBooksMappings: number;
    highLevelThreads: number;
    schedulingBookings: number;
    mixedCustomers: number;
    mixedProperties: number;
    unknownRecords: number;
  };
  mixed: MixedRecord[];
  blocked: BlockedRecord[];
  census: ProvenanceCensus;
  idempotent: boolean;
};

export type HousecallResetResult = HousecallResetPlan & {
  operationId: string;
  mode: "DRY_RUN" | "EXECUTE";
  executed: boolean;
};

function emptyCounts(): ResetCounts {
  return {
    customers: 0,
    properties: 0,
    jobs: 0,
    estimates: 0,
    invoices: 0,
    payments: 0,
    equipment: 0,
    expenses: 0,
    notes: 0,
    photos: 0,
    assignments: 0,
    workflowEvents: 0,
    checklistItems: 0,
    watchdogFindings: 0,
    externalRefs: 0,
  };
}

function isHcp(row: {
  id: string;
  sourceSystem?: string | null;
  importSessionId?: string | null;
}, sessions: Set<string>, targets?: Set<string>) {
  const source = (row.sourceSystem || "").toUpperCase().replace(/[\s-]+/g, "_");
  return source === HOUSECALL_PRO_SOURCE || sessions.has(row.importSessionId || "") || Boolean(targets?.has(row.id));
}

function customerLabel(row: { firstName: string; lastName: string; businessName: string | null }) {
  return row.businessName?.trim() || `${row.firstName} ${row.lastName}`.trim() || "Customer";
}

export async function planHousecallProReset(
  prisma: PrismaClient,
  companyId: string
): Promise<HousecallResetPlan> {
  const [sessions, targets, census] = await Promise.all([
    loadHousecallProSessionIds(prisma, companyId),
    loadHousecallProTargetIds(prisma, companyId),
    buildProvenanceCensus(prisma, companyId),
  ]);

  const [
    customers,
    properties,
    jobs,
    estimates,
    invoices,
    payments,
    equipment,
    expenses,
    qboMaps,
    threads,
    bookings,
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
        importSessionId: true,
        externalId: true,
      },
    }),
    prisma.property.findMany({
      where: { companyId },
      select: {
        id: true,
        customerId: true,
        address: true,
        city: true,
        sourceSystem: true,
        importMode: true,
        importSessionId: true,
      },
    }),
    prisma.job.findMany({
      where: { companyId },
      select: {
        id: true,
        jobNumber: true,
        customerId: true,
        propertyId: true,
        sourceSystem: true,
        importMode: true,
        importSessionId: true,
        status: true,
      },
    }),
    prisma.estimate.findMany({
      where: { companyId },
      select: {
        id: true,
        estimateNumber: true,
        customerId: true,
        jobId: true,
        sourceSystem: true,
        importMode: true,
        importSessionId: true,
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
        importSessionId: true,
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
        importSessionId: true,
      },
    }),
    prisma.equipment.findMany({
      where: { companyId },
      select: { id: true, customerId: true, propertyId: true, sourceSystem: true, importMode: true, importSessionId: true },
    }),
    prisma.expense.findMany({
      where: { companyId },
      select: { id: true, customerId: true, jobId: true, sourceSystem: true, importMode: true, importSessionId: true },
    }),
    prisma.quickBooksMapping.findMany({ where: { companyId }, select: { entityType: true, internalId: true } }),
    prisma.communicationThread.findMany({ where: { companyId }, select: { customerId: true } }),
    prisma.schedulingBooking.findMany({ where: { companyId }, select: { jobId: true } }),
  ]);

  const hcpJobIds = new Set(
    jobs.filter((row) => isHcp(row, sessions, targets.get("JOBS"))).map((row) => row.id)
  );
  const liveJobByCustomer = new Set(
    jobs.filter((row) => isLiveOperational(row.importMode) && !hcpJobIds.has(row.id)).map((row) => row.customerId)
  );
  const liveJobByProperty = new Set(
    jobs.filter((row) => isLiveOperational(row.importMode) && !hcpJobIds.has(row.id)).map((row) => row.propertyId)
  );
  const liveInvoiceByCustomer = new Set(
    invoices
      .filter((row) => isLiveOperational(row.importMode) && !isHcp(row, sessions, targets.get("INVOICES")))
      .map((row) => row.customerId)
  );
  const liveEstimateByCustomer = new Set(
    estimates
      .filter((row) => isLiveOperational(row.importMode) && !isHcp(row, sessions, targets.get("ESTIMATES")))
      .map((row) => row.customerId)
  );
  const stripeByInvoice = new Set(payments.filter((row) => (row.provider || "").toUpperCase() === "STRIPE").map((row) => row.invoiceId));
  const stripeByCustomer = new Set(
    invoices.filter((row) => stripeByInvoice.has(row.id)).map((row) => row.customerId)
  );
  const qboByCustomer = new Set(qboMaps.filter((row) => row.entityType === "CUSTOMER").map((row) => row.internalId));
  const qboByInvoice = new Set(qboMaps.filter((row) => row.entityType === "INVOICE").map((row) => row.internalId));
  const threadByCustomer = new Set(threads.map((row) => row.customerId).filter(Boolean) as string[]);
  const bookedJobs = new Set(bookings.map((row) => row.jobId));

  const counts = emptyCounts();
  const mixed: MixedRecord[] = [];
  const blocked: BlockedRecord[] = [];
  const deleteCustomers = new Set<string>();
  const preserveCustomers = new Set<string>();
  const deleteProperties = new Set<string>();
  const deleteJobs = new Set<string>();
  const deleteEstimates = new Set<string>();
  const deleteInvoices = new Set<string>();
  const deletePayments = new Set<string>();
  const deleteEquipment = new Set<string>();
  const deleteExpenses = new Set<string>();

  for (const invoice of invoices) {
    if (!isHcp(invoice, sessions, targets.get("INVOICES"))) continue;
    if (stripeByInvoice.has(invoice.id)) {
      blocked.push({
        model: "invoice",
        id: invoice.id,
        label: invoice.invoiceNumber,
        reason: "Has a Stripe payment. Imported invoice is blocked; Stripe payment is preserved.",
      });
      continue;
    }
    if (qboByInvoice.has(invoice.id)) {
      blocked.push({
        model: "invoice",
        id: invoice.id,
        label: invoice.invoiceNumber,
        reason: "Has a QuickBooks mapping. Invoice is preserved to avoid breaking the ledger link.",
      });
      continue;
    }
    deleteInvoices.add(invoice.id);
  }

  for (const payment of payments) {
    if ((payment.provider || "").toUpperCase() === "STRIPE") continue;
    if (!isHcp(payment, sessions, targets.get("PAYMENTS")) && !deleteInvoices.has(payment.invoiceId)) continue;
    if (stripeByInvoice.has(payment.invoiceId) && !isHcp(payment, sessions, targets.get("PAYMENTS"))) continue;
    if (!deleteInvoices.has(payment.invoiceId) && !isHcp(payment, sessions, targets.get("PAYMENTS"))) continue;
    if (deleteInvoices.has(payment.invoiceId) || isHcp(payment, sessions, targets.get("PAYMENTS"))) {
      deletePayments.add(payment.id);
    }
  }

  for (const estimate of estimates) {
    if (!isHcp(estimate, sessions, targets.get("ESTIMATES"))) continue;
    deleteEstimates.add(estimate.id);
  }

  for (const job of jobs) {
    if (!hcpJobIds.has(job.id)) continue;
    if (bookedJobs.has(job.id)) {
      blocked.push({
        model: "job",
        id: job.id,
        label: job.jobNumber,
        reason: "Has a live ContractorYou scheduling booking. Historical job is blocked.",
      });
      continue;
    }
    const liveInvoice = invoices.some(
      (invoice) => invoice.jobId === job.id && !deleteInvoices.has(invoice.id) && isLiveOperational(invoice.importMode)
    );
    if (liveInvoice) {
      blocked.push({
        model: "job",
        id: job.id,
        label: job.jobNumber,
        reason: "Owns a live ContractorYou invoice. Historical job is blocked; live invoice is preserved.",
      });
      continue;
    }
    deleteJobs.add(job.id);
  }

  for (const row of equipment) {
    if (isHcp(row, sessions, targets.get("EQUIPMENT"))) deleteEquipment.add(row.id);
  }
  for (const row of expenses) {
    if (isHcp(row, sessions, targets.get("EXPENSES")) || (row.jobId && deleteJobs.has(row.jobId))) {
      deleteExpenses.add(row.id);
    }
  }

  for (const property of properties) {
    if (!isHcp(property, sessions, targets.get("PROPERTIES"))) continue;
    const liveChild =
      liveJobByProperty.has(property.id) ||
      jobs.some((job) => job.propertyId === property.id && !deleteJobs.has(job.id) && isLiveOperational(job.importMode));
    if (liveChild) {
      preserveCustomers.add(property.customerId);
      mixed.push({
        model: "property",
        id: property.id,
        label: `${property.address}, ${property.city}`,
        reason: "Imported property now owns live ContractorYou work. Property is preserved; only removable imported children are deleted.",
      });
      continue;
    }
    deleteProperties.add(property.id);
  }

  for (const customer of customers) {
    const imported = isHcp(customer, sessions, targets.get("CUSTOMERS"));
    if (!imported) {
      preserveCustomers.add(customer.id);
      continue;
    }
    const liveTouch =
      liveJobByCustomer.has(customer.id) ||
      liveInvoiceByCustomer.has(customer.id) ||
      liveEstimateByCustomer.has(customer.id) ||
      stripeByCustomer.has(customer.id) ||
      qboByCustomer.has(customer.id) ||
      threadByCustomer.has(customer.id) ||
      jobs.some((job) => job.customerId === customer.id && bookedJobs.has(job.id)) ||
      jobs.some((job) => job.customerId === customer.id && !deleteJobs.has(job.id) && isLiveOperational(job.importMode)) ||
      invoices.some((invoice) => invoice.customerId === customer.id && !deleteInvoices.has(invoice.id) && isLiveOperational(invoice.importMode));

    if (liveTouch) {
      preserveCustomers.add(customer.id);
      mixed.push({
        model: "customer",
        id: customer.id,
        label: customerLabel(customer),
        reason: "Imported customer now has live ContractorYou, Stripe, QuickBooks, HighLevel, or scheduling records. Customer is preserved.",
      });
      continue;
    }
    deleteCustomers.add(customer.id);
  }

  const remainingHcpProperties = properties.filter(
    (property) => deleteCustomers.has(property.customerId) && !deleteProperties.has(property.id)
  );
  for (const property of remainingHcpProperties) {
    if (
      jobs.some((job) => job.propertyId === property.id && !deleteJobs.has(job.id) && isLiveOperational(job.importMode))
    ) {
      continue;
    }
    deleteProperties.add(property.id);
  }

  counts.customers = deleteCustomers.size;
  counts.properties = deleteProperties.size;
  counts.jobs = deleteJobs.size;
  counts.estimates = deleteEstimates.size;
  counts.invoices = deleteInvoices.size;
  counts.payments = deletePayments.size;
  counts.equipment = deleteEquipment.size;
  counts.expenses = deleteExpenses.size;

  const photos = await prisma.jobPhoto.count({ where: { companyId, jobId: { in: [...deleteJobs] } } });
  const assignments = await prisma.jobAssignment.count({ where: { jobId: { in: [...deleteJobs] } } });
  const notes = await prisma.customerNote.count({
    where: { companyId, OR: [{ jobId: { in: [...deleteJobs] } }, { customerId: { in: [...deleteCustomers] } }] },
  });
  const workflowEvents = await prisma.jobWorkflowEvent.count({
    where: { companyId, jobId: { in: [...deleteJobs] } },
  });
  const checklistItems = await prisma.jobChecklistItem.count({
    where: { companyId, jobId: { in: [...deleteJobs] } },
  });
  const watchdogFindings = await prisma.billingWatchdogFinding.count({
    where: { companyId, jobId: { in: [...deleteJobs] } },
  });
  const externalRefs = await prisma.importExternalRef.count({
    where: { companyId, sourceSystem: HOUSECALL_PRO_SOURCE },
  });

  counts.photos = photos;
  counts.assignments = assignments;
  counts.notes = notes;
  counts.workflowEvents = workflowEvents;
  counts.checklistItems = checklistItems;
  counts.watchdogFindings = watchdogFindings;
  counts.externalRefs = externalRefs;

  const plan: HousecallResetPlan = {
    companyId,
    sourceSystem: HOUSECALL_PRO_SOURCE,
    counts,
    preserved: {
      nativeCustomers: customers.filter((row) => !deleteCustomers.has(row.id)).length,
      nativeProperties: properties.filter((row) => !deleteProperties.has(row.id)).length,
      nativeJobs: jobs.filter((row) => !deleteJobs.has(row.id)).length,
      nativeInvoices: invoices.filter((row) => !deleteInvoices.has(row.id)).length,
      nativeEstimates: estimates.filter((row) => !deleteEstimates.has(row.id)).length,
      nativePayments: payments.filter((row) => !deletePayments.has(row.id)).length,
      stripePayments: payments.filter((row) => (row.provider || "").toUpperCase() === "STRIPE").length,
      quickBooksMappings: qboMaps.length,
      highLevelThreads: threads.length,
      schedulingBookings: bookings.length,
      mixedCustomers: mixed.filter((row) => row.model === "customer").length,
      mixedProperties: mixed.filter((row) => row.model === "property").length,
      unknownRecords: census.customers.UNKNOWN + census.jobs.UNKNOWN + census.invoices.UNKNOWN,
    },
    mixed,
    blocked,
    census,
    idempotent: Object.values(counts).every((value) => value === 0),
  };

  Object.assign(plan, {
    deleteIds: {
      customers: [...deleteCustomers],
      properties: [...deleteProperties],
      jobs: [...deleteJobs],
      estimates: [...deleteEstimates],
      invoices: [...deleteInvoices],
      payments: [...deletePayments],
      equipment: [...deleteEquipment],
      expenses: [...deleteExpenses],
    },
  });
  return plan;
}

type PlannedIds = {
  customers: string[];
  properties: string[];
  jobs: string[];
  estimates: string[];
  invoices: string[];
  payments: string[];
  equipment: string[];
  expenses: string[];
};

function plannedIds(plan: HousecallResetPlan): PlannedIds {
  return (
    (plan as HousecallResetPlan & { deleteIds?: PlannedIds }).deleteIds ?? {
      customers: [],
      properties: [],
      jobs: [],
      estimates: [],
      invoices: [],
      payments: [],
      equipment: [],
      expenses: [],
    }
  );
}

async function deleteMany(prisma: Prisma.TransactionClient | PrismaClient, model: string, where: object) {
  const delegate = (prisma as unknown as Record<string, { deleteMany: (args: { where: object }) => Promise<{ count: number }> }>)[model];
  if (!delegate) return 0;
  const result = await delegate.deleteMany({ where });
  return result.count;
}

export async function executeHousecallProReset(input: {
  prisma: PrismaClient;
  companyId: string;
  actorId: string;
  confirmation: string;
}): Promise<HousecallResetResult> {
  if (input.confirmation.trim() !== HCP_RESET_CONFIRMATION) {
    throw new Error(`Type ${HCP_RESET_CONFIRMATION} to confirm. Nothing was deleted.`);
  }

  const plan = await planHousecallProReset(input.prisma, input.companyId);
  const ids = plannedIds(plan);
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
    if (ids.jobs.length) {
      await deleteMany(tx, "billingWatchdogFinding", { companyId: input.companyId, jobId: { in: ids.jobs } });
      await deleteMany(tx, "jobChecklistItem", { companyId: input.companyId, jobId: { in: ids.jobs } });
      await deleteMany(tx, "jobWorkflowEvent", { companyId: input.companyId, jobId: { in: ids.jobs } });
      await deleteMany(tx, "jobPhoto", { companyId: input.companyId, jobId: { in: ids.jobs } });
      await deleteMany(tx, "customerNote", { companyId: input.companyId, jobId: { in: ids.jobs } });
      await deleteMany(tx, "jobAssignment", { jobId: { in: ids.jobs } });
      await tx.job.updateMany({
        where: { companyId: input.companyId, id: { in: ids.jobs }, estimateId: { not: null } },
        data: { estimateId: null },
      });
    }
    if (ids.payments.length) {
      await deleteMany(tx, "payment", { companyId: input.companyId, id: { in: ids.payments } });
    }
    if (ids.invoices.length) {
      await deleteMany(tx, "invoice", { companyId: input.companyId, id: { in: ids.invoices } });
    }
    if (ids.estimates.length) {
      await deleteMany(tx, "estimate", { companyId: input.companyId, id: { in: ids.estimates } });
    }
    if (ids.expenses.length) {
      await deleteMany(tx, "expense", { companyId: input.companyId, id: { in: ids.expenses } });
    }
    if (ids.jobs.length) {
      await deleteMany(tx, "job", { companyId: input.companyId, id: { in: ids.jobs } });
    }
    if (ids.equipment.length) {
      await deleteMany(tx, "equipment", { companyId: input.companyId, id: { in: ids.equipment } });
    }
    if (ids.properties.length) {
      await deleteMany(tx, "property", { companyId: input.companyId, id: { in: ids.properties } });
    }
    if (ids.customers.length) {
      await deleteMany(tx, "customerNote", { companyId: input.companyId, customerId: { in: ids.customers } });
      await deleteMany(tx, "customer", { companyId: input.companyId, id: { in: ids.customers } });
    }
    await deleteMany(tx, "importExternalRef", { companyId: input.companyId, sourceSystem: HOUSECALL_PRO_SOURCE });
  });

  const operation = await persistOperation(input.prisma, {
    companyId: input.companyId,
    actorId: input.actorId,
    mode: "EXECUTE",
    plan,
    idempotentReplay: false,
  });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "import.reset.housecall_pro",
    entityType: "ImportResetOperation",
    entityId: operation.id,
    metadata: { counts: plan.counts, blocked: plan.blocked.length, mixed: plan.mixed.length },
  });
  return { ...plan, operationId: operation.id, mode: "EXECUTE", executed: true };
}

export async function dryRunHousecallProReset(input: {
  prisma: PrismaClient;
  companyId: string;
  actorId: string;
}): Promise<HousecallResetResult> {
  const plan = await planHousecallProReset(input.prisma, input.companyId);
  const operation = await persistOperation(input.prisma, {
    companyId: input.companyId,
    actorId: input.actorId,
    mode: "DRY_RUN",
    plan,
    idempotentReplay: plan.idempotent,
  });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "import.reset.housecall_pro.dry_run",
    entityType: "ImportResetOperation",
    entityId: operation.id,
    metadata: { counts: plan.counts, blocked: plan.blocked.length, mixed: plan.mixed.length },
  });
  return { ...plan, operationId: operation.id, mode: "DRY_RUN", executed: false };
}

async function persistOperation(
  prisma: PrismaClient,
  input: {
    companyId: string;
    actorId: string;
    mode: "DRY_RUN" | "EXECUTE";
    plan: HousecallResetPlan;
    idempotentReplay: boolean;
  }
) {
  return prisma.importResetOperation.create({
    data: {
      companyId: input.companyId,
      initiatedById: input.actorId,
      sourceSystem: HOUSECALL_PRO_SOURCE,
      mode: input.mode,
      status: "COMPLETED",
      confirmationPhrase: input.mode === "EXECUTE" ? HCP_RESET_CONFIRMATION : null,
      counts: input.plan.counts,
      preserved: input.plan.preserved,
      blocked: input.plan.blocked,
      mixed: input.plan.mixed,
      census: input.plan.census,
      idempotentReplay: input.idempotentReplay,
      completedAt: new Date(),
    },
  });
}

export function canManageImportReset(role: string, isPlatformAdmin: boolean) {
  return isPlatformAdmin || role === "COMPANY_OWNER" || role === "ADMIN";
}
