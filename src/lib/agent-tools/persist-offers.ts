import { prisma } from "@/lib/db";
import {
  chooseResolvedThread,
  isTerminalSchedulingPhase,
  mergeSchedulingIntake,
  phoneLookupVariants,
} from "@/lib/agent-tools/booking-contract";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";
import { parseIntake, type SchedulingIntake } from "@/lib/scheduling/conversation-identity";
import { ACTIVE_SCHEDULING_STATUSES, type OfferedSlot } from "@/lib/scheduling/conversation-turn";

const threadSelect = {
  id: true,
  companyId: true,
  phone: true,
  customerId: true,
  leadId: true,
  externalId: true,
  externalContactId: true,
  lastActivityAt: true,
  provider: true,
} as const;

export type ActionThreadRow = {
  id: string;
  companyId: string;
  phone: string | null;
  customerId: string | null;
  leadId: string | null;
  externalId: string;
  externalContactId: string | null;
  lastActivityAt: Date;
  provider: string;
};

export type ActionThreadResolution =
  | { status: "resolved"; thread: ActionThreadRow; matchedOn: "conversation_id" | "contact_id" | "phone" }
  | { status: "not_found" }
  | { status: "ambiguous"; count: number };

const RECENT_MS = 36 * 60 * 60 * 1000;

