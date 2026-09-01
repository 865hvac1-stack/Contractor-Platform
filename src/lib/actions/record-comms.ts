import { prisma } from "@/lib/db";

export async function recordOutboundSms(input: {
  companyId: string;
  customerId?: string | null;
  customerName?: string | null;
  to: string;
  body: string;
  provider: string;
  providerResultId?: string | null;
  simulated?: boolean;
  actionRequestId: string;
  targetId: string;
}) {
  const externalThreadId = input.customerId
    ? `ai-${input.customerId}`
    : `ai-phone-${input.to.replace(/\D/g, "").slice(-10) || input.targetId}`;
  const thread = await prisma.communicationThread.upsert({
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
      customerId: input.customerId ?? null,
      contactName: input.customerName ?? null,
      phone: input.to,
      lastPreview: input.body.slice(0, 240),
      lastActivityAt: new Date(),
    },
    update: {
      lastPreview: input.body.slice(0, 240),
      lastActivityAt: new Date(),
      customerId: input.customerId ?? undefined,
    },
  });
  await prisma.communicationMessage.create({
    data: {
      companyId: input.companyId,
      threadId: thread.id,
      provider: input.provider,
      externalId: input.providerResultId || `ai-msg-${input.targetId}`,
      direction: "OUTBOUND",
      channel: "SMS",
      kind: "SMS",
      body: input.body,
      occurredAt: new Date(),
      status: input.simulated ? "SIMULATED" : "SENT",
      metadata: {
        aiActionRequestId: input.actionRequestId,
        aiActionTargetId: input.targetId,
        demo: Boolean(input.simulated),
      },
    },
  });
}
