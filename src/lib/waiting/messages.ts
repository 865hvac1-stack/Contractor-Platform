import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { firstNameOf, smsRecipient } from "@/lib/actions/eligibility";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { writeAudit } from "@/lib/audit";
import { nextCustomerUpdateAt, waitingIdempotencyKey } from "@/lib/waiting/schedule";
import { waitingSendBlockReason } from "@/lib/waiting/safety";
import { buildWaitingTemplateVars, renderWaitingTemplate } from "@/lib/waiting/templates";
import type { WaitingTemplateKind } from "@/lib/waiting/types";
import { parseWaitingMetadata } from "@/lib/waiting/types";

type SendKind = WaitingTemplateKind | "MANUAL";

export async function resolveWaitingTemplate(input: {
  companyId: string;
  columnId: string;
  kind: SendKind;
  db?: PrismaClient;
}) {
  const db = input.db ?? defaultPrisma;
  const kind = input.kind === "MANUAL" ? "RECURRING" : input.kind;
  const exact = await db.waitingTemplate.findFirst({
    where: { companyId: input.companyId, columnId: input.columnId, kind },
  });
  if (exact) return exact;
  const fallback = await db.waitingTemplate.findFirst({
    where: { companyId: input.companyId, columnId: null, kind },
  });
  if (fallback) return fallback;
  if (kind === "ARRIVED" || kind === "READY") {
    return db.waitingTemplate.findFirst({
      where: { companyId: input.companyId, kind: { in: ["ARRIVED", "READY"] } },
    });
  }
  return db.waitingTemplate.findFirst({
    where: { companyId: input.companyId, columnId: null, kind: "RECURRING" },
  });
}

export async function previewWaitingCommunication(input: {
  companyId: string;
  recordId: string;
  kind?: SendKind;
  db?: PrismaClient;
}): Promise<{ ok: boolean; body?: string; reason?: string; provider?: string }> {
  const db = input.db ?? defaultPrisma;
  const record = await db.waitingRecord.findFirst({
    where: { id: input.recordId, companyId: input.companyId },
    include: {
      customer: true,
      job: { select: { id: true, jobNumber: true, status: true } },
      column: true,
      assignedOwner: { select: { firstName: true, lastName: true } },
      company: { select: { businessName: true, timezone: true } },
    },
  });
  if (!record) return { ok: false, reason: "Waiting record not found." };

  const setting = await db.waitingBoardSetting.findUnique({ where: { companyId: input.companyId } });
  const kind = input.kind ?? "MANUAL";
  const block = waitingSendBlockReason({
    jobStatus: record.job.status,
    recordState: record.state,
    communicationEnabled: record.communicationEnabled,
    automationEnabled: record.automationEnabled,
    companyAutomaticUpdatesEnabled: setting?.automaticUpdatesEnabled ?? true,
    customer: record.customer,
    kind,
    manual: true,
  });

  const template = await resolveWaitingTemplate({
    companyId: input.companyId,
    columnId: record.columnId,
    kind,
    db,
  });
  if (!template) return { ok: false, reason: block ?? "No waiting message template is configured." };

  const vars = buildWaitingTemplateVars({
    firstName: firstNameOf(record.customer),
    companyName: record.company.businessName,
    jobNumber: record.job.jobNumber,
    waitingReason: record.reason,
    ownerName: record.assignedOwner
      ? `${record.assignedOwner.firstName} ${record.assignedOwner.lastName}`.trim()
      : null,
    metadata: parseWaitingMetadata(record.metadata),
    expectedResolutionAt: record.expectedResolutionAt,
    timezone: record.company.timezone,
  });
  return { ok: true, body: renderWaitingTemplate(template.body, vars), reason: block ?? undefined };
}

