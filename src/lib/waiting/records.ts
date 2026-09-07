import type { JobStatus, Prisma, PrismaClient, WaitingCadence } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ensureWaitingSetup } from "@/lib/waiting/columns";
import { sendWaitingCommunication } from "@/lib/waiting/messages";
import { nextCustomerUpdateAt } from "@/lib/waiting/schedule";
import { nextJobStatusForWaiting, shouldStopWaitingAutomation } from "@/lib/waiting/safety";
import { syncWaitingCustomerReply } from "@/lib/waiting/replies";
import {
  isReadyColumn,
  parseWaitingMetadata,
  type WaitingMetadata,
  type WaitingTransitionActions,
} from "@/lib/waiting/types";

export type CreateWaitingInput = {
  companyId: string;
  actorId: string;
  jobId: string;
  columnId: string;
  reason?: string;
  notes?: string | null;
  assignedOwnerUserId?: string | null;
  cadence?: WaitingCadence;
  customCadenceDays?: number | null;
  communicationEnabled?: boolean;
  expectedResolutionAt?: Date | null;
  metadata?: WaitingMetadata;
  sendInitial?: boolean;
};

export type TransitionWaitingInput = {
  companyId: string;
  actorId: string;
  recordId: string;
  toColumnId: string;
  note?: string | null;
  actions?: WaitingTransitionActions;
  expectedResolutionAt?: Date | null;
  metadataPatch?: WaitingMetadata;
};

export async function createWaitingRecord(input: CreateWaitingInput, db: PrismaClient = defaultPrisma) {
  const { columns, setting } = await ensureWaitingSetup(input.companyId, db);
  const column = columns.find((row) => row.id === input.columnId);
  if (!column) throw new Error("Waiting status not found.");

  const job = await db.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    include: {
      customer: true,
      property: { select: { id: true } },
      assignments: { select: { userId: true } },
    },
  });
  if (!job) throw new Error("Job not found.");
  if (job.status === "COMPLETED" || job.status === "CANCELED") {
    throw new Error("Completed or canceled jobs cannot be placed in waiting.");
  }

  const existing = await db.waitingRecord.findFirst({
    where: { companyId: input.companyId, jobId: job.id, state: "ACTIVE" },
  });
  if (existing) {
    return transitionWaitingRecord(
      {
        companyId: input.companyId,
        actorId: input.actorId,
        recordId: existing.id,
        toColumnId: column.id,
        note: input.notes ?? undefined,
        expectedResolutionAt: input.expectedResolutionAt,
        metadataPatch: input.metadata,
        actions: {
          stopUpdates: isReadyColumn(column.kind, column.key),
          notifyCustomer: input.sendInitial !== false && (input.communicationEnabled ?? true),
          createSchedulingTask: isReadyColumn(column.kind, column.key),
        },
      },
      db
    );
  }

  const ready = isReadyColumn(column.kind, column.key);
  const cadence = input.cadence ?? setting.defaultCadence;
  const customCadenceDays = input.customCadenceDays ?? setting.defaultCustomCadenceDays;
  const communicationEnabled = input.communicationEnabled ?? true;
  const automationEnabled = !ready && cadence !== "MANUAL" && communicationEnabled && setting.automaticUpdatesEnabled;
  const now = new Date();
  const metadata = input.metadata ?? {};
  const reason = input.reason?.trim() || column.name;

  const record = await db.waitingRecord.create({
    data: {
      companyId: input.companyId,
      customerId: job.customerId,
      jobId: job.id,
      propertyId: job.propertyId,
      columnId: column.id,
      state: "ACTIVE",
      reason,
      notes: input.notes?.trim() || null,
      priority: job.priority,
      metadata: metadata as Prisma.InputJsonValue,
      assignedOwnerUserId: input.assignedOwnerUserId ?? null,
      enteredAt: now,
      expectedResolutionAt: input.expectedResolutionAt ?? null,
      communicationEnabled,
      automationEnabled,
      cadence,
      customCadenceDays,
      nextCustomerUpdateAt:
        automationEnabled
          ? nextCustomerUpdateAt({
              from: now,
              cadence,
              customCadenceDays,
              timezone: (await db.company.findFirst({ where: { id: input.companyId }, select: { timezone: true } }))
                ?.timezone ?? "America/New_York",
              businessHourStart: setting.businessHoursStart,
            })
          : null,
    },
  });

  await db.waitingTransition.create({
    data: {
      companyId: input.companyId,
      recordId: record.id,
      fromColumnId: null,
      toColumnId: column.id,
      actorId: input.actorId,
      actions: { created: true, sendInitial: input.sendInitial !== false },
      note: input.notes ?? null,
    },
  });

  await maybeUpdateJobStatus(db, input.companyId, job.id, job.status, ready, input.actorId, `Placed in ${column.name}`);
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "waiting.created",
    entityType: "WaitingRecord",
    entityId: record.id,
    metadata: { jobId: job.id, columnKey: column.key, reason },
  });

  if (input.sendInitial !== false && communicationEnabled && !ready) {
    await sendWaitingCommunication({
      companyId: input.companyId,
      recordId: record.id,
      kind: "INITIAL",
      actorId: input.actorId,
      idempotencySlot: record.enteredAt,
    });
  }

  return db.waitingRecord.findFirstOrThrow({
    where: { id: record.id, companyId: input.companyId },
    include: waitingRecordInclude,
  });
}

