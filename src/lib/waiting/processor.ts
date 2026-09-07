import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { sendWaitingCommunication } from "@/lib/waiting/messages";
import { syncWaitingCustomerReply } from "@/lib/waiting/replies";
import { shouldStopWaitingAutomation } from "@/lib/waiting/safety";

export type WaitingProcessorResult = {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  stopped: number;
};

export async function processDueWaitingUpdates(input: {
  companyId?: string;
  now?: Date;
  limit?: number;
  db?: PrismaClient;
}): Promise<WaitingProcessorResult> {
  const db = input.db ?? defaultPrisma;
  const now = input.now ?? new Date();
  const result: WaitingProcessorResult = { scanned: 0, sent: 0, failed: 0, skipped: 0, stopped: 0 };

  const due = await db.waitingRecord.findMany({
    where: {
      state: "ACTIVE",
      automationEnabled: true,
      communicationEnabled: true,
      nextCustomerUpdateAt: { lte: now },
      column: { kind: { not: "READY" }, key: { not: "READY_TO_SCHEDULE" } },
      ...(input.companyId ? { companyId: input.companyId } : {}),
    },
    include: {
      job: { select: { status: true } },
      column: { select: { kind: true, key: true } },
    },
    orderBy: { nextCustomerUpdateAt: "asc" },
    take: input.limit ?? 100,
  });

  result.scanned = due.length;

  for (const record of due) {
    await syncWaitingCustomerReply(record.companyId, record.id, db);

    if (
      shouldStopWaitingAutomation({
        jobStatus: record.job.status,
        recordState: record.state,
        columnKind: record.column.kind,
        columnKey: record.column.key,
      })
    ) {
      const resolveJob = record.job.status === "COMPLETED" || record.job.status === "CANCELED";
      await db.waitingRecord.update({
        where: { id: record.id },
        data: {
          automationEnabled: false,
          nextCustomerUpdateAt: null,
          ...(resolveJob ? { state: "RESOLVED" as const, resolvedAt: now } : {}),
        },
      });
      await writeAudit({
        companyId: record.companyId,
        action: resolveJob ? "waiting.auto_resolved" : "waiting.automation_stopped",
        entityType: "WaitingRecord",
        entityId: record.id,
        metadata: { jobStatus: record.job.status },
      });
      result.stopped += 1;
      continue;
    }

    const sent = await sendWaitingCommunication({
      companyId: record.companyId,
      recordId: record.id,
      kind: "RECURRING",
      idempotencySlot: record.nextCustomerUpdateAt ?? now,
    });
    if (sent.ok && sent.skipped) result.skipped += 1;
    else if (sent.ok) result.sent += 1;
    else result.failed += 1;
  }

  return result;
}
