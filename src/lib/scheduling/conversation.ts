import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { contractorYouMayAutoreply, loadCustomerConversationOwner } from "@/lib/comms/conversation-owner";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { getAvailability, findNextAvailableOptions, loadSchedulingPolicy } from "@/lib/scheduling/capacity";
import { interpretSchedulingIntent, mergeSchedulingIntent } from "@/lib/scheduling/intent";
import {
  askAddressAfterAckMessage,
  askAddressMessage,
  askNameMessage,
  askWhichPropertyMessage,
  cancelConfirmationMessage,
  clarificationMessage,
  clarifyOfferedSlotsMessage,
  unmatchedOfferedSlotMessage,
  slotTakenMessage,
  maintenanceDuplicateMessage,
  noAvailabilityMessage,
  noPlanMessage,
  officeReviewMessage,
  noOpenWindowsMessage,
  offerSlotsMessage,
  sessionClosedMessage,
  suggestedBookingMessage,
  thanksNameAskAddressMessage,
} from "@/lib/scheduling/templates";
import { companyTodayKey, formatLocalDateShort, formatWindowClock } from "@/lib/scheduling/time";
import { bookAppointment, cancelAppointment, rescheduleAppointment } from "@/lib/scheduling/booking";
import { findOpenMaintenanceVisit } from "@/lib/scheduling/maintenance";
import { conversationCanAutoBook } from "@/lib/scheduling/auto-book";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";
import { matchesDaypart } from "@/lib/scheduling/daypart";
import {
  createCustomerForConversation,
  createPropertyForConversation,
  extractCustomerConcern,
  hasReliableCustomerName,
  jobDescriptionFromConcern,
  loadSchedulingCustomerContext,
  matchPropertyFromText,
  parseIntake,
  parsePersonName,
  parseServiceAddress,
  propertyChoiceLabel,
  resolveSchedulingCustomer,
  type SchedulingCustomerContext,
  type SchedulingIntake,
} from "@/lib/scheduling/conversation-identity";
import {
  ACTIVE_SCHEDULING_STATUSES,
  isSchedulingTurn,
  ownsSchedulingInbound,
  parseOfferedSlots,
  resolveSchedulingTurn,
  shouldFetchNextAvailability,
  uniqueWindowOffers,
  type OfferedSlot,
} from "@/lib/scheduling/conversation-turn";

export type SchedulingReplyComposer = (input: { templateText: string; outcome?: string }) => Promise<string> | string;

export type SchedulingProcessInput = {
  companyId: string;
  threadId: string;
  customerId?: string | null;
  messageId: string;
  body?: string | null;
  direction?: string | null;
  channel?: string | null;
  phone?: string | null;
  forceScheduling?: boolean;
  composeReply?: SchedulingReplyComposer;
};

