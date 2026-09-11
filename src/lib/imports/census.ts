import type { PrismaClient } from "@prisma/client";
import {
  classifyProvenance,
  HOUSECALL_PRO_SOURCE,
  isAuthoritativeHousecallPro,
  type ProvenanceBucket,
} from "@/lib/imports/provenance";

export type CensusRow = Record<ProvenanceBucket, number>;

export type ProvenanceCensus = {
  customers: CensusRow;
  properties: CensusRow;
  jobs: CensusRow;
  estimates: CensusRow;
  invoices: CensusRow;
  payments: CensusRow;
  equipment: CensusRow;
  expenses: CensusRow;
  notes: CensusRow;
  photos: CensusRow;
  assignments: CensusRow;
  schedulingBookings: CensusRow;
  waitingRecords: CensusRow;
  memberships: CensusRow;
  communications: CensusRow;
  identities: CensusRow;
  receipts: CensusRow;
};

const EMPTY: CensusRow = {
  NATIVE_LIVE: 0,
  HOUSECALL_PRO: 0,
  OTHER_IMPORT: 0,
  QUICKBOOKS: 0,
  HIGHLEVEL: 0,
  STRIPE: 0,
  UNKNOWN: 0,
};

function emptyCensus(): ProvenanceCensus {
  return {
    customers: { ...EMPTY },
    properties: { ...EMPTY },
    jobs: { ...EMPTY },
    estimates: { ...EMPTY },
    invoices: { ...EMPTY },
    payments: { ...EMPTY },
    equipment: { ...EMPTY },
    expenses: { ...EMPTY },
    notes: { ...EMPTY },
    photos: { ...EMPTY },
    assignments: { ...EMPTY },
    schedulingBookings: { ...EMPTY },
    waitingRecords: { ...EMPTY },
    memberships: { ...EMPTY },
    communications: { ...EMPTY },
    identities: { ...EMPTY },
    receipts: { ...EMPTY },
  };
}

function bump(row: CensusRow, bucket: ProvenanceBucket) {
  row[bucket] += 1;
}

export async function loadHousecallProSessionIds(prisma: PrismaClient, companyId: string) {
  const sessions = await prisma.importSession.findMany({
    where: { companyId, sourceType: HOUSECALL_PRO_SOURCE },
    select: { id: true },
  });
  return new Set(sessions.map((session) => session.id));
}

export async function loadHousecallProTargetIds(prisma: PrismaClient, companyId: string) {
  const refs = await prisma.importExternalRef.findMany({
    where: { companyId, sourceSystem: HOUSECALL_PRO_SOURCE },
    select: { recordType: true, targetRecordId: true },
  });
  const byType = new Map<string, Set<string>>();
  for (const ref of refs) {
    const set = byType.get(ref.recordType) ?? new Set<string>();
    set.add(ref.targetRecordId);
    byType.set(ref.recordType, set);
  }
  return byType;
}