function uniqueThreads(rows: ActionThreadRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export async function resolveActionThread(input: {
  companyId: string;
  conversationId?: string | null;
  phone?: string | null;
  contactId?: string | null;
}): Promise<ActionThreadResolution> {
  if (input.conversationId) {
    const byExternal = await prisma.communicationThread.findFirst({
      where: { companyId: input.companyId, provider: HIGHLEVEL_PROVIDER_KEY, externalId: input.conversationId },
      select: threadSelect,
    });
    if (byExternal) return { status: "resolved", thread: byExternal, matchedOn: "conversation_id" };
  }

  const or = [
    ...(input.contactId ? [{ externalContactId: input.contactId }] : []),
    ...(phoneLookupVariants(input.phone).length ? [{ phone: { in: phoneLookupVariants(input.phone) } }] : []),
  ];

  const direct =
    or.length > 0
      ? await prisma.communicationThread.findMany({
          where: { companyId: input.companyId, provider: HIGHLEVEL_PROVIDER_KEY, OR: or },
          select: threadSelect,
          orderBy: { lastActivityAt: "desc" },
          take: 20,
        })
      : [];

  let matches = uniqueThreads(direct);
  const canonical = canonicalizeUsPhone(input.phone);
  if (!matches.length && canonical) {
    const recent = await prisma.communicationThread.findMany({
      where: { companyId: input.companyId, provider: HIGHLEVEL_PROVIDER_KEY, phone: { not: null } },
      select: threadSelect,
      orderBy: { lastActivityAt: "desc" },
      take: 80,
    });
    matches = uniqueThreads(recent.filter((row) => phonesMatch(canonical, row.phone)));
  }

  if (!matches.length) return { status: "not_found" };

  const chosen = chooseResolvedThread(matches, input.contactId, RECENT_MS);
  if (chosen.status === "resolved") {
    return {
      status: "resolved",
      thread: chosen.thread,
      matchedOn: input.contactId && chosen.thread.externalContactId === input.contactId ? "contact_id" : "phone",
    };
  }
  return chosen;
}

export function isActiveSchedulingSession(state: {
  status?: string | null;
  lastAiAction?: string | null;
  expiresAt?: Date | null;
  bookedJobId?: string | null;
} | null) {
  if (!state) return false;
  if (state.bookedJobId) return false;
  if (state.status === "BOOKED" || state.status === "CANCELED") return false;
  if (isTerminalSchedulingPhase(state.lastAiAction)) return false;
  if (state.expiresAt && state.expiresAt.getTime() < Date.now()) return false;
  return (ACTIVE_SCHEDULING_STATUSES as readonly string[]).includes(state.status || "");
}

export async function persistOfferedSlots(input: {
  companyId: string;
  threadId: string;
  customerId?: string | null;
  propertyId?: string | null;
  serviceTypeId?: string | null;
  customerConcern?: string | null;
  intake?: SchedulingIntake;
  slots: OfferedSlot[];
  phase?: string;
  lastInboundMessageId?: string | null;
}) {
  const existing = await loadOpenSchedulingSession(input.companyId, input.threadId);
  if (existing && !isActiveSchedulingSession(existing)) return existing;
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const intake = mergeSchedulingIntake(parseIntake(existing?.intake), input.intake ?? {});
  const data = {
    status: "CLARIFYING" as const,
    missingField: "slot_selection",
    offeredSlots: input.slots,
    customerId: input.customerId ?? existing?.customerId,
    propertyId: input.propertyId ?? existing?.propertyId,
    serviceTypeId: input.serviceTypeId ?? existing?.serviceTypeId,
    customerConcern: input.customerConcern ?? existing?.customerConcern,
    intake,
    lastAiAction: input.phase ?? "WAITING_FOR_SLOT_SELECTION",
    lastIntent: input.phase ?? "WAITING_FOR_SLOT_SELECTION",
    lastInboundMessageId: input.lastInboundMessageId ?? existing?.lastInboundMessageId,
    expiresAt,
  };
  if (existing) {
    return prisma.conversationSchedulingState.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.conversationSchedulingState.create({
    data: {
      companyId: input.companyId,
      threadId: input.threadId,
      ...data,
    },
  });
}

export async function persistSelectedSlot(input: {
  companyId: string;
  threadId: string;
  stateId?: string | null;
  date: string;
  windowId: string;
  customerId?: string | null;
  propertyId?: string | null;
  serviceTypeId?: string | null;
  intake?: SchedulingIntake;
  missingField?: string | null;
  phase: string;
  offeredSlots?: OfferedSlot[];
  customerConcern?: string | null;
  lastInboundMessageId?: string | null;
  lastIntent?: string | null;
}) {
  const existing = input.stateId
    ? await prisma.conversationSchedulingState.findFirst({
        where: { id: input.stateId, companyId: input.companyId },
      })
    : await loadOpenSchedulingSession(input.companyId, input.threadId);
  if (existing && !isActiveSchedulingSession(existing) && existing.status === "BOOKED") return existing;
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const intake = mergeSchedulingIntake(parseIntake(existing?.intake), input.intake ?? {});
  const data = {
    status: "CLARIFYING" as const,
    missingField: input.missingField ?? null,
    requestedDate: new Date(`${input.date}T00:00:00.000Z`),
    requestedWindowId: input.windowId,
    offeredSlots: input.offeredSlots ?? existing?.offeredSlots ?? undefined,
    customerId: input.customerId ?? existing?.customerId,
    propertyId: input.propertyId ?? existing?.propertyId,
    serviceTypeId: input.serviceTypeId ?? existing?.serviceTypeId,
    customerConcern: input.customerConcern ?? existing?.customerConcern,
    intake,
    lastAiAction: input.phase,
    lastIntent: input.lastIntent ?? input.phase,
    lastInboundMessageId: input.lastInboundMessageId ?? existing?.lastInboundMessageId,
    expiresAt,
  };
  if (existing) {
    return prisma.conversationSchedulingState.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.conversationSchedulingState.create({
    data: {
      companyId: input.companyId,
      threadId: input.threadId,
      ...data,
    },
  });
}

export async function markSchedulingBooked(input: {
  companyId: string;
  threadId: string;
  jobId: string;
  customerId?: string | null;
  propertyId?: string | null;
}) {
  const existing = await loadActiveSchedulingState(input.companyId, input.threadId);
  if (!existing) return null;
  return prisma.conversationSchedulingState.update({
    where: { id: existing.id },
    data: {
      status: "BOOKED",
      missingField: null,
      bookedJobId: input.jobId,
      customerId: input.customerId ?? existing.customerId,
      propertyId: input.propertyId ?? existing.propertyId,
      lastAiAction: "BOOKED",
      lastIntent: "BOOKED",
    },
  });
}

export async function loadActiveSchedulingState(companyId: string, threadId: string) {
  return prisma.conversationSchedulingState.findFirst({
    where: { companyId, threadId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function loadOpenSchedulingSession(companyId: string, threadId: string) {
  const state = await loadActiveSchedulingState(companyId, threadId);
  if (!isActiveSchedulingSession(state)) return null;
  return state;
}

export async function persistSchedulingSession(input: {
  companyId: string;
  threadId: string;
  stateId?: string | null;
  phase: string;
  status?: "OPEN" | "CLARIFYING" | "SUGGESTED" | "NEEDS_REVIEW" | "BOOKED" | "CANCELED";
  customerId?: string | null;
  propertyId?: string | null;
  serviceTypeId?: string | null;
  customerConcern?: string | null;
  intake?: SchedulingIntake;
  missingField?: string | null;
  offeredSlots?: OfferedSlot[] | null;
  requestedDate?: Date | null;
  requestedWindowId?: string | null;
  lastInboundMessageId?: string | null;
  lastIntent?: string | null;
  handoffReason?: string | null;
  bookedJobId?: string | null;
}) {
  const existing = input.stateId
    ? await prisma.conversationSchedulingState.findFirst({
        where: { id: input.stateId, companyId: input.companyId },
      })
    : await loadOpenSchedulingSession(input.companyId, input.threadId);
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const intake = mergeSchedulingIntake(parseIntake(existing?.intake), input.intake ?? {});
  const status =
    input.status ??
    (input.phase === "BOOKED"
      ? "BOOKED"
      : input.phase === "CANCELLED"
        ? "CANCELED"
        : input.phase === "HANDOFF"
          ? "NEEDS_REVIEW"
          : input.phase === "WAITING_FOR_SLOT_SELECTION" || input.phase === "SLOTS_OFFERED"
            ? "SUGGESTED"
            : "CLARIFYING");
  const data = {
    status,
    missingField: input.missingField ?? existing?.missingField ?? null,
    customerId: input.customerId ?? existing?.customerId,
    propertyId: input.propertyId ?? existing?.propertyId,
    serviceTypeId: input.serviceTypeId ?? existing?.serviceTypeId,
    customerConcern: input.customerConcern ?? existing?.customerConcern,
    intake,
    offeredSlots: input.offeredSlots ?? existing?.offeredSlots ?? undefined,
    requestedDate: input.requestedDate === undefined ? existing?.requestedDate : input.requestedDate,
    requestedWindowId: input.requestedWindowId === undefined ? existing?.requestedWindowId : input.requestedWindowId,
    lastAiAction: input.phase,
    lastIntent: input.lastIntent ?? input.phase,
    lastInboundMessageId: input.lastInboundMessageId ?? existing?.lastInboundMessageId,
    handoffReason: input.handoffReason ?? existing?.handoffReason,
    bookedJobId: input.bookedJobId ?? existing?.bookedJobId,
    paused: input.phase === "HANDOFF",
    expiresAt,
  };
  if (existing && isActiveSchedulingSession(existing)) {
    return prisma.conversationSchedulingState.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.conversationSchedulingState.create({
    data: {
      companyId: input.companyId,
      threadId: input.threadId,
      ...data,
    },
  });
}

export async function markSchedulingInbound(companyId: string, threadId: string, messageId: string) {
  await prisma.conversationSchedulingState.updateMany({
    where: { companyId, threadId },
    data: { lastInboundMessageId: messageId },
  });
}