export async function processInboundScheduling(input: SchedulingProcessInput) {
  const direction = (input.direction || "").toUpperCase();
  if (direction && direction !== "INBOUND") return { handled: false as const };
  if (!input.body?.trim()) return { handled: false as const };
  const channel = (input.channel || "SMS").toUpperCase();
  if (channel === "CALL" || channel === "VOICEMAIL") return { handled: false as const };

  const conversationOwner = await loadCustomerConversationOwner(prisma, input.companyId);
  if (!contractorYouMayAutoreply(conversationOwner)) {
    return {
      handled: false as const,
      skipped: true as const,
      reason: "conversation_owner" as const,
      owner: conversationOwner,
    };
  }

  await ensureSchedulingSetup(prisma, input.companyId);
  const existingByMessage = await prisma.conversationSchedulingState.findFirst({
    where: { companyId: input.companyId, lastInboundMessageId: input.messageId },
  });
  if (existingByMessage) return { handled: true as const, duplicate: true as const, stateId: existingByMessage.id };

  const previous = await prisma.conversationSchedulingState.findFirst({
    where: {
      companyId: input.companyId,
      threadId: input.threadId,
      status: { in: [...ACTIVE_SCHEDULING_STATUSES] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { updatedAt: "desc" },
  });

  const company = await prisma.company.findFirst({
    where: { id: input.companyId },
    select: { timezone: true },
  });
  const timeZone = company?.timezone || "America/New_York";
  const windows = await prisma.appointmentWindow.findMany({
    where: { companyId: input.companyId, active: true },
    orderBy: { sortOrder: "asc" },
  });
  const fresh = interpretSchedulingIntent({ text: input.body, timeZone, windows });
  const route = ownsSchedulingInbound({
    activeState: previous,
    intent: fresh,
  });
  if (route === "ignore" && !input.forceScheduling) {
    return { handled: false as const };
  }

  if (previous?.paused && !fresh.humanRequested && !fresh.declineIntent) {
    return { handled: false as const, paused: true as const };
  }

  const previousIntent = previous
    ? {
        requestedDate: previous.requestedDate?.toISOString().slice(0, 10) ?? null,
        requestedDateEnd: previous.requestedDateEnd?.toISOString().slice(0, 10) ?? null,
        requestedDaypart: previous.requestedDaypart,
        requestedWindowId: previous.requestedWindowId,
        serviceIntent: previous.serviceIntent,
        maintenanceIntent: previous.maintenanceIntent,
        urgency: (previous.urgency as "normal" | "emergency" | null) ?? null,
        rescheduleIntent: previous.rescheduleIntent,
        cancelIntent: previous.cancelIntent,
        declineIntent: false,
        availabilityAsk: false,
        availabilitySearchRequested: false,
        missingField: previous.missingField as
          | "date"
          | "daypart"
          | "window"
          | "appointment"
          | "service"
          | "slot_selection"
          | "name"
          | "address"
          | "property"
          | null,
        confidence: "high" as const,
      }
    : null;
  const intent = previousIntent ? mergeSchedulingIntent(previousIntent, fresh) : fresh;
  const policy = await loadSchedulingPolicy(prisma, input.companyId);
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const inboundConcern = extractCustomerConcern(input.body || "");

  const identity = await resolveSchedulingCustomer(prisma, {
    companyId: input.companyId,
    customerId: input.customerId ?? previous?.customerId,
    phone: input.phone,
    threadId: input.threadId,
  });
  const resolvedCustomerId = identity.customerId ?? previous?.customerId ?? input.customerId ?? null;

  const state = previous
    ? await prisma.conversationSchedulingState.update({
        where: { id: previous.id },
        data: {
          customerId: resolvedCustomerId ?? previous.customerId,
          lastInboundMessageId: input.messageId,
          requestedDate: intent.requestedDate ? new Date(`${intent.requestedDate}T00:00:00.000Z`) : previous.requestedDate,
          requestedDateEnd: intent.requestedDateEnd ? new Date(`${intent.requestedDateEnd}T00:00:00.000Z`) : previous.requestedDateEnd,
          requestedDaypart: intent.requestedDaypart,
          requestedWindowId: intent.requestedWindowId ?? previous.requestedWindowId,
          serviceIntent: intent.serviceIntent,
          maintenanceIntent: intent.maintenanceIntent,
          urgency: intent.urgency,
          rescheduleIntent: intent.rescheduleIntent,
          cancelIntent: intent.cancelIntent,
          missingField: intent.missingField ?? previous.missingField,
          customerConcern: inboundConcern ?? previous.customerConcern,
          expiresAt,
        },
      })
    : await prisma.conversationSchedulingState.create({
        data: {
          companyId: input.companyId,
          threadId: input.threadId,
          customerId: resolvedCustomerId,
          lastInboundMessageId: input.messageId,
          requestedDate: intent.requestedDate ? new Date(`${intent.requestedDate}T00:00:00.000Z`) : null,
          requestedDateEnd: intent.requestedDateEnd ? new Date(`${intent.requestedDateEnd}T00:00:00.000Z`) : null,
          requestedDaypart: intent.requestedDaypart,
          requestedWindowId: intent.requestedWindowId,
          serviceIntent: intent.serviceIntent,
          maintenanceIntent: intent.maintenanceIntent,
          urgency: intent.urgency,
          rescheduleIntent: intent.rescheduleIntent,
          cancelIntent: intent.cancelIntent,
          missingField: intent.missingField,
          customerConcern: inboundConcern,
          expiresAt,
        },
      });

  if (resolvedCustomerId && resolvedCustomerId !== input.customerId) {
    await prisma.communicationThread.updateMany({
      where: { id: input.threadId, companyId: input.companyId, customerId: null },
      data: { customerId: resolvedCustomerId },
    });
  }

  let customerId = resolvedCustomerId;
  let customerContext = customerId
    ? await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId })
    : null;
  let intake = parseIntake(previous?.intake ?? state.intake);
  let propertyId = previous?.propertyId ?? state.propertyId ?? null;
  if (!propertyId && customerContext?.properties.length === 1) {
    propertyId = customerContext.properties[0]!.id;
  }

  const replyInput = {
    ...input,
    customerId,
    phone: input.phone || customerContext?.phone || null,
    composeReply: input.composeReply,
  };

  if (intent.humanRequested) {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { paused: true, status: "PAUSED" },
    });
    await markNeedsReview(state.id, input.companyId, "human_requested");
    await reply(replyInput, officeReviewMessage());
    return { handled: true as const, stateId: state.id, outcome: "paused" as const };
  }

  if (intent.declineIntent && !intent.cancelIntent) {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CANCELED", cancelIntent: true },
    });
    await reply(replyInput, sessionClosedMessage());
    return { handled: true as const, stateId: state.id, outcome: "declined" as const };
  }

  const upcoming = customerId
    ? await prisma.job.findMany({
        where: {
          companyId: input.companyId,
          customerId,
          status: { in: ["SCHEDULED", "DISPATCHED"] },
          scheduledStart: { gte: new Date() },
        },
        include: { appointmentWindow: true, assignments: true },
        orderBy: { scheduledStart: "asc" },
      })
    : [];

  if (intent.cancelIntent) {
    if (!customerId || upcoming.length !== 1) {
      await prisma.conversationSchedulingState.update({
        where: { id: state.id },
        data: { status: "CLARIFYING", missingField: "appointment" },
      });
      await reply(replyInput, clarificationMessage({ policy, missing: "appointment" }));
      return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
    }
    const canceled = await cancelAppointment({
      companyId: input.companyId,
      jobId: upcoming[0]!.id,
      auto: true,
    });
    if (canceled.needsReview) {
      await markNeedsReview(state.id, input.companyId, "cancel_requires_office");
      await reply(replyInput, officeReviewMessage());
      return { handled: true as const, stateId: state.id, outcome: "needs_review" as const };
    }
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CANCELED" },
    });
    const when = upcoming[0]!.appointmentWindow
      ? `${formatLocalDateShort(upcoming[0]!.scheduledStart!.toISOString().slice(0, 10), timeZone)} ${formatWindowClock(upcoming[0]!.appointmentWindow.startMinutes, upcoming[0]!.appointmentWindow.endMinutes)}`
      : "that appointment";
    await reply(replyInput, cancelConfirmationMessage(when));
    return { handled: true as const, stateId: state.id, outcome: "canceled" as const };
  }

  let maintenanceVisitId: string | null = null;
  if (intent.maintenanceIntent && customerId) {
    const visit = await findOpenMaintenanceVisit(input.companyId, customerId);
    if (!visit) {
      if (policy.allowPaidOneTimeMaintenance) {
        intent.serviceIntent = "maintenance";
      } else {
        await prisma.conversationSchedulingState.update({
          where: { id: state.id },
          data: { status: "NEEDS_REVIEW" },
        });
        await markNeedsReview(state.id, input.companyId, "no_maintenance_plan");
        await reply(replyInput, noPlanMessage({ policy }));
        return { handled: true as const, stateId: state.id, outcome: "no_plan" as const };
      }
    } else if (visit.status === "SCHEDULED" && visit.jobId) {
      await writeAudit({
        companyId: input.companyId,
        action: "scheduling.maintenance_duplicate_prevented",
        entityType: "MaintenanceVisit",
        entityId: visit.id ?? visit.cycleKey,
        metadata: { jobId: visit.jobId },
      });
      const start = visit.scheduledWindow ? Number(visit.scheduledWindow.split("-")[0]) : 9 * 60;
      const end = visit.scheduledWindow ? Number(visit.scheduledWindow.split("-")[1]) : 11 * 60;
      await reply(
        replyInput,
        maintenanceDuplicateMessage({
          policy,
          dateKey: visit.scheduledDate || visit.dueStart,
          startMinutes: start,
          endMinutes: end,
          timeZone,
        })
      );
      await prisma.conversationSchedulingState.update({
        where: { id: state.id },
        data: { status: "CLARIFYING", missingField: "appointment" },
      });
      return { handled: true as const, stateId: state.id, outcome: "duplicate_maintenance" as const };
    } else {
      maintenanceVisitId = visit.id;
    }
  }

  if (intent.rescheduleIntent) {
    if (!customerId || upcoming.length !== 1) {
      await prisma.conversationSchedulingState.update({
        where: { id: state.id },
        data: { status: "CLARIFYING", missingField: "appointment" },
      });
      await reply(replyInput, clarificationMessage({ policy, missing: "appointment" }));
      return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
    }
  }

  const serviceTypeId = intent.maintenanceIntent
    ? policy.maintenanceServiceTypeId ?? policy.defaultServiceTypeId
    : policy.defaultServiceTypeId;
  const rule = serviceTypeId
    ? await prisma.serviceTypeSchedulingRule.findFirst({
        where: { companyId: input.companyId, serviceTypeId },
      })
    : null;
  const canAutoBook = conversationCanAutoBook(policy, rule);
  const offeredSlots = parseOfferedSlots(previous?.offeredSlots);
  const selectedFromState =
    previous?.requestedDate && previous.requestedWindowId
      ? { date: previous.requestedDate.toISOString().slice(0, 10), windowId: previous.requestedWindowId }
      : null;

  const intakeMissing = previous?.missingField === "name" || previous?.missingField === "address" || previous?.missingField === "property";
  if (intakeMissing && selectedFromState) {
    const collected = await collectRequiredInfo({
      companyId: input.companyId,
      threadId: input.threadId,
      stateId: state.id,
      text: input.body || "",
      missing: previous.missingField!,
      intake,
      customerId,
      customerContext,
      propertyId,
      leadId: identity.leadId,
      phone: input.phone,
    });
    intake = collected.intake;
    customerId = collected.customerId;
    customerContext = collected.customerContext;
    propertyId = collected.propertyId;
    if (collected.ask) {
      await reply({ ...replyInput, customerId, phone: input.phone || customerContext?.phone || input.phone }, collected.ask);
      return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
    }
    return finishSelectedSlot({
      input: { ...input, customerId, phone: input.phone || customerContext?.phone || input.phone },
      stateId: state.id,
      policy,
      timeZone,
      canAutoBook,
      serviceTypeId,
      maintenanceVisitId,
      intent,
      upcoming,
      chosenDate: selectedFromState.date,
      chosenWindowId: selectedFromState.windowId,
      customerId,
      propertyId,
      customerConcern: inboundConcern ?? previous.customerConcern,
      nextSlots: offeredSlots,
      leadId: identity.leadId,
    });
  }

  const todayKey = companyTodayKey(new Date(), timeZone);
  const filterOptions = (
    options: Awaited<ReturnType<typeof getAvailability>>["options"],
    dateFilter?: string | null
  ) =>
    options.filter((option) => {
      if (dateFilter && option.date !== dateFilter) return false;
      if (intent.requestedWindowId && option.windowId !== intent.requestedWindowId) return false;
      if (intent.requestedDaypart && !matchesDaypart(option, intent.requestedDaypart)) return false;
      if (intent.requestedStartMinutes != null) {
        return intent.requestedStartMinutes >= option.startMinutes && intent.requestedStartMinutes < option.endMinutes;
      }
      return true;
    });

  const fetchNext = shouldFetchNextAvailability({
    intent,
    previousMissing: previous?.missingField,
    offeredSlots,
    text: input.body || "",
  });

  let todaySlots: OfferedSlot[] = [];
  let requestedSlots: OfferedSlot[] = [];
  let nextSlots: OfferedSlot[] = [];

  if (fetchNext || previous?.missingField !== "slot_selection") {
    const todayAvailability = await getAvailability({
      companyId: input.companyId,
      date: todayKey,
      serviceTypeId,
      maintenance: intent.maintenanceIntent,
    });
    todaySlots = uniqueWindowOffers(filterOptions(todayAvailability.options, todayKey));
    requestedSlots = todaySlots;
    if (intent.requestedDate && intent.requestedDate !== todayKey) {
      const requestedAvailability = await getAvailability({
        companyId: input.companyId,
        date: intent.requestedDate,
        appointmentWindowId: intent.requestedWindowId,
        serviceTypeId,
        maintenance: intent.maintenanceIntent,
      });
      requestedSlots = uniqueWindowOffers(filterOptions(requestedAvailability.options, intent.requestedDate));
    } else if (intent.requestedDate === todayKey) {
      requestedSlots = uniqueWindowOffers(filterOptions(todayAvailability.options, todayKey));
    } else if (intent.requestedDateEnd && intent.requestedDate) {
      requestedSlots = [];
      for (const date of expandDates(intent.requestedDate, intent.requestedDateEnd)) {
        const availability = await getAvailability({
          companyId: input.companyId,
          date,
          appointmentWindowId: intent.requestedWindowId,
          serviceTypeId,
          maintenance: intent.maintenanceIntent,
        });
        requestedSlots.push(...uniqueWindowOffers(filterOptions(availability.options, date)));
      }
    }
  }

  if (fetchNext) {
    const nextOptions = await findNextAvailableOptions({
      companyId: input.companyId,
      startDate: intent.requestedDate || todayKey,
      days: intent.maintenanceIntent ? 60 : policy.standardHorizonDays,
      serviceTypeId,
      daypart: intent.requestedDaypart,
      maintenance: intent.maintenanceIntent,
    });
    nextSlots = uniqueWindowOffers(filterOptions(nextOptions), 4);
  }

  const turn = resolveSchedulingTurn({
    previous: previous ? { status: previous.status, paused: previous.paused, missingField: previous.missingField } : null,
    intent,
    text: input.body,
    offeredSlots,
    canAutoBook,
    todayKey,
    todaySlots,
    requestedSlots,
    nextSlots,
  });

  if (turn.action === "ask") {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CLARIFYING", missingField: turn.missing, customerId, propertyId },
    });
    await reply(replyInput, clarificationMessage({ policy, missing: turn.missing }));
    return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
  }

  if (turn.action === "clarify_slots") {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: {
        status: "CLARIFYING",
        missingField: "slot_selection",
        offeredSlots: turn.slots,
        customerId,
        propertyId,
      },
    });
    await reply(
      replyInput,
      clarifyOfferedSlotsMessage({
        slots: turn.slots.map((slot) => ({
          dateKey: slot.date,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
          timeZone,
        })),
      })
    );
    return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
  }

  if (turn.action === "unmatched_slot") {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CLARIFYING", missingField: "slot_selection", offeredSlots, customerId, propertyId },
    });
    await reply(replyInput, unmatchedOfferedSlotMessage());
    return { handled: true as const, stateId: state.id, outcome: "unmatched_slot" as const };
  }

  if (turn.action === "offer_slots") {
    if (!turn.slots.length) {
      await markNeedsReview(state.id, input.companyId, "no_availability");
      await reply(replyInput, noOpenWindowsMessage());
      return { handled: true as const, stateId: state.id, outcome: "needs_review" as const };
    }
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: {
        status: "CLARIFYING",
        missingField: "slot_selection",
        offeredSlots: turn.slots,
        requestedDate: null,
        requestedWindowId: null,
        customerId,
        propertyId,
      },
    });
    await reply(
      replyInput,
      offerSlotsMessage({
        slots: turn.slots.map((slot) => ({
          dateKey: slot.date,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
          timeZone,
        })),
        todayKey,
        todayWasFull: turn.todayWasFull,
        keepGoing: Boolean(previous && !isSchedulingTurn(fresh) && !fresh.availabilityAsk),
      })
    );
    return { handled: true as const, stateId: state.id, outcome: "offered" as const };
  }

  if (turn.action === "handoff") {
    await markNeedsReview(state.id, input.companyId, turn.reason);
    await reply(replyInput, turn.reason === "no_availability" ? noOpenWindowsMessage() : officeReviewMessage());
    return { handled: true as const, stateId: state.id, outcome: "needs_review" as const };
  }

  if (turn.action === "close") {
    await prisma.conversationSchedulingState.update({
      where: { id: state.id },
      data: { status: "CANCELED" },
    });
    await reply(replyInput, sessionClosedMessage());
    return { handled: true as const, stateId: state.id, outcome: "declined" as const };
  }

  const chosenDate = turn.action === "book" || turn.action === "suggest" ? turn.date : null;
  const chosenWindowId = turn.action === "book" || turn.action === "suggest" ? turn.windowId : null;
  if (!chosenDate || !chosenWindowId) {
    await markNeedsReview(state.id, input.companyId, "ambiguous_request");
    await reply(replyInput, officeReviewMessage());
    return { handled: true as const, stateId: state.id, outcome: "needs_review" as const };
  }

  await prisma.conversationSchedulingState.update({
    where: { id: state.id },
    data: {
      requestedDate: new Date(`${chosenDate}T00:00:00.000Z`),
      requestedWindowId: chosenWindowId,
      customerId,
      propertyId,
    },
  });

  const collected = await collectRequiredInfo({
    companyId: input.companyId,
    threadId: input.threadId,
    stateId: state.id,
    text: "",
    missing: null,
    intake,
    customerId,
    customerContext,
    propertyId,
    leadId: identity.leadId,
    phone: input.phone,
  });
  if (collected.ask) {
    await reply({ ...replyInput, customerId: collected.customerId, phone: input.phone || collected.customerContext?.phone || input.phone }, collected.ask);
    return { handled: true as const, stateId: state.id, outcome: "clarify" as const };
  }

  return finishSelectedSlot({
    input: { ...input, customerId: collected.customerId, phone: input.phone || collected.customerContext?.phone || input.phone },
    stateId: state.id,
    policy,
    timeZone,
    canAutoBook: turn.action === "book",
    serviceTypeId,
    maintenanceVisitId,
    intent,
    upcoming,
    chosenDate,
    chosenWindowId,
    customerId: collected.customerId,
    propertyId: collected.propertyId,
    customerConcern: inboundConcern ?? previous?.customerConcern ?? state.customerConcern,
    nextSlots,
    leadId: identity.leadId,
  });
}

