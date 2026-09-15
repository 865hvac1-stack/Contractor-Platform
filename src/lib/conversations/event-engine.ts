import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { loadReceptionistSettings } from "@/lib/intelligence/receptionist/settings";
import { renderFirstMessage, promotionIsActive } from "@/lib/conversations/personalization";
import { isSmsOptedOut } from "@/lib/actions/eligibility";

export const CONTRACTORYOU_EVENTS = [
  "LEAD_CREATED",
  "MISSED_CALL",
  "CUSTOMER_CREATED",
  "JOB_BOOKED",
  "JOB_RESCHEDULED",
  "JOB_CANCELLED",
  "APPOINTMENT_REMINDER_DUE",
  "TECHNICIAN_ASSIGNED",
  "TECHNICIAN_ON_MY_WAY",
  "TECHNICIAN_ARRIVED",
  "JOB_STARTED",
  "JOB_COMPLETED",
  "ESTIMATE_SENT",
  "ESTIMATE_OPEN",
  "ESTIMATE_APPROVED",
  "ESTIMATE_DECLINED",
  "INVOICE_CREATED",
  "PAYMENT_DUE",
  "PAYMENT_RECEIVED",
  "MAINTENANCE_DUE",
  "MEMBERSHIP_EXPIRING",
  "REVIEW_ELIGIBLE",
  "CUSTOMER_INACTIVE",
  "PROMOTION_AUDIENCE_READY",
] as const;

export type ContractorYouEventType = (typeof CONTRACTORYOU_EVENTS)[number];

const MARKETING_EVENTS = new Set<ContractorYouEventType>([
  "CUSTOMER_INACTIVE",
  "PROMOTION_AUDIENCE_READY",
  "MAINTENANCE_DUE",
  "MEMBERSHIP_EXPIRING",
]);

export type EmitDomainEventInput = {
  companyId: string;
  type: ContractorYouEventType;
  sourceType: string;
  sourceId: string;
  customerId?: string | null;
  jobId?: string | null;
  idempotencyKey: string;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
  processAutomations?: boolean;
};

export async function emitDomainEvent(input: EmitDomainEventInput) {
  const event = await prisma.domainEvent.upsert({
    where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
    create: {
      companyId: input.companyId,
      type: input.type,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      customerId: input.customerId ?? null,
      jobId: input.jobId ?? null,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt ?? new Date(),
      payload: input.payload ? (input.payload as Prisma.InputJsonValue) : undefined,
    },
    update: {},
  });

  const automations =
    input.processAutomations === false
      ? []
      : await prisma.automation.findMany({
          where: { companyId: input.companyId, enabled: true, trigger: input.type },
          include: { promotion: true },
        });
  const results = [];
  for (const automation of automations) {
    results.push(await executeAutomationForEvent(event.id, automation.id));
  }
  return { eventId: event.id, matched: automations.length, results };
}

