import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { sanitizeCustomerSms } from "@/lib/intelligence/receptionist/sanitize";

export async function handoffToOffice(input: {
  companyId: string;
  threadId: string;
  stateId?: string | null;
  customerId?: string | null;
  phone?: string | null;
  reason: string;
  sendCustomerReply?: boolean;
  replyText?: string;
}) {
  if (input.stateId) {
    await prisma.conversationSchedulingState.update({
      where: { id: input.stateId },
      data: { paused: true, status: "NEEDS_REVIEW", handoffReason: input.reason, lastAiAction: "human_handoff" },
    });
  }
  await writeAudit({
    companyId: input.companyId,
    action: "receptionist.handoff",
    entityType: "CommunicationThread",
    entityId: input.threadId,
    metadata: { reason: input.reason, customerId: input.customerId ?? null },
  });
  const existing = await prisma.companyTask.findFirst({
    where: { companyId: input.companyId, relatedType: "CommunicationThread", relatedId: input.threadId, status: "OPEN" },
  });
  if (!existing) {
    await prisma.companyTask.create({
      data: {
        companyId: input.companyId,
        title: "Conversation needs office review",
        details: input.reason.replaceAll("_", " "),
        relatedType: "CommunicationThread",
        relatedId: input.threadId,
        status: "OPEN",
      },
    });
  }
  if (input.sendCustomerReply !== false) {
    const to = input.phone;
    if (to) {
      await sendCompanyCommunication({
        companyId: input.companyId,
        channel: "SMS",
        to,
        body: sanitizeCustomerSms(
          input.replyText ||
            "I’m having trouble finalizing that right now. I’ve flagged it for the office so we can get it handled."
        ),
        customerId: input.customerId,
        origin: "CONTRACTORYOU_AUTOMATION",
      });
    }
  }
}
