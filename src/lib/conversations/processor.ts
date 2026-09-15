import { prisma } from "@/lib/db";
import { emitDomainEvent } from "@/lib/conversations/event-engine";

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
  return { processed: results.length, events: results };
}

function numberFromConditions(value: unknown, key: string, fallback: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = Number((value as Record<string, unknown>)[key]);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}