async function collectRequiredInfo(input: {
  companyId: string;
  threadId: string;
  stateId: string;
  text: string;
  missing: string | null;
  intake: SchedulingIntake;
  customerId: string | null;
  customerContext: SchedulingCustomerContext | null;
  propertyId: string | null;
  leadId: string | null;
  phone?: string | null;
}) {
  let { intake, customerId, customerContext, propertyId } = input;

  if (input.missing === "name") {
    const name = parsePersonName(input.text);
    if (!name) {
      await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: "name" });
      return { intake, customerId, customerContext, propertyId, ask: askNameMessage() };
    }
    intake = { ...intake, firstName: name.firstName, lastName: name.lastName };
  } else if (input.missing === "address") {
    const address = parseServiceAddress(input.text);
    if (!address) {
      await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: "address" });
      return { intake, customerId, customerContext, propertyId, ask: askAddressMessage() };
    }
    intake = { ...intake, ...address };
  } else if (input.missing === "property" && customerContext) {
    const matches = matchPropertyFromText(input.text, customerContext.properties);
    if (matches.length === 1) {
      propertyId = matches[0]!.id;
    } else {
      const labels = customerContext.properties.map((row, index) => propertyChoiceLabel(row, index));
      await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: "property" });
      return { intake, customerId, customerContext, propertyId, ask: askWhichPropertyMessage(labels) };
    }
  }

  if (!customerId) {
    if (!intake.firstName) {
      await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: "name" });
      return { intake, customerId, customerContext, propertyId, ask: askNameMessage() };
    }
    if (!intake.street || !intake.city || !intake.state || !intake.zip) {
      await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: "address" });
      return {
        intake,
        customerId,
        customerContext,
        propertyId,
        ask:
          input.missing === "name" && hasReliableCustomerName(intake.firstName)
            ? thanksNameAskAddressMessage(intake.firstName!)
            : askAddressAfterAckMessage(),
      };
    }
    const thread = await prisma.communicationThread.findFirst({
      where: { id: input.threadId, companyId: input.companyId },
      select: { externalContactId: true },
    });
    customerId = await createCustomerForConversation(prisma, {
      companyId: input.companyId,
      firstName: intake.firstName,
      lastName: intake.lastName,
      phone: input.phone,
      leadId: input.leadId,
      threadId: input.threadId,
      contactId: thread?.externalContactId,
      source: "SMS",
    });
    propertyId = await createPropertyForConversation(prisma, {
      companyId: input.companyId,
      customerId,
      street: intake.street,
      city: intake.city,
      state: intake.state,
      zip: intake.zip,
    });
    customerContext = await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId });
  } else {
    customerContext =
      customerContext ?? (await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId }));
    const properties = customerContext?.properties ?? [];
    if (propertyId && !properties.some((row) => row.id === propertyId)) propertyId = null;
    if (!propertyId && properties.length === 1) propertyId = properties[0]!.id;
    if (!propertyId && properties.length > 1) {
      const labels = properties.map((row, index) => propertyChoiceLabel(row, index));
      await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: "property" });
      return { intake, customerId, customerContext, propertyId, ask: askWhichPropertyMessage(labels) };
    }
    if (!propertyId && properties.length === 0) {
      if (!intake.street || !intake.city || !intake.state || !intake.zip) {
        await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: "address" });
        return { intake, customerId, customerContext, propertyId, ask: askAddressMessage() };
      }
      propertyId = await createPropertyForConversation(prisma, {
        companyId: input.companyId,
        customerId,
        street: intake.street,
        city: intake.city,
        state: intake.state,
        zip: intake.zip,
      });
      customerContext = await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId });
    }
  }

  await persistIntake(input.stateId, { intake, customerId, propertyId, missingField: null });
  return { intake, customerId, customerContext, propertyId, ask: null as string | null };
}