export async function transitionWaitingRecord(input: TransitionWaitingInput, db: PrismaClient = defaultPrisma) {
  const record = await db.waitingRecord.findFirst({
    where: { id: input.recordId, companyId: input.companyId },
    include: { column: true, job: { select: { id: true, status: true, jobNumber: true, customerId: true } }, customer: true },
  });
  if (!record) throw new Error("Waiting record not found.");
  if (record.state === "RESOLVED") throw new Error("This waiting record is already resolved.");
  if (
    input.actions?.markPartArrived &&
    isReadyColumn(record.column.kind, record.column.key) &&
    record.actualArrivalAt
  ) {
    return db.waitingRecord.findFirstOrThrow({
      where: { id: record.id, companyId: input.companyId },
      include: waitingRecordInclude,
    });
  }

  const toColumn = await db.waitingColumn.findFirst({
    where: { id: input.toColumnId, companyId: input.companyId, archivedAt: null },
  });
  if (!toColumn) throw new Error("Waiting status not found.");

  const actions: WaitingTransitionActions = {
    stopUpdates: input.actions?.stopUpdates ?? isReadyColumn(toColumn.kind, toColumn.key),
    notifyCustomer: input.actions?.notifyCustomer ?? false,
    createSchedulingTask: input.actions?.createSchedulingTask ?? isReadyColumn(toColumn.kind, toColumn.key),
    markPartArrived: input.actions?.markPartArrived ?? false,
  };

  const now = new Date();
  const ready = isReadyColumn(toColumn.kind, toColumn.key);
  const meta = { ...parseWaitingMetadata(record.metadata), ...input.metadataPatch };
  if (actions.markPartArrived) {
    meta.part = { ...meta.part, actualArrivalAt: now.toISOString() };
  }

  const nextAutomation = actions.stopUpdates || ready ? false : record.automationEnabled;
  const setting = await db.waitingBoardSetting.findUnique({ where: { companyId: input.companyId } });
  const company = await db.company.findFirst({
    where: { id: input.companyId },
    select: { timezone: true },
  });

  await db.waitingRecord.update({
    where: { id: record.id },
    data: {
      columnId: toColumn.id,
      reason: toColumn.name,
      metadata: meta as Prisma.InputJsonValue,
      expectedResolutionAt: input.expectedResolutionAt ?? record.expectedResolutionAt,
      actualArrivalAt: actions.markPartArrived ? now : record.actualArrivalAt,
      automationEnabled: nextAutomation,
      nextCustomerUpdateAt: nextAutomation
        ? nextCustomerUpdateAt({
            from: now,
            cadence: record.cadence,
            customCadenceDays: record.customCadenceDays,
            timezone: company?.timezone ?? "America/New_York",
            businessHourStart: setting?.businessHoursStart,
          })
        : null,
    },
  });

  const transition = await db.waitingTransition.create({
    data: {
      companyId: input.companyId,
      recordId: record.id,
      fromColumnId: record.columnId,
      toColumnId: toColumn.id,
      actorId: input.actorId,
      actions: actions as Prisma.InputJsonValue,
      note: input.note ?? null,
    },
  });

  await maybeUpdateJobStatus(
    db,
    input.companyId,
    record.job.id,
    record.job.status,
    ready,
    input.actorId,
    actions.markPartArrived
      ? `Part arrived · moved to ${toColumn.name}`
      : `Waiting moved to ${toColumn.name}`
  );

  if (actions.createSchedulingTask && ready) {
    await createSchedulingFollowUp({
      companyId: input.companyId,
      actorId: input.actorId,
      recordId: record.id,
      jobId: record.job.id,
      jobNumber: record.job.jobNumber,
      customerName: `${record.customer.firstName} ${record.customer.lastName}`.trim(),
      itemName: meta.part?.name?.trim() || meta.waitingFor?.trim() || record.reason,
      assignedOwnerUserId: record.assignedOwnerUserId,
      db,
    });
  }

  if (actions.notifyCustomer) {
    const kind = actions.markPartArrived || record.column.key === "WAITING_ON_PART" ? "ARRIVED" : ready ? "READY" : "RECURRING";
    await sendWaitingCommunication({
      companyId: input.companyId,
      recordId: record.id,
      kind,
      actorId: input.actorId,
      manual: true,
      idempotencySlot: transition.id,
    });
  }

  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: actions.markPartArrived ? "waiting.part_arrived" : "waiting.status_changed",
    entityType: "WaitingRecord",
    entityId: record.id,
    metadata: {
      fromColumnId: record.columnId,
      toColumnId: toColumn.id,
      actions,
    },
  });

  return db.waitingRecord.findFirstOrThrow({
    where: { id: record.id, companyId: input.companyId },
    include: waitingRecordInclude,
  });
}

