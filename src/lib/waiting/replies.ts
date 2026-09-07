import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function syncWaitingCustomerReply(
  companyId: string,
  recordId: string,
  db: PrismaClient = defaultPrisma
) {
  const record = await db.waitingRecord.findFirst({
    where: { id: recordId, companyId, state: "ACTIVE" },
    select: {
      id: true,
      customerId: true,
      lastCustomerUpdateAt: true,
      enteredAt: true,
      customerRepliedAt: true,
    },
  });
  if (!record) return null;

  const since = record.lastCustomerUpdateAt ?? record.enteredAt;
  const inbound = await db.communicationMessage.findFirst({
    where: {
      companyId,
      direction: "INBOUND",
      occurredAt: { gt: since },
      thread: { customerId: record.customerId, companyId },
    },
    orderBy: { occurredAt: "desc" },
  });
  if (!inbound) return null;
  if (record.customerRepliedAt && inbound.occurredAt <= record.customerRepliedAt) return record.customerRepliedAt;

  await db.waitingRecord.update({
    where: { id: record.id },
    data: { customerRepliedAt: inbound.occurredAt },
  });
  await writeAudit({
    companyId,
    action: "waiting.customer_replied",
    entityType: "WaitingRecord",
    entityId: record.id,
    metadata: { messageId: inbound.id },
  });
  return inbound.occurredAt;
}

export async function syncCompanyWaitingReplies(companyId: string, db: PrismaClient = defaultPrisma) {
  const records = await db.waitingRecord.findMany({
    where: { companyId, state: "ACTIVE" },
    select: { id: true },
    take: 200,
  });
  for (const record of records) {
    await syncWaitingCustomerReply(companyId, record.id, db);
  }
}
