import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { customerDisplayName } from "@/lib/actions/eligibility";
import { ensureWaitingSetup } from "@/lib/waiting/columns";
import { daysWaitingSince } from "@/lib/waiting/schedule";
import { processDueWaitingUpdates } from "@/lib/waiting/processor";
import { syncCompanyWaitingReplies } from "@/lib/waiting/replies";
import { itemNameFromMetadata, parseWaitingMetadata, type WaitingCard } from "@/lib/waiting/types";

export type WaitingBoardFilters = {
  q?: string;
  columnId?: string;
  ownerId?: string;
  technicianId?: string;
  overdue?: boolean;
  updateDue?: boolean;
  priority?: string;
  serviceType?: string;
  minDays?: number;
};

export async function loadWaitingBoard(
  companyId: string,
  filters: WaitingBoardFilters = {},
  access: Record<string, unknown> = {}
) {
  await ensureWaitingSetup(companyId);
  await processDueWaitingUpdates({ companyId, limit: 25 });
  await syncCompanyWaitingReplies(companyId);

  const columns = await prisma.waitingColumn.findMany({
    where: { companyId, archivedAt: null },
    orderBy: { sortOrder: "asc" },
  });

  const where: Prisma.WaitingRecordWhereInput = {
    companyId,
    state: "ACTIVE",
    ...(filters.columnId ? { columnId: filters.columnId } : {}),
    ...(filters.ownerId ? { assignedOwnerUserId: filters.ownerId } : {}),
    ...(filters.priority ? { priority: filters.priority as WaitingCard["priority"] } : {}),
  };

  const jobWhere: Prisma.JobWhereInput = { ...(access as Prisma.JobWhereInput) };
  if (filters.technicianId) {
    jobWhere.assignments = { some: { userId: filters.technicianId } };
  }
  if (filters.serviceType) {
    jobWhere.OR = [
      { serviceType: { name: { contains: filters.serviceType, mode: "insensitive" } } },
      { jobType: { contains: filters.serviceType, mode: "insensitive" } },
    ];
  }
  if (Object.keys(jobWhere).length > 0) where.job = jobWhere;
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { job: { jobNumber: { contains: q, mode: "insensitive" } } },
      { customer: { firstName: { contains: q, mode: "insensitive" } } },
      { customer: { lastName: { contains: q, mode: "insensitive" } } },
      { customer: { phone: { contains: q.replace(/\D/g, "") } } },
      { property: { address: { contains: q, mode: "insensitive" } } },
      { reason: { contains: q, mode: "insensitive" } },
    ];
  }

  const records = await prisma.waitingRecord.findMany({
    where,
    include: {
      column: true,
      customer: { select: { firstName: true, lastName: true, businessName: true } },
      property: { select: { address: true, city: true, state: true, zip: true } },
      assignedOwner: { select: { firstName: true, lastName: true } },
      job: {
        select: {
          jobNumber: true,
          status: true,
          assignments: { include: { user: { select: { firstName: true, lastName: true } } }, take: 1 },
        },
      },
    },
    orderBy: [{ priority: "desc" }, { enteredAt: "asc" }],
    take: 300,
  });

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const cards: WaitingCard[] = records
    .map((record) => {
      const meta = parseWaitingMetadata(record.metadata);
      const days = daysWaitingSince(record.enteredAt, now);
      const overdue = Boolean(record.expectedResolutionAt && record.expectedResolutionAt < now && record.column.kind !== "READY");
      const warning = days >= record.column.warningDays;
      const urgent = days >= record.column.urgentDays;
      return {
        id: record.id,
        jobId: record.jobId,
        customerId: record.customerId,
        propertyId: record.propertyId,
        columnId: record.columnId,
        columnKey: record.column.key,
        columnName: record.column.name,
        columnKind: record.column.kind,
        state: record.state,
        customerName: customerDisplayName(record.customer),
        jobNumber: record.job.jobNumber,
        address: record.property
          ? [record.property.address, record.property.city].filter(Boolean).join(", ")
          : "",
        reason: record.reason,
        waitingFor: itemNameFromMetadata(meta, "") || meta.waitingFor || null,
        enteredAt: record.enteredAt,
        daysWaiting: days,
        technicianName: record.job.assignments[0]
          ? `${record.job.assignments[0].user.firstName} ${record.job.assignments[0].user.lastName}`.trim()
          : null,
        ownerName: record.assignedOwner
          ? `${record.assignedOwner.firstName} ${record.assignedOwner.lastName}`.trim()
          : null,
        assignedOwnerUserId: record.assignedOwnerUserId,
        lastCustomerUpdateAt: record.lastCustomerUpdateAt,
        nextCustomerUpdateAt: record.nextCustomerUpdateAt,
        expectedResolutionAt: record.expectedResolutionAt,
        priority: record.priority,
        overdue,
        warning,
        urgent,
        communicationStatus: record.lastCommunicationStatus,
        communicationError: record.lastCommunicationError,
        customerReplied: Boolean(record.customerRepliedAt),
        communicationEnabled: record.communicationEnabled,
        automationEnabled: record.automationEnabled,
        cadence: record.cadence,
        metadata: meta,
      };
    })
    .filter((card) => {
      if (filters.overdue && !card.overdue && !card.urgent) return false;
      if (filters.updateDue) {
        if (!card.nextCustomerUpdateAt) return false;
        if (card.nextCustomerUpdateAt < startOfToday || card.nextCustomerUpdateAt > endOfToday) return false;
      }
      if (filters.minDays && card.daysWaiting < filters.minDays) return false;
      if (filters.q?.trim()) {
        const q = filters.q.trim().toLowerCase();
        const part = card.metadata.part?.name?.toLowerCase() ?? "";
        const po = (card.metadata.part?.poNumber || card.metadata.poNumber || "").toLowerCase();
        if (
          !card.customerName.toLowerCase().includes(q) &&
          !card.jobNumber.toLowerCase().includes(q) &&
          !card.address.toLowerCase().includes(q) &&
          !part.includes(q) &&
          !po.includes(q) &&
          !(card.waitingFor ?? "").toLowerCase().includes(q)
        ) {
          // already filtered by prisma OR; keep if prisma matched
        }
      }
      return true;
    });

  return {
    columns: columns.map((column) => ({
      ...column,
      cards: cards.filter((card) => card.columnId === column.id),
    })),
    cards,
  };
}