export async function resolveWaitingRecord(
  input: {
    companyId: string;
    actorId: string;
    recordId: string;
    note?: string | null;
    notifyCustomer?: boolean;
    appointmentScheduled?: boolean;
  },
  db: PrismaClient = defaultPrisma
) {
  const record = await db.waitingRecord.findFirst({
    where: { id: input.recordId, companyId: input.companyId },
  });
  if (!record) throw new Error("Waiting record not found.");
  if (record.state === "RESOLVED") return record;

  const now = new Date();
  await db.waitingRecord.update({
    where: { id: record.id },
    data: {
      state: "RESOLVED",
      resolvedAt: now,
      automationEnabled: false,
      nextCustomerUpdateAt: null,
    },
  });
  await db.waitingTransition.create({
    data: {
      companyId: input.companyId,
      recordId: record.id,
      fromColumnId: record.columnId,
      toColumnId: record.columnId,
      actorId: input.actorId,
      actions: {
        resolved: true,
        notifyCustomer: Boolean(input.notifyCustomer),
        appointmentScheduled: Boolean(input.appointmentScheduled),
      },
      note: input.note ?? null,
    },
  });
  await db.jobWorkflowEvent.create({
    data: {
      companyId: input.companyId,
      jobId: record.jobId,
      stepId: "waiting",
      actorId: input.actorId,
      kind: "WAITING_UPDATE",
      note: input.note?.trim() || "Waiting record resolved. History is preserved.",
    },
  });
  if (input.notifyCustomer) {
    await sendWaitingCommunication({
      companyId: input.companyId,
      recordId: record.id,
      kind: "RESOLVED",
      actorId: input.actorId,
      manual: true,
      idempotencySlot: now,
    });
  }
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "waiting.resolved",
    entityType: "WaitingRecord",
    entityId: record.id,
  });
  return db.waitingRecord.findFirstOrThrow({
    where: { id: record.id, companyId: input.companyId },
    include: waitingRecordInclude,
  });
}