export async function sendWaitingCommunication(input: {
  companyId: string;
  recordId: string;
  kind: SendKind;
  actorId?: string | null;
  manual?: boolean;
  bodyOverride?: string | null;
  idempotencySlot?: Date | string;
  db?: PrismaClient;
}): Promise<{ ok: boolean; skipped?: boolean; reason?: string; communicationId?: string }> {
  const db = input.db ?? defaultPrisma;
  const record = await db.waitingRecord.findFirst({
    where: { id: input.recordId, companyId: input.companyId },
    include: {
      customer: true,
      job: { select: { id: true, jobNumber: true, status: true } },
      column: true,
      assignedOwner: { select: { firstName: true, lastName: true } },
      company: { select: { businessName: true, timezone: true, isDemo: true } },
    },
  });
  if (!record) return { ok: false, reason: "Waiting record not found." };

  const setting = await db.waitingBoardSetting.findUnique({ where: { companyId: input.companyId } });
  const block = waitingSendBlockReason({
    jobStatus: record.job.status,
    recordState: record.state,
    communicationEnabled: record.communicationEnabled,
    automationEnabled: record.automationEnabled,
    companyAutomaticUpdatesEnabled: setting?.automaticUpdatesEnabled ?? true,
    customer: record.customer,
    kind: input.kind,
    manual: input.manual,
  });

  const slot =
    input.idempotencySlot ??
    record.nextCustomerUpdateAt ??
    record.enteredAt;
  const idempotencyKey = waitingIdempotencyKey(record.id, input.kind, slot);
  const existing = await db.waitingCommunication.findUnique({
    where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey } },
  });
  if (existing?.sentAt) {
    return { ok: true, skipped: true, reason: "Already sent.", communicationId: existing.id };
  }
  if (existing?.failedAt && !input.manual) {
    return { ok: false, skipped: true, reason: existing.failureReason ?? "Previous send failed.", communicationId: existing.id };
  }

  if (block) {
    const failed = existing
      ? await db.waitingCommunication.update({
          where: { id: existing.id },
          data: { failedAt: new Date(), failureReason: block },
        })
      : await db.waitingCommunication.create({
          data: {
            companyId: input.companyId,
            recordId: record.id,
            kind: input.kind,
            idempotencyKey,
            body: "",
            templateKind: input.kind,
            attemptedAt: new Date(),
            failedAt: new Date(),
            failureReason: block,
          },
        });
    await db.waitingRecord.update({
      where: { id: record.id },
      data: {
        lastCommunicationStatus: "BLOCKED",
        lastCommunicationError: block,
        nextCustomerUpdateAt: input.manual
          ? record.nextCustomerUpdateAt
          : nextCustomerUpdateAt({
              from: new Date(),
              cadence: record.cadence,
              customCadenceDays: record.customCadenceDays,
              timezone: record.company.timezone,
              businessHourStart: setting?.businessHoursStart,
            }),
      },
    });
    return { ok: false, reason: block, communicationId: failed.id };
  }

  const override = input.bodyOverride?.trim() ?? "";
  const template = override
    ? null
    : await resolveWaitingTemplate({
        companyId: input.companyId,
        columnId: record.columnId,
        kind: input.kind,
        db,
      });
  if (!override && !template) {
    return { ok: false, reason: "No waiting message template is configured." };
  }

  const vars = buildWaitingTemplateVars({
    firstName: firstNameOf(record.customer),
    companyName: record.company.businessName,
    jobNumber: record.job.jobNumber,
    waitingReason: record.reason,
    ownerName: record.assignedOwner
      ? `${record.assignedOwner.firstName} ${record.assignedOwner.lastName}`.trim()
      : null,
    metadata: parseWaitingMetadata(record.metadata),
    expectedResolutionAt: record.expectedResolutionAt,
    timezone: record.company.timezone,
  });
  const body = override || renderWaitingTemplate(template!.body, vars);
  const to = smsRecipient(record.customer)!;

  const communication =
    existing ??
    (await db.waitingCommunication.create({
      data: {
        companyId: input.companyId,
        recordId: record.id,
        kind: input.kind,
        idempotencyKey,
        body,
        templateKind: template?.kind ?? input.kind,
        attemptedAt: new Date(),
      },
    }));

  const sent = await sendCompanyCommunication({
    companyId: input.companyId,
    channel: "SMS",
    to,
    body,
    customerId: record.customerId,
  });

  if (!sent.ok) {
    await db.waitingCommunication.update({
      where: { id: communication.id },
      data: {
        body,
        provider: sent.provider,
        failedAt: new Date(),
        failureReason: sent.error ?? "Provider did not send the message.",
      },
    });
    await db.waitingRecord.update({
      where: { id: record.id },
      data: {
        lastCommunicationStatus: "FAILED",
        lastCommunicationError: sent.error ?? "Provider did not send the message.",
        nextCustomerUpdateAt: input.manual
          ? record.nextCustomerUpdateAt
          : nextCustomerUpdateAt({
              from: new Date(),
              cadence: record.cadence,
              customCadenceDays: record.customCadenceDays,
              timezone: record.company.timezone,
              businessHourStart: setting?.businessHoursStart,
            }),
      },
    });
    await writeAudit({
      companyId: input.companyId,
      actorId: input.actorId ?? null,
      action: "waiting.communication_failed",
      entityType: "WaitingRecord",
      entityId: record.id,
      metadata: { kind: input.kind, provider: sent.provider, reason: sent.error ?? "send failed" },
    });
    return { ok: false, reason: sent.error ?? "Provider did not send the message.", communicationId: communication.id };
  }

  const now = new Date();
  await db.waitingCommunication.update({
    where: { id: communication.id },
    data: {
      body,
      provider: sent.provider,
      providerMessageId: sent.providerId ?? null,
      sentAt: now,
      failedAt: null,
      failureReason: null,
    },
  });

  await recordWaitingOutboundSms({
    companyId: input.companyId,
    customerId: record.customerId,
    customerName: `${record.customer.firstName} ${record.customer.lastName}`.trim(),
    to,
    body,
    provider: sent.provider,
    providerResultId: sent.providerId ?? null,
    waitingRecordId: record.id,
    communicationId: communication.id,
  });

  await db.waitingRecord.update({
    where: { id: record.id },
    data: {
      lastCustomerUpdateAt: now,
      lastCommunicationStatus: "SENT",
      lastCommunicationError: null,
      nextCustomerUpdateAt:
        record.automationEnabled && record.communicationEnabled && record.column.kind !== "READY"
          ? nextCustomerUpdateAt({
              from: now,
              cadence: record.cadence,
              customCadenceDays: record.customCadenceDays,
              timezone: record.company.timezone,
              businessHourStart: setting?.businessHoursStart,
            })
          : null,
    },
  });

  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId ?? null,
    action: input.manual ? "waiting.communication_manual" : "waiting.communication_sent",
    entityType: "WaitingRecord",
    entityId: record.id,
    metadata: { kind: input.kind, provider: sent.provider, templateKind: template?.kind ?? input.kind },
  });

  return { ok: true, communicationId: communication.id };
}