export async function loadWaitingDetail(companyId: string, recordId: string) {
  const { waitingRecordInclude } = await import("@/lib/waiting/records");
  return prisma.waitingRecord.findFirst({
    where: { id: recordId, companyId },
    include: waitingRecordInclude,
  });
}

export async function loadWaitingDetails(companyId: string, recordIds: string[]) {
  if (recordIds.length === 0) return [];
  const { waitingRecordInclude } = await import("@/lib/waiting/records");
  return prisma.waitingRecord.findMany({
    where: { companyId, id: { in: recordIds } },
    include: waitingRecordInclude,
  });
}

export async function loadActiveWaitingForJob(companyId: string, jobId: string) {
  await ensureWaitingSetup(companyId);
  return prisma.waitingRecord.findFirst({
    where: { companyId, jobId, state: "ACTIVE" },
    include: { column: true, assignedOwner: { select: { firstName: true, lastName: true } } },
  });
}

export async function loadActiveWaitingForCustomer(companyId: string, customerId: string) {
  return prisma.waitingRecord.findMany({
    where: { companyId, customerId, state: "ACTIVE" },
    include: { column: true, job: { select: { jobNumber: true } } },
    orderBy: { enteredAt: "asc" },
    take: 5,
  });
}

export async function searchJobsForWaiting(companyId: string, q: string, assignedUserId?: string | null) {
  const term = q.trim();
  if (term.length < 2) return [];
  return prisma.job.findMany({
    where: {
      companyId,
      status: { notIn: ["COMPLETED", "CANCELED"] },
      waitingRecords: { none: { state: "ACTIVE" } },
      ...(assignedUserId ? { assignments: { some: { userId: assignedUserId } } } : {}),
      OR: [
        { jobNumber: { contains: term, mode: "insensitive" } },
        { customer: { firstName: { contains: term, mode: "insensitive" } } },
        { customer: { lastName: { contains: term, mode: "insensitive" } } },
        { customer: { phone: { contains: term.replace(/\D/g, "") } } },
        { property: { address: { contains: term, mode: "insensitive" } } },
      ],
    },
    take: 12,
    select: {
      id: true,
      jobNumber: true,
      status: true,
      customer: { select: { firstName: true, lastName: true, businessName: true } },
      property: { select: { address: true, city: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