export async function executeAutomationForEvent(eventId: string, automationId: string) {
  const joined = await prisma.domainEvent.findFirst({
    where: { id: eventId },
    include: {
      executions: { where: { automationId }, take: 1 },
    },
  });
  if (!joined) return { handled: false, reason: "event_not_found" as const };
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, companyId: joined.companyId, enabled: true },
    include: { promotion: true },
  });
  if (!automation) return { handled: false, reason: "automation_not_enabled" as const };
  const existingExecution = joined.executions[0];
  if (
    existingExecution &&
    (existingExecution.status !== "SCHEDULED" ||
      !existingExecution.scheduledFor ||
      existingExecution.scheduledFor.getTime() > Date.now())
  ) {
    return { handled: true, duplicate: true, executionId: existingExecution.id };
  }

  const context = await loadExecutionContext({
    companyId: joined.companyId,
    customerId: joined.customerId,
    jobId: joined.jobId,
    sourceType: joined.sourceType,
    sourceId: joined.sourceId,
  });
  let execution = existingExecution;
  try {
    if (!execution) {
      const scheduledFor = new Date(joined.occurredAt.getTime() + automation.delayMinutes * 60_000);
    execution = await prisma.automationExecution.create({
      data: {
        companyId: joined.companyId,
        automationId: automation.id,
        eventId: joined.id,
        customerId: context.customer?.id ?? null,
        promotionId: automation.promotionId,
        sourceType: joined.sourceType,
        sourceId: joined.sourceId,
        goal: automation.goal,
        mode: automation.mode,
        status: scheduledFor.getTime() > Date.now() ? "SCHEDULED" : "EVALUATING",
        scheduledFor,
        configSnapshot: {
          version: automation.version,
          trigger: automation.trigger,
          goal: automation.goal,
          mode: automation.mode,
          audience: automation.audience,
          conditions: automation.conditions,
          allowedActions: automation.allowedActions,
          stopConditions: automation.stopConditions,
          promotionId: automation.promotionId,
          firstMessage: automation.firstMessage,
        },
      },
    });
      if (scheduledFor.getTime() > Date.now()) {
        return { handled: true, sent: false, scheduled: true, executionId: execution.id, scheduledFor };
      }
    } else {
      execution = await prisma.automationExecution.update({
        where: { id: execution.id },
        data: { status: "EVALUATING" },
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.automationExecution.findFirst({
        where: { companyId: joined.companyId, automationId: automation.id, eventId: joined.id },
      });
      if (duplicate) return { handled: true, duplicate: true, executionId: duplicate.id };
    }
    throw error;
  }
  const customConditionBlock = await customAutomationConditionBlock({
    conditions: automation.conditions,
    companyId: joined.companyId,
    sourceType: joined.sourceType,
    sourceId: joined.sourceId,
    customerId: context.customer?.id,
  });
  if (customConditionBlock) {
    await finishBlockedExecution(execution.id, joined.companyId, customConditionBlock);
    return { handled: true, sent: false, executionId: execution.id, reason: customConditionBlock };
  }
  const promotionEligible = promotionAudienceEligible(automation.promotion?.audience, {
    eventType: joined.type as ContractorYouEventType,
    propertyType: context.job?.property.propertyType || context.customer?.properties[0]?.propertyType,
  });
  const activePromotion =
    promotionIsActive(automation.promotion) && promotionEligible ? automation.promotion : null;
  if (!automationAudienceEligible(automation.audience, context)) {
    await finishBlockedExecution(execution.id, joined.companyId, "automation_audience_not_eligible");
    return { handled: true, sent: false, executionId: execution.id, reason: "automation_audience_not_eligible" };
  }

  const blockReason = executionBlockReason({
    eventType: joined.type as ContractorYouEventType,
    customerOptedOut:
      Boolean(context.customer?.smsMarketingOptedOutAt) ||
      Boolean(context.customer && isSmsOptedOut(context.customer)),
    customerPhone: context.customer?.phone || context.lead?.phone,
    companyTimeZone: context.company.timezone,
    quietHoursStart: automation.quietHoursStart,
    quietHoursEnd: automation.quietHoursEnd,
    promotionRequired: joined.type === "PROMOTION_AUDIENCE_READY",
    promotionActive: Boolean(activePromotion),
    promotionEligible,
  });
  if (blockReason) {
    await finishBlockedExecution(execution.id, joined.companyId, blockReason);
    return { handled: true, sent: false, executionId: execution.id, reason: blockReason };
  }

  const existingThread = await prisma.communicationThread.findFirst({
    where: {
      companyId: joined.companyId,
      ...(context.customer?.id ? { customerId: context.customer.id } : { leadId: context.lead?.id }),
    },
    orderBy: { lastActivityAt: "desc" },
  });
  if (automation.mode === "START_CONVERSATION" && existingThread) {
    const activeSession = await prisma.conversationGoalSession.findFirst({
      where: {
        companyId: joined.companyId,
        threadId: existingThread.id,
        state: {
          in: [
            "STARTED",
            "WAITING_FOR_CUSTOMER",
            "COLLECTING_INFORMATION",
            "CHECKING_AVAILABILITY",
            "WAITING_FOR_SLOT_SELECTION",
            "BOOKING",
            "HUMAN_TAKEOVER",
          ],
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (activeSession) {
      await finishBlockedExecution(execution.id, joined.companyId, "active_conversation_in_progress");
      return {
        handled: true,
        sent: false,
        executionId: execution.id,
        reason: "active_conversation_in_progress",
      };
    }
  }

  const settings = await loadReceptionistSettings(joined.companyId);
  const body = renderFirstMessage(automation.firstMessage || "", {
    customerFirstName: context.customer?.firstName || context.lead?.firstName,
    companyName: context.company.businessName,
    assistantName: settings.assistantName,
    propertyAddress: context.job?.property.address || context.customer?.properties[0]?.address,
    appointmentWindow: context.job ? appointmentWindow(context.job, context.company.timezone) : null,
    technicianFirstName:
      context.job?.assignments[0]?.user.firstName || payloadText(joined.payload, "technicianFirstName"),
    eta: payloadText(joined.payload, "eta"),
    reviewLink: payloadText(joined.payload, "reviewLink"),
    promotion: activePromotion,
  });
  if (!body) {
    await finishBlockedExecution(execution.id, joined.companyId, "empty_first_message");
    return { handled: true, sent: false, executionId: execution.id, reason: "empty_first_message" };
  }

  const phone = context.customer?.phone || context.lead?.phone;
  const sent = await sendCompanyCommunication({
    companyId: joined.companyId,
    channel: "SMS",
    to: phone!,
    body,
    customerId: context.customer?.id,
    leadId: context.lead?.id,
    origin: automation.mode === "START_CONVERSATION" ? "CONTRACTORYOU_AUTOMATION" : "SYSTEM_AUTOMATION",
  });
  if (!sent.ok) {
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", decision: "SEND_FAILED", firstMessage: body, failure: sent.error || "Provider send failed." },
    });
    await auditConversation(joined.companyId, null, execution.id, "AUTOMATION_SEND_FAILED", "FAILED", {
      provider: sent.provider,
      error: sent.error || null,
    });
    return { handled: true, sent: false, executionId: execution.id, reason: "provider_failed" };
  }

  const thread =
    existingThread ||
    (await prisma.communicationThread.findFirst({
      where: {
        companyId: joined.companyId,
        ...(context.customer?.id ? { customerId: context.customer.id } : { leadId: context.lead?.id }),
      },
      orderBy: { lastActivityAt: "desc" },
    }));
  const isConversation = automation.mode === "START_CONVERSATION" && Boolean(automation.goal) && Boolean(thread);
  await prisma.$transaction(async (tx) => {
    await tx.automation.update({ where: { id: automation.id }, data: { lastTriggeredAt: new Date() } });
    await tx.automationExecution.update({
      where: { id: execution.id },
      data: {
        threadId: thread?.id,
        status: isConversation ? "WAITING_FOR_CUSTOMER" : "COMPLETED",
        decision: "SENT",
        firstMessage: body,
        goalCompletedAt: isConversation ? null : new Date(),
      },
    });
    if (isConversation && thread) {
      await tx.conversationGoalSession.create({
        data: {
          companyId: joined.companyId,
          threadId: thread.id,
          executionId: execution.id,
          customerId: context.customer?.id,
          propertyId: context.job?.propertyId || context.customer?.properties[0]?.id,
          jobId: context.job?.id,
          goal: automation.goal!,
          state: "WAITING_FOR_CUSTOMER",
          context: {
            eventType: joined.type,
            automationKey: automation.templateKey,
            automationVersion: automation.version,
            sourceType: joined.sourceType,
            sourceId: joined.sourceId,
            promotionId: activePromotion?.id ?? null,
          },
          allowedActions: automation.allowedActions,
          stopConditions: automation.stopConditions,
        },
      });
      await tx.communicationThread.update({
        where: { id: thread.id },
        data: { handlingState: "REGINA_ACTIVE", currentGoal: automation.goal, needsHumanAt: null, reginaPausedAt: null },
      });
    }
    await tx.conversationAuditEvent.create({
      data: {
        companyId: joined.companyId,
        threadId: thread?.id,
        executionId: execution.id,
        event: "AUTOMATION_STARTED",
        decision: "SENT",
        details: { domainEvent: joined.type, automationKey: automation.templateKey, automationVersion: automation.version, promotionValidated: Boolean(automation.promotionId) },
      },
    });
  });
  return { handled: true, sent: true, executionId: execution.id, threadId: thread?.id ?? null };
}

async function customAutomationConditionBlock(input: {
  conditions: Prisma.JsonValue | null;
  companyId: string;
  sourceType: string;
  sourceId: string;
  customerId?: string;
}) {
  const record = input.conditions && typeof input.conditions === "object" && !Array.isArray(input.conditions)
    ? input.conditions as Record<string, unknown> : {};
  const onlyIf = Array.isArray(record.onlyIf) ? record.onlyIf.map(String) : [];
  if (onlyIf.includes("CUSTOMER_HAS_NOT_BOOKED") && input.customerId) {
    const booking = await prisma.job.findFirst({
      where: {
        companyId: input.companyId,
        customerId: input.customerId,
        status: { in: ["SCHEDULED", "DISPATCHED"] },
        scheduledStart: { gte: new Date() },
      },
      select: { id: true },
    });
    if (booking) return "customer_already_booked";
  }
  if (onlyIf.includes("SOURCE_STILL_ACTIVE")) {
    if (input.sourceType === "Job") {
      const source = await prisma.job.findFirst({ where: { id: input.sourceId, companyId: input.companyId }, select: { status: true } });
      if (!source || source.status === "CANCELED") return "source_no_longer_active";
    }
    if (input.sourceType === "Estimate") {
      const source = await prisma.estimate.findFirst({ where: { id: input.sourceId, companyId: input.companyId }, select: { status: true } });
      if (!source || ["APPROVED", "DECLINED", "EXPIRED"].includes(source.status)) return "source_no_longer_active";
    }
    if (input.sourceType === "Invoice") {
      const source = await prisma.invoice.findFirst({ where: { id: input.sourceId, companyId: input.companyId }, select: { status: true } });
      if (!source || ["PAID", "VOID"].includes(source.status)) return "source_no_longer_active";
    }
  }
  return null;
}

function automationAudienceEligible(
  audience: string,
  context: { customer: { properties: Array<{ propertyType: string }> } | null; job: { property: { propertyType: string } } | null }
) {
  const propertyType = context.job?.property.propertyType || context.customer?.properties[0]?.propertyType;
  if (audience === "RESIDENTIAL") return propertyType === "RESIDENTIAL";
  if (audience === "COMMERCIAL") return propertyType === "COMMERCIAL";
  // Membership filters need a membership-qualified producer. They fail closed until that context is present.
  if (audience === "MAINTENANCE_MEMBERS" || audience === "NON_MEMBERS") return false;
  return true;
}

function executionBlockReason(input: {
  eventType: ContractorYouEventType;
  customerOptedOut: boolean;
  customerPhone?: string | null;
  companyTimeZone: string;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  promotionRequired: boolean;
  promotionActive: boolean;
  promotionEligible: boolean;
}) {
  if (!input.customerPhone) return "missing_phone";
  if (MARKETING_EVENTS.has(input.eventType) && input.customerOptedOut) return "marketing_opt_out";
  if (input.promotionRequired && !input.promotionActive) return "promotion_not_active";
  if (input.promotionRequired && !input.promotionEligible) return "promotion_audience_not_eligible";
  if (
    MARKETING_EVENTS.has(input.eventType) &&
    isQuietHour(input.companyTimeZone, input.quietHoursStart ?? 20, input.quietHoursEnd ?? 8)
  ) {
    return "quiet_hours";
  }
  return null;
}

export function promotionAudienceEligible(
  audience: string | null | undefined,
  context: { eventType: ContractorYouEventType; propertyType?: string | null }
) {
  if (!audience || audience === "ALL_CUSTOMERS") return true;
  if (audience === "RESIDENTIAL") return context.propertyType === "RESIDENTIAL";
  if (audience === "COMMERCIAL") return context.propertyType === "COMMERCIAL";
  if (audience === "MAINTENANCE_DUE") return context.eventType === "MAINTENANCE_DUE";
  if (audience === "PAST_CUSTOMERS") return context.eventType === "CUSTOMER_INACTIVE";
  if (audience === "UNSOLD_ESTIMATES") return context.eventType === "ESTIMATE_OPEN";
  return false;
}

export function isQuietHour(timeZone: string, quietStart: number, quietEnd: number, at = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone }).format(at));
  if (quietStart === quietEnd) return false;
  return quietStart > quietEnd ? hour >= quietStart || hour < quietEnd : hour >= quietStart && hour < quietEnd;
}