async function recordWaitingOutboundSms(input: {
  companyId: string;
  customerId: string;
  customerName: string;
  to: string;
  body: string;
  provider: string;
  providerResultId: string | null;
  waitingRecordId: string;
  communicationId: string;
}) {
  const externalThreadId = `waiting-${input.customerId}`;
  const thread = await defaultPrisma.communicationThread.upsert({
    where: {
      companyId_provider_externalId: {
        companyId: input.companyId,
        provider: input.provider,
        externalId: externalThreadId,
      },
    },
    create: {
      companyId: input.companyId,
      provider: input.provider,
      externalId: externalThreadId,
      channel: "SMS",
      customerId: input.customerId,
      contactName: input.customerName,
      phone: input.to,
      lastPreview: input.body.slice(0, 240),
      lastActivityAt: new Date(),
    },
    update: {
      lastPreview: input.body.slice(0, 240),
      lastActivityAt: new Date(),
      customerId: input.customerId,
    },
  });
  await defaultPrisma.communicationMessage.create({
    data: {
      companyId: input.companyId,
      threadId: thread.id,
      provider: input.provider,
      externalId: input.providerResultId || `waiting-msg-${input.communicationId}`,
      direction: "OUTBOUND",
      channel: "SMS",
      kind: "SMS",
      body: input.body,
      occurredAt: new Date(),
      status: "SENT",
      metadata: {
        waitingRecordId: input.waitingRecordId,
        waitingCommunicationId: input.communicationId,
      },
    },
  });
}