export async function updateWaitingRecord(
  input: {
    companyId: string;
    actorId: string;
    recordId: string;
    notes?: string | null;
    assignedOwnerUserId?: string | null;
    cadence?: WaitingCadence;
    customCadenceDays?: number | null;
    communicationEnabled?: boolean;
    automationEnabled?: boolean;
    expectedResolutionAt?: Date | null;
    metadata?: WaitingMetadata;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    notifyCustomer?: boolean;
  },
  db: PrismaClient = defaultPrisma
) {
  const record = await db.waitingRecord.findFirst({
    where: { id: input.recordId, companyId: input.companyId },
    include: { column: true, company: { select: { timezone: true } } },
  });
  if (!record) throw new Error("Waiting record not found.");
  if (record.state === "RESOLVED") throw new Error("Resolved waiting records cannot be edited.");

  const setting = await db.waitingBoardSetting.findUnique({ where: { companyId: input.companyId } });
  const cadence = input.cadence ?? record.cadence;
  const customCadenceDays = input.customCadenceDays ?? record.customCadenceDays;
  const communicationEnabled = input.communicationEnabled ?? record.communicationEnabled;
  const ready = isReadyColumn(record.column.kind, record.column.key);
  const automationEnabled =
    input.automationEnabled ?? (ready ? false : record.automationEnabled && communicationEnabled);

  const data: Prisma.WaitingRecordUpdateInput = {
    notes: input.notes === undefined ? record.notes : input.notes,
    assignedOwner:
      input.assignedOwnerUserId === undefined
        ? undefined
        : input.assignedOwnerUserId
          ? { connect: { id: input.assignedOwnerUserId } }
          : { disconnect: true },
    cadence,
    customCadenceDays,
    communicationEnabled,
    automationEnabled,
    expectedResolutionAt:
      input.expectedResolutionAt === undefined ? record.expectedResolutionAt : input.expectedResolutionAt,
    metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
    priority: input.priority ?? record.priority,
    nextCustomerUpdateAt:
      automationEnabled && communicationEnabled && !ready
        ? nextCustomerUpdateAt({
            from: record.lastCustomerUpdateAt ?? new Date(),
            cadence,
            customCadenceDays,
            timezone: record.company.timezone,
            businessHourStart: setting?.businessHoursStart,
          })
        : null,
  };

  const previousExpected = record.expectedResolutionAt;
  const nextExpected =
    input.expectedResolutionAt === undefined ? record.expectedResolutionAt : input.expectedResolutionAt;
  const expectedDateChanged =
    input.expectedResolutionAt !== undefined &&
    (previousExpected?.getTime() ?? null) !== (nextExpected?.getTime() ?? null);

  await db.waitingRecord.update({ where: { id: record.id }, data });

  if (expectedDateChanged) {
    await db.waitingTransition.create({
      data: {
        companyId: input.companyId,
        recordId: record.id,
        fromColumnId: record.columnId,
        toColumnId: record.columnId,
        actorId: input.actorId,
        actions: {
          expectedDateChanged: true,
          fromExpectedResolutionAt: previousExpected?.toISOString() ?? null,
          toExpectedResolutionAt: nextExpected?.toISOString() ?? null,
        },
        note: `Expected date ${previousExpected ? previousExpected.toISOString().slice(0, 10) : "none"} → ${
          nextExpected ? nextExpected.toISOString().slice(0, 10) : "none"
        }`,
      },
    });
    await db.jobWorkflowEvent.create({
      data: {
        companyId: input.companyId,
        jobId: record.jobId,
        stepId: "waiting",
        actorId: input.actorId,
        kind: "WAITING_UPDATE",
        note: `Expected date changed ${previousExpected ? previousExpected.toISOString().slice(0, 10) : "none"} → ${
          nextExpected ? nextExpected.toISOString().slice(0, 10) : "none"
        }`,
      },
    });
    if (input.notifyCustomer && nextExpected) {
      await sendWaitingCommunication({
        companyId: input.companyId,
        recordId: record.id,
        kind: "RECURRING",
        actorId: input.actorId,
        manual: true,
        idempotencySlot: `expected-${nextExpected.toISOString()}`,
      });
    }
  }

  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "waiting.updated",
    entityType: "WaitingRecord",
    entityId: record.id,
    metadata: {
      cadenceChanged: input.cadence != null && input.cadence !== record.cadence,
      expectedDateChanged,
      fromExpectedResolutionAt: expectedDateChanged ? previousExpected?.toISOString() ?? null : undefined,
      toExpectedResolutionAt: expectedDateChanged ? nextExpected?.toISOString() ?? null : undefined,
    },
  });
  return db.waitingRecord.findFirstOrThrow({
    where: { id: record.id, companyId: input.companyId },
    include: waitingRecordInclude,
  });
}

export async function markPartArrived(
  input: {
    companyId: string;
    actorId: string;
    recordId: string;
    notifyCustomer?: boolean;
    createSchedulingTask?: boolean;
    note?: string | null;
  },
  db: PrismaClient = defaultPrisma
) {
  const record = await db.waitingRecord.findFirst({
    where: { id: input.recordId, companyId: input.companyId },
    include: { column: true },
  });
  if (!record) throw new Error("Waiting record not found.");
  if (record.state === "RESOLVED") {
    return db.waitingRecord.findFirstOrThrow({
      where: { id: record.id, companyId: input.companyId },
      include: waitingRecordInclude,
    });
  }
  if (isReadyColumn(record.column.kind, record.column.key) && record.actualArrivalAt) {
    return db.waitingRecord.findFirstOrThrow({
      where: { id: record.id, companyId: input.companyId },
      include: waitingRecordInclude,
    });
  }
  const { columns } = await ensureWaitingSetup(input.companyId, db);
  const ready = columns.find((column) => isReadyColumn(column.kind, column.key));
  if (!ready) throw new Error("Ready to Schedule is not configured.");
  return transitionWaitingRecord(
    {
      companyId: input.companyId,
      actorId: input.actorId,
      recordId: record.id,
      toColumnId: ready.id,
      note: input.note ?? "Part arrived",
      actions: {
        markPartArrived: true,
        stopUpdates: true,
        notifyCustomer: input.notifyCustomer === true,
        createSchedulingTask: input.createSchedulingTask !== false,
      },
    },
    db
  );
}