async function finishBlockedExecution(executionId: string, companyId: string, reason: string) {
  await prisma.automationExecution.update({
    where: { id: executionId },
    data: { status: "BLOCKED", decision: reason.toUpperCase(), failure: reason },
  });
  await auditConversation(companyId, null, executionId, "AUTOMATION_BLOCKED", reason.toUpperCase(), { reason });
}

async function auditConversation(
  companyId: string,
  threadId: string | null,
  executionId: string | null,
  event: string,
  decision: string,
  details: Record<string, unknown>
) {
  await prisma.conversationAuditEvent.create({
    data: { companyId, threadId, executionId, event, decision, details: details as Prisma.InputJsonValue },
  });
}

async function loadExecutionContext(input: {
  companyId: string;
  customerId?: string | null;
  jobId?: string | null;
  sourceType: string;
  sourceId: string;
}) {
  const [company, customer, job, directLead, call] = await Promise.all([
    prisma.company.findFirstOrThrow({ where: { id: input.companyId }, select: { businessName: true, timezone: true } }),
    input.customerId
      ? prisma.customer.findFirst({
          where: { id: input.customerId, companyId: input.companyId },
          include: { properties: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } },
        })
      : null,
    input.jobId
      ? prisma.job.findFirst({
          where: { id: input.jobId, companyId: input.companyId },
          include: { property: true, assignments: { include: { user: { select: { firstName: true } } }, take: 1 } },
        })
      : null,
    input.sourceType === "Lead"
      ? prisma.lead.findFirst({ where: { id: input.sourceId, companyId: input.companyId } })
      : null,
    input.sourceType === "CallRecord"
      ? prisma.callRecord.findFirst({ where: { id: input.sourceId, companyId: input.companyId } })
      : null,
  ]);
  const lead =
    directLead ||
    (call?.leadId
      ? await prisma.lead.findFirst({ where: { id: call.leadId, companyId: input.companyId } })
      : null);
  const resolvedCustomer =
    customer ||
    (job
      ? await prisma.customer.findFirst({
          where: { id: job.customerId, companyId: input.companyId },
          include: { properties: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } },
        })
      : call?.customerId
        ? await prisma.customer.findFirst({
            where: { id: call.customerId, companyId: input.companyId },
            include: { properties: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } },
          })
        : null);
  return { company, customer: resolvedCustomer, job, lead };
}

function appointmentWindow(
  job: { arrivalWindowStart: Date | null; arrivalWindowEnd: Date | null; scheduledStart: Date | null },
  timeZone: string
) {
  const start = job.arrivalWindowStart || job.scheduledStart;
  if (!start) return null;
  const format = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  if (!job.arrivalWindowEnd) return format.format(start);
  const end = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(job.arrivalWindowEnd);
  return `${format.format(start)}–${end}`;
}

function payloadText(payload: Prisma.JsonValue | null, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