async function persistIntake(
  stateId: string,
  input: { intake: SchedulingIntake; customerId: string | null; propertyId: string | null; missingField: string | null }
) {
  await prisma.conversationSchedulingState.update({
    where: { id: stateId },
    data: {
      intake: input.intake,
      customerId: input.customerId,
      propertyId: input.propertyId,
      missingField: input.missingField,
      status: "CLARIFYING",
    },
  });
}

async function finishSelectedSlot(input: {
  input: SchedulingProcessInput & { customerId?: string | null };
  stateId: string;
  policy: Awaited<ReturnType<typeof loadSchedulingPolicy>>;
  timeZone: string;
  canAutoBook: boolean;
  serviceTypeId: string | null;
  maintenanceVisitId: string | null;
  intent: ReturnType<typeof interpretSchedulingIntent>;
  upcoming: Array<{ id: string }>;
  chosenDate: string;
  chosenWindowId: string;
  customerId: string | null;
  propertyId: string | null;
  customerConcern: string | null;
  nextSlots: OfferedSlot[];
  leadId: string | null;
}) {
  const replyInput = input.input;
  if (input.intent.maintenanceIntent && input.customerId && !input.maintenanceVisitId) {
    const visit = await findOpenMaintenanceVisit(input.input.companyId, input.customerId);
    if (visit?.status === "SCHEDULED" && visit.jobId) {
      await reply(replyInput, officeReviewMessage());
      return { handled: true as const, stateId: input.stateId, outcome: "duplicate_maintenance" as const };
    }
    if (visit) input.maintenanceVisitId = visit.id;
  }
  const recheck = await getAvailability({
    companyId: input.input.companyId,
    date: input.chosenDate,
    appointmentWindowId: input.chosenWindowId,
    serviceTypeId: input.serviceTypeId,
    maintenance: input.intent.maintenanceIntent,
  });
  const stillOpen = recheck.options.find(
    (option) => option.windowId === input.chosenWindowId && option.remainingCapacity > 0
  );
  if (!stillOpen) {
    const alternatives = await findNextAvailableOptions({
      companyId: input.input.companyId,
      startDate: input.chosenDate,
      days: input.intent.maintenanceIntent ? 60 : input.policy.standardHorizonDays,
      serviceTypeId: input.serviceTypeId,
      maintenance: input.intent.maintenanceIntent,
    });
    const nextSlots = uniqueWindowOffers(alternatives, 4);
    await prisma.conversationSchedulingState.update({
      where: { id: input.stateId },
      data: { status: "CLARIFYING", missingField: "slot_selection", offeredSlots: nextSlots },
    });
    await reply(
      replyInput,
      nextSlots.length
        ? `${slotTakenMessage()} ${offerSlotsMessage({
            slots: nextSlots.map((row) => ({
              dateKey: row.date,
              startMinutes: row.startMinutes,
              endMinutes: row.endMinutes,
              timeZone: input.timeZone,
            })),
            todayKey: input.chosenDate,
          })}`
        : slotTakenMessage()
    );
    return { handled: true as const, stateId: input.stateId, outcome: "alternatives" as const };
  }

  if (!input.canAutoBook || !input.customerId || !input.propertyId) {
    await prisma.conversationSchedulingState.update({
      where: { id: input.stateId },
      data: {
        status: "SUGGESTED",
        requestedDate: new Date(`${input.chosenDate}T00:00:00.000Z`),
        requestedWindowId: input.chosenWindowId,
        customerId: input.customerId,
        propertyId: input.propertyId,
      },
    });
    await markNeedsReview(input.stateId, input.input.companyId, "office_approval");
    await reply(
      replyInput,
      suggestedBookingMessage({
        dateKey: stillOpen.date,
        startMinutes: stillOpen.startMinutes,
        endMinutes: stillOpen.endMinutes,
        timeZone: input.timeZone,
      })
    );
    return { handled: true as const, stateId: input.stateId, outcome: "suggested" as const };
  }

  const description = jobDescriptionFromConcern(input.customerConcern);
  const messageId = input.input.messageId;
  const booked = input.intent.rescheduleIntent && input.upcoming[0]
    ? await rescheduleAppointment({
        companyId: input.input.companyId,
        jobId: input.upcoming[0].id,
        date: input.chosenDate,
        windowId: input.chosenWindowId,
        threadId: input.input.threadId,
        inboundMessageId: messageId,
        sendConfirmation: true,
      })
    : await bookAppointment({
        companyId: input.input.companyId,
        customerId: input.customerId,
        propertyId: input.propertyId,
        serviceTypeId: input.serviceTypeId,
        date: input.chosenDate,
        windowId: input.chosenWindowId,
        source: input.intent.maintenanceIntent ? "MAINTENANCE" : "CONVERSATION",
        threadId: input.input.threadId,
        inboundMessageId: messageId,
        idempotencyKey: `inbound:${messageId}`,
        maintenanceVisitId: input.maintenanceVisitId,
        description,
        sendConfirmation: true,
        maintenance: input.intent.maintenanceIntent,
      });

  if (!booked.ok) {
    if (booked.code === "DUPLICATE_MAINTENANCE") {
      await reply(replyInput, officeReviewMessage());
      return { handled: true as const, stateId: input.stateId, outcome: "duplicate_maintenance" as const };
    }
    const alternatives = await findNextAvailableOptions({
      companyId: input.input.companyId,
      startDate: input.chosenDate,
      days: input.policy.standardHorizonDays,
      serviceTypeId: input.serviceTypeId,
      maintenance: input.intent.maintenanceIntent,
    });
    const nextSlots = uniqueWindowOffers(alternatives, 4);
    await prisma.conversationSchedulingState.update({
      where: { id: input.stateId },
      data: { status: "CLARIFYING", missingField: "slot_selection", offeredSlots: nextSlots },
    });
    await reply(
      replyInput,
      nextSlots.length
        ? `${slotTakenMessage()} ${offerSlotsMessage({
            slots: nextSlots.map((row) => ({
              dateKey: row.date,
              startMinutes: row.startMinutes,
              endMinutes: row.endMinutes,
              timeZone: input.timeZone,
            })),
            todayKey: input.chosenDate,
          })}`
        : slotTakenMessage()
    );
    return { handled: true as const, stateId: input.stateId, outcome: "alternatives" as const };
  }

  if (input.leadId) {
    await prisma.lead.updateMany({
      where: { id: input.leadId, companyId: input.input.companyId },
      data: { jobId: booked.jobId, customerId: input.customerId, status: "BOOKED" },
    });
  }

  await prisma.conversationSchedulingState.update({
    where: { id: input.stateId },
    data: {
      status: "BOOKED",
      bookedJobId: booked.jobId,
      offeredSlots: [],
      missingField: null,
      customerId: input.customerId,
      propertyId: input.propertyId,
      customerConcern: input.customerConcern,
    },
  });
  return { handled: true as const, stateId: input.stateId, outcome: "booked" as const, jobId: booked.jobId };
}