export async function resolveWaitingRecordsForScheduledJob(
  input: { companyId: string; actorId: string; jobId: string },
  db: PrismaClient = defaultPrisma
) {
  const records = await db.waitingRecord.findMany({
    where: { companyId: input.companyId, jobId: input.jobId, state: "ACTIVE" },
    include: { column: true },
  });
  const ready = records.filter((record) => isReadyColumn(record.column.kind, record.column.key));
  for (const record of ready) {
    await resolveWaitingRecord(
      {
        companyId: input.companyId,
        actorId: input.actorId,
        recordId: record.id,
        note: "Appointment scheduled",
        notifyCustomer: false,
        appointmentScheduled: true,
      },
      db
    );
    await db.companyTask.updateMany({
      where: {
        companyId: input.companyId,
        relatedType: "WaitingRecord",
        relatedId: record.id,
        status: "OPEN",
      },
      data: { status: "DONE" },
    });
  }
  return ready.length;
}

export async function addWaitingNote(
  input: { companyId: string; actorId: string; recordId: string; note: string },
  db: PrismaClient = defaultPrisma
) {
  const record = await db.waitingRecord.findFirst({
    where: { id: input.recordId, companyId: input.companyId },
  });
  if (!record) throw new Error("Waiting record not found.");
  const stamp = new Date().toISOString();
  const next = [record.notes?.trim(), `[${stamp}] ${input.note.trim()}`].filter(Boolean).join("\n");
  await db.waitingRecord.update({ where: { id: record.id }, data: { notes: next } });
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: "waiting.note_added",
    entityType: "WaitingRecord",
    entityId: record.id,
  });
}

export const waitingRecordInclude = {
  column: true,
  customer: { select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, tags: true } },
  job: {
    select: {
      id: true,
      jobNumber: true,
      status: true,
      priority: true,
      jobType: true,
      serviceType: { select: { name: true } },
      assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
    },
  },
  property: { select: { id: true, address: true, city: true, state: true, zip: true } },
  assignedOwner: { select: { id: true, firstName: true, lastName: true } },
  transitions: {
    orderBy: { createdAt: "desc" as const },
    take: 20,
    include: {
      fromColumn: { select: { name: true, key: true } },
      toColumn: { select: { name: true, key: true } },
      actor: { select: { firstName: true, lastName: true } },
    },
  },
  communications: { orderBy: { createdAt: "desc" as const }, take: 20 },
};

async function maybeUpdateJobStatus(
  db: PrismaClient,
  companyId: string,
  jobId: string,
  current: JobStatus,
  ready: boolean,
  actorId: string,
  note: string
) {
  const next = nextJobStatusForWaiting({ current, ready });
  if (!next || next === current) {
    await db.jobWorkflowEvent.create({
      data: { companyId, jobId, stepId: "waiting", actorId, kind: "WAITING_UPDATE", note },
    });
    return;
  }
  await db.job.update({ where: { id: jobId }, data: { status: next } });
  await db.jobWorkflowEvent.create({
    data: { companyId, jobId, stepId: "waiting", actorId, kind: "STATUS_CHANGED", note: `${note} · job ${current} → ${next}` },
  });
  await writeAudit({
    companyId,
    actorId,
    action: "job.status_changed",
    entityType: "Job",
    entityId: jobId,
    metadata: { from: current, to: next, source: "waiting_board" },
  });
}

async function createSchedulingFollowUp(input: {
  companyId: string;
  actorId: string;
  recordId: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  itemName?: string | null;
  assignedOwnerUserId: string | null;
  db: PrismaClient;
}) {
  const existing = await input.db.companyTask.findFirst({
    where: {
      companyId: input.companyId,
      relatedType: "WaitingRecord",
      relatedId: input.recordId,
      status: "OPEN",
      title: { contains: "Schedule" },
    },
  });
  if (existing) return existing;
  return input.db.companyTask.create({
    data: {
      companyId: input.companyId,
      assignedToUserId: input.assignedOwnerUserId,
      createdByUserId: input.actorId,
      title: `Schedule Customer · ${input.customerName}`,
      details: input.itemName
        ? `${input.itemName} has arrived.`
        : `${input.jobNumber} is ready to schedule.`,
      dueAt: new Date(),
      status: "OPEN",
      relatedType: "WaitingRecord",
      relatedId: input.recordId,
    },
  });
}

export { shouldStopWaitingAutomation, syncWaitingCustomerReply };
