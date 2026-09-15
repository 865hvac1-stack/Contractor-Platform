import { prisma } from "@/lib/db";
import { emitDomainEvent, executeAutomationForEvent, isQuietHour } from "@/lib/conversations/event-engine";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { isSmsOptedOut } from "@/lib/actions/eligibility";
import { loadReceptionistSettings } from "@/lib/intelligence/receptionist/settings";
import { promotionIsActive } from "@/lib/conversations/personalization";

export async function processDueConversationEvents(input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const automations = await prisma.automation.findMany({
    where: {
      enabled: true,
      trigger: { in: ["APPOINTMENT_REMINDER_DUE", "MAINTENANCE_DUE"] },
    },
    select: { companyId: true, trigger: true, conditions: true },
  });
  const results: Array<{ companyId: string; type: string; sourceId: string }> = [];

  for (const automation of automations) {
    if (results.length >= limit) break;
    if (automation.trigger === "APPOINTMENT_REMINDER_DUE") {
      const reminderMinutes = numberFromConditions(automation.conditions, "reminderMinutes", 1440);
      const target = new Date(now.getTime() + reminderMinutes * 60_000);
      const tolerance = 10 * 60_000;
      const jobs = await prisma.job.findMany({
        where: {
          companyId: automation.companyId,
          status: { in: ["SCHEDULED", "DISPATCHED"] },
          scheduledStart: {
            gte: new Date(target.getTime() - tolerance),
            lte: new Date(target.getTime() + tolerance),
          },
        },
        select: { id: true, customerId: true, scheduledStart: true, updatedAt: true },
        take: limit - results.length,
      });
      for (const job of jobs) {
        if (!job.scheduledStart) continue;
        await emitDomainEvent({
          companyId: automation.companyId,
          type: "APPOINTMENT_REMINDER_DUE",
          sourceType: "Job",
          sourceId: job.id,
          customerId: job.customerId,
          jobId: job.id,
          idempotencyKey: `appointment-reminder:${job.id}:${job.scheduledStart.toISOString()}:${reminderMinutes}`,
          occurredAt: now,
          payload: { reminderMinutes, scheduledStart: job.scheduledStart.toISOString() },
        });
        results.push({ companyId: automation.companyId, type: "APPOINTMENT_REMINDER_DUE", sourceId: job.id });
      }
    }
    if (automation.trigger === "MAINTENANCE_DUE") {
      const visits = await prisma.maintenanceVisit.findMany({
        where: {
          companyId: automation.companyId,
          status: { in: ["DUE_SOON", "UNSCHEDULED", "OVERDUE"] },
          dueStart: { lte: now },
          jobId: null,
        },
        select: { id: true, customerId: true, cycleKey: true, dueStart: true },
        take: limit - results.length,
      });
      for (const visit of visits) {
        await emitDomainEvent({
          companyId: automation.companyId,
          type: "MAINTENANCE_DUE",
          sourceType: "MaintenanceVisit",
          sourceId: visit.id,
          customerId: visit.customerId,
          idempotencyKey: `maintenance-due:${visit.id}:${visit.cycleKey}`,
          occurredAt: now,
          payload: { dueStart: visit.dueStart.toISOString(), cycleKey: visit.cycleKey },
        });
        results.push({ companyId: automation.companyId, type: "MAINTENANCE_DUE", sourceId: visit.id });
      }
    }
  }
  const dueExecutions = await prisma.automationExecution.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: Math.max(0, limit - results.length),
    select: { eventId: true, automationId: true, companyId: true, sourceId: true },
  });
  for (const execution of dueExecutions) {
    await executeAutomationForEvent(execution.eventId, execution.automationId);
    results.push({ companyId: execution.companyId, type: "SCHEDULED_AUTOMATION", sourceId: execution.sourceId });
  }
  const followUps = await prisma.automationExecution.findMany({
    where: { status: "WAITING_FOR_CUSTOMER", nextFollowUpAt: { lte: now } },
    orderBy: { nextFollowUpAt: "asc" },
    take: Math.max(0, limit - results.length),
    select: { id: true },
  });
  for (const followUp of followUps) {
    const sent = await processAutomationFollowUp(followUp.id, now);
    if (sent) results.push(sent);
  }
  return { processed: results.length, events: results };
}

async function processAutomationFollowUp(executionId: string, now: Date) {
  const claimed = await prisma.automationExecution.updateMany({
    where: { id: executionId, status: "WAITING_FOR_CUSTOMER", nextFollowUpAt: { lte: now } },
    data: { status: "FOLLOW_UP_SENDING", nextFollowUpAt: null },
  });
  if (!claimed.count) return null;
  const execution = await prisma.automationExecution.findUnique({
    where: { id: executionId },
    include: {
      automation: { include: { promotion: true } },
      customer: true,
      thread: true,
      goalSession: true,
    },
  });
  if (!execution) return null;
  const { automation, customer, thread, goalSession } = execution;
  const stop =
    !automation.enabled ||
    execution.attemptCount >= automation.maxAttempts ||
    !customer?.phone ||
    Boolean(customer.smsMarketingOptedOutAt) ||
    isSmsOptedOut(customer) ||
    !thread ||
    thread.handlingState !== "REGINA_ACTIVE" ||
    !goalSession ||
    Boolean(goalSession.completedAt) ||
    Boolean(automation.promotionId && !promotionIsActive(automation.promotion, now));
  if (stop) {
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "STOPPED", decision: "FOLLOW_UP_STOP_CONDITION" } });
    return null;
  }
  if (!customer?.phone) return null;
  const company = await prisma.company.findFirstOrThrow({ where: { id: execution.companyId }, select: { businessName: true, timezone: true } });
  if (isQuietHour(company.timezone, automation.quietHoursStart ?? 20, automation.quietHoursEnd ?? 8, now)) {
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "WAITING_FOR_CUSTOMER", nextFollowUpAt: new Date(now.getTime() + 60 * 60_000) } });
    return null;
  }
  const settings = await loadReceptionistSettings(execution.companyId);
  const body = `Hey ${customer.firstName || "there"}, ${settings.assistantName} with ${company.businessName} here. Just following up — would you like help with this?`;
  const sent = await sendCompanyCommunication({
    companyId: execution.companyId,
    channel: "SMS",
    to: customer.phone,
    body,
    customerId: customer.id,
    origin: "CONTRACTORYOU_AUTOMATION",
  });
  const attemptCount = execution.attemptCount + 1;
  await prisma.automationExecution.update({
    where: { id: execution.id },
    data: {
      status: sent.ok ? "WAITING_FOR_CUSTOMER" : "FAILED",
      failure: sent.ok ? null : sent.error || "Follow-up send failed.",
      attemptCount,
      nextFollowUpAt:
        sent.ok && attemptCount < automation.maxAttempts && automation.followUpDelayMinutes
          ? new Date(now.getTime() + automation.followUpDelayMinutes * 60_000)
          : null,
    },
  });
  await prisma.conversationAuditEvent.create({
    data: {
      companyId: execution.companyId,
      threadId: thread.id,
      executionId: execution.id,
      event: sent.ok ? "AUTOMATION_FOLLOW_UP_SENT" : "AUTOMATION_FOLLOW_UP_FAILED",
      decision: sent.ok ? "SENT" : "FAILED",
      details: { attemptCount, maxAttempts: automation.maxAttempts },
    },
  });
  return sent.ok ? { companyId: execution.companyId, type: "AUTOMATION_FOLLOW_UP", sourceId: execution.sourceId } : null;
}

function numberFromConditions(value: unknown, key: string, fallback: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = Number((value as Record<string, unknown>)[key]);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}
