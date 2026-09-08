import { prisma } from "@/lib/db";
import { ACTIVE_SCHEDULING_STATUSES, type OfferedSlot } from "@/lib/scheduling/conversation-turn";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";

export async function resolveActionThread(input: {
  companyId: string;
  conversationId?: string | null;
  phone?: string | null;
}) {
  if (input.conversationId) {
    const byExternal = await prisma.communicationThread.findFirst({
      where: { companyId: input.companyId, provider: HIGHLEVEL_PROVIDER_KEY, externalId: input.conversationId },
    });
    if (byExternal) return byExternal;
  }
  if (input.phone) {
    return prisma.communicationThread.findFirst({
      where: { companyId: input.companyId, phone: input.phone },
      orderBy: { lastActivityAt: "desc" },
    });
  }
  return null;
}

export async function persistOfferedSlots(input: {
  companyId: string;
  threadId: string;
  customerId?: string | null;
  propertyId?: string | null;
  serviceTypeId?: string | null;
  slots: OfferedSlot[];
}) {
  const existing = await prisma.conversationSchedulingState.findFirst({
    where: {
      companyId: input.companyId,
      threadId: input.threadId,
      status: { in: [...ACTIVE_SCHEDULING_STATUSES, "BOOKED"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (existing?.status === "BOOKED") return existing;
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  if (existing) {
    return prisma.conversationSchedulingState.update({
      where: { id: existing.id },
      data: {
        status: "CLARIFYING",
        missingField: "slot_selection",
        offeredSlots: input.slots,
        customerId: input.customerId ?? existing.customerId,
        propertyId: input.propertyId ?? existing.propertyId,
        serviceTypeId: input.serviceTypeId ?? existing.serviceTypeId,
        expiresAt,
      },
    });
  }
  return prisma.conversationSchedulingState.create({
    data: {
      companyId: input.companyId,
      threadId: input.threadId,
      customerId: input.customerId ?? null,
      propertyId: input.propertyId ?? null,
      serviceTypeId: input.serviceTypeId ?? null,
      status: "CLARIFYING",
      missingField: "slot_selection",
      offeredSlots: input.slots,
      expiresAt,
    },
  });
}

export async function loadActiveSchedulingState(companyId: string, threadId: string) {
  return prisma.conversationSchedulingState.findFirst({
    where: { companyId, threadId },
    orderBy: { updatedAt: "desc" },
  });
}