function expandDates(start: string, end: string) {
  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < 40 && cursor <= end; i += 1) {
    dates.push(cursor);
    const [y, m, d] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return dates;
}

async function reply(
  input: {
    companyId: string;
    customerId?: string | null;
    phone?: string | null;
    composeReply?: SchedulingReplyComposer;
  },
  body: string
) {
  const customer = input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId, companyId: input.companyId },
        select: { phone: true },
      })
    : null;
  const to = customer?.phone || input.phone;
  if (!to) return;
  const text = input.composeReply ? await input.composeReply({ templateText: body }) : body;
  await sendCompanyCommunication({
    companyId: input.companyId,
    channel: "SMS",
    to,
    body: text,
    customerId: input.customerId,
    origin: "CONTRACTORYOU_AUTOMATION",
  });
}

async function markNeedsReview(stateId: string, companyId: string, reason: string) {
  await prisma.conversationSchedulingState.update({
    where: { id: stateId },
    data: { status: reason === "human_requested" ? "PAUSED" : "NEEDS_REVIEW" },
  });
  await writeAudit({
    companyId,
    action: "scheduling.needs_review",
    entityType: "ConversationSchedulingState",
    entityId: stateId,
    metadata: { reason },
  });
  const existing = await prisma.companyTask.findFirst({
    where: { companyId, relatedType: "ConversationSchedulingState", relatedId: stateId, status: "OPEN" },
  });
  if (!existing) {
    await prisma.companyTask.create({
      data: {
        companyId,
        title: "Scheduling needs office review",
        details: reason.replaceAll("_", " "),
        relatedType: "ConversationSchedulingState",
        relatedId: stateId,
        status: "OPEN",
      },
    });
  }
}

export async function setConversationAutoBooking(input: {
  db?: PrismaClient;
  companyId: string;
  threadId: string;
  paused: boolean;
  actorId?: string | null;
}) {
  const db = input.db ?? prisma;
  const state = await db.conversationSchedulingState.findFirst({
    where: { companyId: input.companyId, threadId: input.threadId },
    orderBy: { updatedAt: "desc" },
  });
  if (!state) {
    await db.conversationSchedulingState.create({
      data: {
        companyId: input.companyId,
        threadId: input.threadId,
        paused: input.paused,
        status: input.paused ? "PAUSED" : "OPEN",
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
  } else {
    await db.conversationSchedulingState.update({
      where: { id: state.id },
      data: { paused: input.paused, status: input.paused ? "PAUSED" : "OPEN" },
    });
  }
  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: input.paused ? "scheduling.auto_booking_paused" : "scheduling.auto_booking_resumed",
    entityType: "CommunicationThread",
    entityId: input.threadId,
  });
}
