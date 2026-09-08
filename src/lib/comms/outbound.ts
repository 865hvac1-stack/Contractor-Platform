import { prisma } from "@/lib/db";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { upsertConversationMessage } from "@/lib/highlevel/conversations";

export async function recordCanonicalOutboundSms(input: {
  companyId: string;
  provider: "highlevel" | "twilio" | "none" | "demo";
  to: string;
  body: string;
  providerId?: string | null;
  customerId?: string | null;
  leadId?: string | null;
}) {
  if (input.provider === "none" || input.provider === "demo") return null;
  const provider = input.provider === "highlevel" ? HIGHLEVEL_PROVIDER_KEY : input.provider;
  const existing = input.customerId
    ? await prisma.communicationThread.findFirst({
        where: {
          companyId: input.companyId,
          provider: HIGHLEVEL_PROVIDER_KEY,
          customerId: input.customerId,
        },
        orderBy: { lastActivityAt: "desc" },
      })
    : input.leadId
      ? await prisma.communicationThread.findFirst({
          where: {
            companyId: input.companyId,
            provider: HIGHLEVEL_PROVIDER_KEY,
            leadId: input.leadId,
          },
          orderBy: { lastActivityAt: "desc" },
        })
      : null;
  const conversationId = existing?.externalId || `outbound:${input.customerId || input.leadId || input.to}`;
  const messageId = input.providerId || `outbound-${Date.now()}-${conversationId}`;
  const written = await upsertConversationMessage(prisma, {
    companyId: input.companyId,
    conversationId,
    messageId,
    phone: input.to,
    body: input.body,
    channel: "SMS",
    direction: "outbound",
    kind: "SMS",
    occurredAt: new Date(),
    status: "SENT",
    unread: false,
    toNumber: input.to,
  });
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, companyId: input.companyId },
      select: { firstRespondedAt: true },
    });
    if (lead) {
      await prisma.lead.update({
        where: { id: input.leadId },
        data: {
          lastContactAt: new Date(),
          firstRespondedAt: lead.firstRespondedAt ?? new Date(),
        },
      });
    }
  }
  return written;
}