export async function buildProvenanceCensus(prisma: PrismaClient, companyId: string): Promise<ProvenanceCensus> {
  const [hcpSessions, hcpTargets, qboMaps, hlMaps] = await Promise.all([
    loadHousecallProSessionIds(prisma, companyId),
    loadHousecallProTargetIds(prisma, companyId),
    prisma.quickBooksMapping.findMany({
      where: { companyId, entityType: "CUSTOMER" },
      select: { internalId: true },
    }),
    prisma.providerIdentityMap.findMany({
      where: { companyId, provider: "highlevel", entityType: "CUSTOMER" },
      select: { internalId: true },
    }),
  ]);
  const qboCustomers = new Set(qboMaps.map((row) => row.internalId));
  const hlCustomers = new Set(hlMaps.map((row) => row.internalId));
  const sessions = await prisma.importSession.findMany({
    where: { companyId },
    select: { id: true, sourceType: true },
  });
  const sessionSource = new Map(sessions.map((session) => [session.id, session.sourceType]));

  const census = emptyCensus();

  const customers = await prisma.customer.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true, externalId: true },
  });
  for (const row of customers) {
    bump(
      census.customers,
      classifyProvenance({
        sourceSystem: row.sourceSystem,
        importMode: row.importMode,
        importSessionId: row.importSessionId,
        importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
        externalId: row.externalId,
        hasHousecallProRef: hcpTargets.get("CUSTOMERS")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
        hasQuickBooksMapping: qboCustomers.has(row.id),
        hasHighLevelIdentity: hlCustomers.has(row.id),
      })
    );
  }

  const properties = await prisma.property.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true, externalId: true },
  });
  for (const row of properties) {
    bump(
      census.properties,
      classifyProvenance({
        sourceSystem: row.sourceSystem,
        importMode: row.importMode,
        importSessionId: row.importSessionId,
        importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
        externalId: row.externalId,
        hasHousecallProRef: hcpTargets.get("PROPERTIES")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
      })
    );
  }

  const jobs = await prisma.job.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true, externalId: true },
  });
  const jobBucket = new Map<string, ProvenanceBucket>();
  for (const row of jobs) {
    const bucket = classifyProvenance({
      sourceSystem: row.sourceSystem,
      importMode: row.importMode,
      importSessionId: row.importSessionId,
      importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
      externalId: row.externalId,
      hasHousecallProRef: hcpTargets.get("JOBS")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
    });
    jobBucket.set(row.id, bucket);
    bump(census.jobs, bucket);
  }

  const estimates = await prisma.estimate.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true, externalId: true },
  });
  for (const row of estimates) {
    bump(
      census.estimates,
      classifyProvenance({
        sourceSystem: row.sourceSystem,
        importMode: row.importMode,
        importSessionId: row.importSessionId,
        importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
        hasHousecallProRef: hcpTargets.get("ESTIMATES")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
      })
    );
  }

  const invoices = await prisma.invoice.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true, externalId: true },
  });
  for (const row of invoices) {
    bump(
      census.invoices,
      classifyProvenance({
        sourceSystem: row.sourceSystem,
        importMode: row.importMode,
        importSessionId: row.importSessionId,
        importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
        hasHousecallProRef: hcpTargets.get("INVOICES")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
      })
    );
  }

  const payments = await prisma.payment.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true, provider: true },
  });
  for (const row of payments) {
    bump(
      census.payments,
      classifyProvenance({
        sourceSystem: row.sourceSystem,
        importMode: row.importMode,
        importSessionId: row.importSessionId,
        importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
        provider: row.provider,
        hasHousecallProRef: hcpTargets.get("PAYMENTS")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
      })
    );
  }

  const equipment = await prisma.equipment.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true },
  });
  for (const row of equipment) {
    bump(
      census.equipment,
      classifyProvenance({
        sourceSystem: row.sourceSystem,
        importMode: row.importMode,
        importSessionId: row.importSessionId,
        importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
        hasHousecallProRef: hcpTargets.get("EQUIPMENT")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
      })
    );
  }

  const expenses = await prisma.expense.findMany({
    where: { companyId },
    select: { id: true, sourceSystem: true, importMode: true, importSessionId: true },
  });
  for (const row of expenses) {
    bump(
      census.expenses,
      classifyProvenance({
        sourceSystem: row.sourceSystem,
        importMode: row.importMode,
        importSessionId: row.importSessionId,
        importSessionSource: row.importSessionId ? sessionSource.get(row.importSessionId) : null,
        hasHousecallProRef: hcpTargets.get("EXPENSES")?.has(row.id) || hcpSessions.has(row.importSessionId || ""),
      })
    );
  }

  const notes = await prisma.customerNote.findMany({
    where: { companyId },
    select: { id: true, jobId: true },
  });
  for (const row of notes) {
    bump(census.notes, row.jobId ? jobBucket.get(row.jobId) ?? "NATIVE_LIVE" : "NATIVE_LIVE");
  }

  const photos = await prisma.jobPhoto.findMany({
    where: { companyId, deletedAt: null },
    select: { jobId: true },
  });
  for (const row of photos) {
    bump(census.photos, jobBucket.get(row.jobId) ?? "NATIVE_LIVE");
  }

  const assignments = await prisma.jobAssignment.findMany({
    where: { job: { companyId } },
    select: { jobId: true },
  });
  for (const row of assignments) {
    bump(census.assignments, jobBucket.get(row.jobId) ?? "NATIVE_LIVE");
  }

  const bookings = await prisma.schedulingBooking.findMany({
    where: { companyId },
    select: { jobId: true },
  });
  for (const row of bookings) {
    bump(census.schedulingBookings, row.jobId ? jobBucket.get(row.jobId) ?? "NATIVE_LIVE" : "NATIVE_LIVE");
  }

  census.waitingRecords.NATIVE_LIVE = await prisma.waitingRecord.count({ where: { companyId } });
  census.memberships.NATIVE_LIVE = await prisma.customerMembership.count({ where: { companyId } });
  census.communications.HIGHLEVEL = await prisma.communicationThread.count({ where: { companyId } });
  census.identities.HIGHLEVEL = hlMaps.length;
  census.identities.QUICKBOOKS = qboMaps.length;
  census.identities.HOUSECALL_PRO = (hcpTargets.get("CUSTOMERS")?.size ?? 0);
  census.receipts.NATIVE_LIVE = await prisma.receipt.count({ where: { companyId } });

  return census;
}

export function isHousecallProRecord(input: {
  sourceSystem?: string | null;
  importMode?: string | null;
  importSessionId?: string | null;
  sessionIds: Set<string>;
  targetIds?: Set<string>;
  id: string;
  sessionSource?: string | null;
}) {
  return isAuthoritativeHousecallPro({
    sourceSystem: input.sourceSystem,
    importMode: input.importMode,
    importSessionId: input.importSessionId,
    importSessionSource: input.sessionSource,
    hasHousecallProRef: input.targetIds?.has(input.id) || input.sessionIds.has(input.importSessionId || ""),
  });
}
