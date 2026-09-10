import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  DO_NOT_CLAIM_BOOKED,
  DO_NOT_DUPLICATE_CONFIRMATION,
  HAND_OFF_TO_OFFICE,
  agentInstructionForReadiness,
  blockedBookingPayload,
  evaluateBookingReadiness,
  logHybridAction,
  mergeSchedulingIntake,
  normalizeAgentToolBody,
  parseToolPersonName,
  parseToolServiceAddress,
  selectedSlotFromState,
  toolAddressSchema,
} from "@/lib/agent-tools/booking-contract";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import {
  loadActiveSchedulingState,
  markSchedulingBooked,
  persistSelectedSlot,
  resolveActionThread,
} from "@/lib/agent-tools/persist-offers";
import { sendActionResultSms } from "@/lib/agent-tools/send-result";
import { signSlotToken, verifySlotToken } from "@/lib/agent-tools/slot-token";
import {
  customerPayload,
  hhmm,
  resolveServiceType,
  resolveToolCustomer,
  validateHighLevelLocation,
} from "@/lib/agent-tools/context";
import { mapContactToCustomer } from "@/lib/highlevel/contacts";
import { bookAppointment, findNextAvailableOptions, getAvailability } from "@/lib/scheduling";
import {
  createCustomerForConversation,
  createPropertyForConversation,
  formatPropertyDisplay,
  jobDescriptionFromConcern,
  loadSchedulingCustomerContext,
  matchPropertyFromText,
  parseIntake,
} from "@/lib/scheduling/conversation-identity";
import { uniqueWindowOffers, parseOfferedSlots } from "@/lib/scheduling/conversation-turn";
import { findOpenMaintenanceVisit } from "@/lib/scheduling/maintenance";
import {
  askAddressMessage,
  askNameBeforeFinishingSchedule,
  askWhichPropertyMessage,
  contractorYouBookingConfirmation,
} from "@/lib/scheduling/templates";
import { companyTodayKey, formatLocalDateShort, formatWindowChip, zonedLocalDateTime } from "@/lib/scheduling/time";
import { propertyChoiceLabel } from "@/lib/scheduling/conversation-identity";

export const bookAppointmentSchema = z.object({
  location_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  conversation_id: z.string().optional().nullable(),
  slot_token: z.string().min(8).optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  customer_first_name: z.string().optional().nullable(),
  customer_last_name: z.string().optional().nullable(),
  customer_reply: z.string().optional().nullable(),
  service_type: z.string().optional().nullable(),
  service_need: z.string().optional().nullable(),
  property_id: z.string().optional().nullable(),
  service_address: toolAddressSchema.optional().nullable(),
  idempotency_key: z.string().optional().nullable(),
  send_to_customer: z.boolean().optional(),
});

function slotDisplay(dateKey: string, startMinutes: number, endMinutes: number, timeZone: string) {
  const date = zonedLocalDateTime(timeZone, dateKey, 12 * 60);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(date);
  return `${day} from ${formatWindowChip(startMinutes, endMinutes)}`;
}

function shortSlotDisplay(dateKey: string, startMinutes: number, endMinutes: number, timeZone: string) {
  return `${formatLocalDateShort(dateKey, timeZone)} from ${formatWindowChip(startMinutes, endMinutes)}`;
}

export async function bookAppointmentTool(input: {
  companyId: string;
  body: unknown;
  idempotencyKey?: string | null;
}) {
  const parsed = bookAppointmentSchema.safeParse(normalizeAgentToolBody(input.body));
  if (!parsed.success) {
    return {
      status: 400,
      body: toolError(
        "book_appointment",
        "INVALID_REQUEST",
        "The booking request was missing required fields.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ selectedSlot: null }),
          customer_message: "",
          error_code: "INVALID_REQUEST",
        }),
        { instruction: DO_NOT_CLAIM_BOOKED }
      ),
    };
  }
  const body = parsed.data;
  const location = await validateHighLevelLocation(input.companyId, body.location_id);
  if (!location.ok) {
    return { status: 403, body: toolError("book_appointment", location.code, location.message) };
  }

  const company = await prisma.company.findFirst({
    where: { id: input.companyId },
    select: { timezone: true },
  });
  const timeZone = company?.timezone || "America/New_York";
  const resolvedThread = await resolveActionThread({
    companyId: input.companyId,
    conversationId: body.conversation_id,
    phone: body.customer_phone,
    contactId: body.contact_id,
  });
  if (resolvedThread.status === "ambiguous") {
    const blocked = blockedBookingPayload({
      readiness: evaluateBookingReadiness({ requiresOffice: true, selectedSlot: null }),
      customer_message: "I’ve asked the office to finish scheduling this. Someone from our team will text you back shortly.",
      error_code: "CONVERSATION_AMBIGUOUS",
    });
    return {
      status: 200,
      body: toolOk("book_appointment", { ...blocked, agent_instruction: HAND_OFF_TO_OFFICE }, { instruction: HAND_OFF_TO_OFFICE }),
    };
  }
  const thread = resolvedThread.status === "resolved" ? resolvedThread.thread : null;
  const state = thread ? await loadActiveSchedulingState(input.companyId, thread.id) : null;
  const offered = parseOfferedSlots(state?.offeredSlots);
  const persistedSlot = selectedSlotFromState({
    requestedDate: state?.requestedDate,
    requestedWindowId: state?.requestedWindowId,
    offeredSlots: offered,
  });
  const tokenSlot = body.slot_token ? verifySlotToken(body.slot_token, input.companyId) : null;
  if (body.slot_token && !tokenSlot && !persistedSlot) {
    return {
      status: 422,
      body: toolError(
        "book_appointment",
        "SLOT_TOKEN_INVALID",
        "That appointment choice is no longer valid. Check availability again.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ selectedSlot: null, offeredCount: offered.length }),
          customer_message: "That appointment choice is no longer valid. Let me check the next openings.",
          error_code: "SLOT_TOKEN_INVALID",
        }),
        { instruction: DO_NOT_CLAIM_BOOKED }
      ),
    };
  }
  const slot = tokenSlot
    ? { date: tokenSlot.date, windowId: tokenSlot.windowId, startMinutes: persistedSlot?.startMinutes ?? 9 * 60, endMinutes: persistedSlot?.endMinutes ?? 11 * 60 }
    : persistedSlot;
  if (!slot) {
    return {
      status: 422,
      body: toolError(
        "book_appointment",
        "SLOT_NOT_SELECTED",
        "No stored appointment slot is selected yet.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ selectedSlot: null, offeredCount: offered.length }),
          customer_message: "Which of those openings works best?",
          error_code: "SLOT_NOT_SELECTED",
        }),
        { instruction: DO_NOT_CLAIM_BOOKED }
      ),
    };
  }

  if (state?.expiresAt && state.expiresAt.getTime() < Date.now() && state.status !== "BOOKED") {
    return {
      status: 409,
      body: toolError(
        "book_appointment",
        "SLOT_EXPIRED",
        "That selected appointment expired before booking could finish.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ selectedSlot: null, offeredCount: 0 }),
          customer_message: "That opening expired. Let me check the next available times.",
          error_code: "SLOT_EXPIRED",
        }),
        { instruction: "The selected slot expired. Check availability again. Do not tell the customer they are booked." }
      ),
    };
  }

  const inboundName = parseToolPersonName(body);
  const inboundAddress = parseToolServiceAddress(body.service_address) || parseToolServiceAddress(body.customer_reply);
  const intake = mergeSchedulingIntake(parseIntake(state?.intake), {
    ...(inboundName ? { firstName: inboundName.firstName, lastName: inboundName.lastName } : {}),
    ...(inboundAddress ?? {}),
  });

  const service = await resolveServiceType({
    companyId: input.companyId,
    serviceType: body.service_type,
    serviceNeed: body.service_need || state?.customerConcern,
  });
  if (!service.ok) {
    return {
      status: 422,
      body: toolError(
        "book_appointment",
        service.code,
        "Choose the service type before booking.",
        {
          ...blockedBookingPayload({
            readiness: evaluateBookingReadiness({ selectedSlot: slot, intake, hasServiceContext: false }),
            customer_message: "Is this a service call or a maintenance visit?",
            error_code: service.code,
            slot_selected: true,
          }),
          requires_clarification: true,
          clarification: { field: "service_type", options: service.options },
        },
        { instruction: DO_NOT_CLAIM_BOOKED }
      ),
    };
  }

  const resolved = await resolveToolCustomer({
    companyId: input.companyId,
    contactId: body.contact_id,
    conversationId: body.conversation_id,
    phone: body.customer_phone || thread?.phone,
  });
  let customerId = resolved.identity.customerId;
  let context = resolved.context;
  let createdPropertyId: string | null = null;

  if (thread) {
    await persistSelectedSlot({
      companyId: input.companyId,
      threadId: thread.id,
      stateId: state?.id,
      date: slot.date,
      windowId: slot.windowId,
      customerId,
      propertyId: context?.properties.length === 1 ? context.properties[0]!.id : state?.propertyId,
      serviceTypeId: service.serviceType.id,
      intake,
      missingField: evaluateBookingReadiness({
        customerId,
        customerFirstName: context?.firstName,
        propertyId: context?.properties.length === 1 ? context.properties[0]!.id : null,
        propertyCount: context?.properties.length ?? 0,
        intake,
        selectedSlot: slot,
        hasServiceContext: true,
      }).missingField,
      phase: "BOOKING",
      offeredSlots: offered,
      customerConcern: body.service_need || state?.customerConcern,
    });
  }

  if (!customerId) {
    const name = inboundName;
    if (!name) {
      const readiness = evaluateBookingReadiness({
        intake,
        selectedSlot: slot,
        hasServiceContext: true,
        offeredCount: offered.length,
      });
      const message = askNameBeforeFinishingSchedule();
      const sms = await sendActionResultSms({
        companyId: input.companyId,
        phone: body.customer_phone || thread?.phone,
        customerId: null,
        body: message,
        send: true,
      });
      logHybridAction({
        action: "MISSING_INFO",
        companyId: input.companyId,
        threadResolved: Boolean(thread),
        requiresCustomerName: true,
        readyToBook: false,
        bookingConfirmed: false,
        smsSent: sms.sent,
        smsSkipReason: sms.skipReason,
        errorCode: "CUSTOMER_NAME_REQUIRED",
        phase: "SLOT_SELECTED",
      });
      return {
        status: 200,
        body: toolOk(
          "book_appointment",
          {
            ...blockedBookingPayload({
              readiness,
              customer_message: message,
              error_code: "CUSTOMER_NAME_REQUIRED",
              slot_selected: true,
              appointment_display: shortSlotDisplay(slot.date, slot.startMinutes, slot.endMinutes, timeZone),
            }),
            required_fields: ["customer_name", "service_address"],
            agent_instruction: agentInstructionForReadiness(readiness, false),
          },
          { instruction: agentInstructionForReadiness(readiness, false) }
        ),
      };
    }
    if (!intake.street) {
      const readiness = evaluateBookingReadiness({
        intake: { ...intake, firstName: name.firstName, lastName: name.lastName },
        selectedSlot: slot,
        hasServiceContext: true,
        offeredCount: offered.length,
      });
      const message = askAddressMessage();
      await sendActionResultSms({
        companyId: input.companyId,
        phone: body.customer_phone || thread?.phone,
        customerId: null,
        body: message,
        send: true,
      });
      return {
        status: 200,
        body: toolOk(
          "book_appointment",
          {
            ...blockedBookingPayload({
              readiness,
              customer_message: message,
              error_code: "SERVICE_ADDRESS_REQUIRED",
              slot_selected: true,
              appointment_display: shortSlotDisplay(slot.date, slot.startMinutes, slot.endMinutes, timeZone),
            }),
            required_fields: ["service_address"],
            agent_instruction: agentInstructionForReadiness(readiness, false),
          },
          { instruction: agentInstructionForReadiness(readiness, false) }
        ),
      };
    }
    customerId = await createCustomerForConversation(prisma, {
      companyId: input.companyId,
      firstName: name.firstName,
      lastName: name.lastName,
      phone: body.customer_phone || thread?.phone,
      threadId: thread?.id,
      contactId: body.contact_id,
      leadId: resolved.identity.leadId,
      source: "SMS",
    });
    const propertyId = await createPropertyForConversation(prisma, {
      companyId: input.companyId,
      customerId,
      street: intake.street,
      city: intake.city || "",
      state: intake.state || "",
      zip: intake.zip || "",
    });
    if (body.contact_id) {
      await mapContactToCustomer(prisma, {
        companyId: input.companyId,
        customerId,
        contactId: body.contact_id,
      });
    }
    context = await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId });
    createdPropertyId = propertyId;
  }

  context = context ?? (customerId ? await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId }) : null);
  const customer = customerPayload(context);
  let propertyId = body.property_id || customer.property_id || createdPropertyId || state?.propertyId || null;
  if (propertyId && context && !context.properties.some((row) => row.id === propertyId)) {
    propertyId = null;
  }
  if (!propertyId && context && intake.street) {
    const matched = matchPropertyFromText(intake.street, context.properties);
    if (matched.length === 1) propertyId = matched[0]!.id;
  }
  if (!propertyId && customer.property_status === "multiple") {
    const labels = (context?.properties ?? []).map((row, index) => propertyChoiceLabel(row, index));
    const message = askWhichPropertyMessage(labels);
    await sendActionResultSms({
      companyId: input.companyId,
      phone: body.customer_phone || thread?.phone,
      customerId,
      body: message,
      send: true,
    });
    return {
      status: 200,
      customerId,
      body: toolOk(
        "book_appointment",
        {
          ...blockedBookingPayload({
            readiness: evaluateBookingReadiness({
              customerId,
              customerFirstName: customer.first_name,
              propertyCount: customer.property_count,
              intake,
              selectedSlot: slot,
              hasServiceContext: true,
            }),
            customer_message: message,
            error_code: "PROPERTY_SELECTION_REQUIRED",
            slot_selected: true,
          }),
          properties: customer.properties,
          required_fields: ["property_id"],
          agent_instruction: agentInstructionForReadiness(
            evaluateBookingReadiness({
              customerId,
              propertyCount: customer.property_count,
              selectedSlot: slot,
              hasServiceContext: true,
            }),
            false
          ),
        },
        { instruction: DO_NOT_CLAIM_BOOKED }
      ),
    };
  }
  if (!propertyId && customerId) {
    if (!intake.street) {
      const message = askAddressMessage();
      await sendActionResultSms({
        companyId: input.companyId,
        phone: body.customer_phone || thread?.phone,
        customerId,
        body: message,
        send: true,
      });
      return {
        status: 422,
        customerId,
        body: toolError(
          "book_appointment",
          "SERVICE_ADDRESS_REQUIRED",
          "A service address is required before booking.",
          {
            ...blockedBookingPayload({
              readiness: evaluateBookingReadiness({
                customerId,
                customerFirstName: customer.first_name,
                intake,
                selectedSlot: slot,
                hasServiceContext: true,
              }),
              customer_message: message,
              error_code: "SERVICE_ADDRESS_REQUIRED",
              slot_selected: true,
            }),
            required_fields: ["service_address"],
            agent_instruction: DO_NOT_CLAIM_BOOKED,
          },
          { instruction: DO_NOT_CLAIM_BOOKED }
        ),
      };
    }
    propertyId = await createPropertyForConversation(prisma, {
      companyId: input.companyId,
      customerId,
      street: intake.street,
      city: intake.city || "",
      state: intake.state || "",
      zip: intake.zip || "",
    });
    context = await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId });
  }
  if (!customerId || !propertyId) {
    return {
      status: 422,
      body: toolError(
        "book_appointment",
        "SERVICE_ADDRESS_REQUIRED",
        "A customer and service address are required before booking.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ selectedSlot: slot, intake }),
          customer_message: askAddressMessage(),
          error_code: "SERVICE_ADDRESS_REQUIRED",
          slot_selected: true,
        }),
        { instruction: DO_NOT_CLAIM_BOOKED }
      ),
    };
  }

  let maintenanceVisitId: string | null = null;
  if (service.maintenance) {
    const visit = await findOpenMaintenanceVisit(input.companyId, customerId);
    if (visit?.status === "SCHEDULED" && visit.jobId) {
      return {
        status: 409,
        customerId,
        propertyId,
        serviceTypeId: service.serviceType.id,
        body: toolError("book_appointment", "DUPLICATE_MAINTENANCE", "This customer already has a maintenance visit scheduled.", {
          ...blockedBookingPayload({
            readiness: evaluateBookingReadiness({ customerId, propertyId, selectedSlot: slot, hasServiceContext: true }),
            customer_message: "You already have a maintenance visit scheduled.",
            error_code: "DUPLICATE_MAINTENANCE",
            slot_selected: true,
          }),
          existing_job_id: visit.jobId,
          scheduled_date: visit.scheduledDate,
        }),
      };
    }
    maintenanceVisitId = visit?.id ?? null;
  }

  const recheck = await getAvailability({
    companyId: input.companyId,
    date: slot.date,
    appointmentWindowId: slot.windowId,
    serviceTypeId: service.serviceType.id,
    maintenance: service.maintenance,
  });
  const stillOpen = recheck.options.find((option) => option.windowId === slot.windowId && option.remainingCapacity > 0);
  if (!stillOpen) {
    const alternatives = uniqueWindowOffers(
      await findNextAvailableOptions({
        companyId: input.companyId,
        startDate: companyTodayKey(new Date(), timeZone),
        days: 14,
        serviceTypeId: service.serviceType.id,
        maintenance: service.maintenance,
      }),
      4
    ).map((row) => ({
      slot_token: signSlotToken({
        companyId: input.companyId,
        date: row.date,
        windowId: row.windowId,
        serviceTypeId: service.serviceType.id,
      }),
      date: row.date,
      window_start: hhmm(row.startMinutes),
      window_end: hhmm(row.endMinutes),
      display: slotDisplay(row.date, row.startMinutes, row.endMinutes, timeZone),
    }));
    return {
      status: 409,
      customerId,
      propertyId,
      serviceTypeId: service.serviceType.id,
      body: toolError(
        "book_appointment",
        "SLOT_NO_LONGER_AVAILABLE",
        "That window is no longer available.",
        {
          ...blockedBookingPayload({
            readiness: evaluateBookingReadiness({
              customerId,
              customerFirstName: customer.first_name,
              propertyId,
              selectedSlot: null,
              offeredCount: alternatives.length,
              hasServiceContext: true,
            }),
            customer_message: "Sorry, that one was just taken. Let me grab the next available options for you.",
            error_code: "SLOT_NO_LONGER_AVAILABLE",
            slot_selected: false,
          }),
          available_slots: alternatives,
          agent_instruction: "That window was just taken. Offer only the newly returned available_slots. Do not invent another time. Do not tell the customer they are booked.",
        },
        {
          instruction:
            "That window was just taken. Offer only the newly returned available_slots. Do not invent another time. Do not tell the customer they are booked.",
        }
      ),
    };
  }

  const idempotencyKey =
    input.idempotencyKey ||
    body.idempotency_key ||
    `agent:${input.companyId}:${thread?.id || body.conversation_id || body.contact_id || body.customer_phone || "anon"}:${slot.date}:${slot.windowId}`;

  let booked;
  try {
    booked = await bookAppointment({
      companyId: input.companyId,
      customerId,
      propertyId,
      serviceTypeId: service.serviceType.id,
      date: slot.date,
      windowId: slot.windowId,
      source: service.maintenance ? "MAINTENANCE" : "CONVERSATION",
      threadId: thread?.id,
      idempotencyKey,
      maintenanceVisitId,
      description: jobDescriptionFromConcern(body.service_need || state?.customerConcern || null),
      sendConfirmation: false,
      maintenance: service.maintenance,
    });
  } catch {
    return {
      status: 500,
      customerId,
      propertyId,
      serviceTypeId: service.serviceType.id,
      body: toolError(
        "book_appointment",
        "BOOKING_TRANSACTION_FAILED",
        "The booking transaction did not complete.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ customerId, propertyId, selectedSlot: slot, hasServiceContext: true }),
          customer_message: "I wasn’t able to finish that booking. I’ll have the office take it from here.",
          error_code: "BOOKING_TRANSACTION_FAILED",
          slot_selected: true,
        }),
        { instruction: HAND_OFF_TO_OFFICE }
      ),
    };
  }

  if (!booked.ok) {
    if (booked.code === "DUPLICATE_MAINTENANCE") {
      return {
        status: 409,
        customerId,
        propertyId,
        serviceTypeId: service.serviceType.id,
        body: toolError("book_appointment", "DUPLICATE_MAINTENANCE", booked.error),
      };
    }
    return {
      status: 409,
      customerId,
      propertyId,
      serviceTypeId: service.serviceType.id,
      body: toolError(
        "book_appointment",
        booked.code,
        booked.error,
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ customerId, propertyId, selectedSlot: slot, hasServiceContext: true }),
          customer_message: booked.error,
          error_code: booked.code,
          slot_selected: true,
        }),
        { instruction: DO_NOT_CLAIM_BOOKED }
      ),
    };
  }

  const job = await prisma.job.findFirst({
    where: { id: booked.jobId, companyId: input.companyId },
    select: {
      id: true,
      jobNumber: true,
      scheduledStart: true,
      schedulingBooking: { select: { id: true } },
      assignments: { select: { id: true } },
      property: { select: { id: true, address: true, city: true, state: true, zip: true } },
    },
  });
  const bookingId = job?.schedulingBooking?.id ?? null;
  const dispatchReady = Boolean(job?.scheduledStart && (job.assignments?.length ?? 0) > 0);
  if (!job || !bookingId || !dispatchReady) {
    return {
      status: 500,
      customerId,
      propertyId,
      serviceTypeId: service.serviceType.id,
      jobId: job?.id,
      bookingId,
      body: toolError(
        "book_appointment",
        job && bookingId ? "DISPATCH_VERIFY_FAILED" : "BOOKING_VERIFY_FAILED",
        "The booking could not be verified in ContractorYou.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({
            customerId,
            propertyId,
            selectedSlot: slot,
            hasServiceContext: true,
            requiresOffice: true,
          }),
          customer_message: "I wasn’t able to finish that booking. I’ll have the office take it from here.",
          error_code: job && bookingId ? "DISPATCH_VERIFY_FAILED" : "BOOKING_VERIFY_FAILED",
          slot_selected: true,
        }),
        { instruction: HAND_OFF_TO_OFFICE }
      ),
    };
  }

  const refreshed = await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId });
  const propertyAddress = job.property
    ? formatPropertyDisplay(job.property)
    : formatPropertyDisplay(intake) || null;
  const appointmentDisplay = shortSlotDisplay(booked.date, stillOpen.startMinutes, stillOpen.endMinutes, timeZone);
  const customerMessage = contractorYouBookingConfirmation({
    appointmentDisplay,
    propertyAddress,
  });

  if (thread) {
    await markSchedulingBooked({
      companyId: input.companyId,
      threadId: thread.id,
      jobId: job.id,
      customerId,
      propertyId,
    });
  }

  const alreadySent =
    booked.duplicate &&
    (
      await prisma.schedulingBooking.findFirst({
        where: { jobId: job.id, companyId: input.companyId },
        select: { confirmationStatus: true },
      })
    )?.confirmationStatus === "SENT";
  const confirmSms = alreadySent
    ? { sent: false as const, skipReason: "duplicate_confirmation" }
    : await sendActionResultSms({
        companyId: input.companyId,
        phone: body.customer_phone || thread?.phone || refreshed?.phone,
        customerId,
        body: customerMessage,
        send: true,
      });
  if (confirmSms.sent) {
    await prisma.schedulingBooking.updateMany({
      where: { jobId: job.id, companyId: input.companyId },
      data: { confirmationStatus: "SENT" },
    });
  }
  logHybridAction({
    action: "BOOK",
    companyId: input.companyId,
    threadResolved: Boolean(thread),
    slotDate: booked.date,
    bookingConfirmed: true,
    readyToBook: false,
    smsSent: confirmSms.sent,
    smsSkipReason: confirmSms.sent ? null : confirmSms.skipReason,
    phase: "BOOKED",
  });

  return {
    status: 200,
    customerId,
    propertyId,
    serviceTypeId: service.serviceType.id,
    jobId: job.id,
    bookingId,
    body: toolOk(
      "book_appointment",
      {
        booking_confirmed: true,
        booking_id: bookingId,
        job_id: job.id,
        job_number: job.jobNumber ?? null,
        appointment_display: appointmentDisplay,
        appointment_date: booked.date,
        appointment_window_start: hhmm(stillOpen.startMinutes),
        appointment_window_end: hhmm(stillOpen.endMinutes),
        customer_id: customerId,
        customer_first_name: refreshed?.firstName ?? null,
        property_id: propertyId,
        property_address: propertyAddress,
        requires_customer_name: false,
        requires_service_address: false,
        requires_property_selection: false,
        requires_office: false,
        ready_to_book: false,
        slot_selected: true,
        customer_message: customerMessage,
        error_code: null,
        scheduling_phase: "BOOKED",
        agent_instruction: DO_NOT_DUPLICATE_CONFIRMATION,
        booking: {
          booking_id: bookingId,
          job_id: job.id,
          job_number: job.jobNumber ?? null,
          status: booked.duplicate ? "confirmed_duplicate" : "confirmed",
          date: booked.date,
          window_start: hhmm(stillOpen.startMinutes),
          window_end: hhmm(stillOpen.endMinutes),
          display: appointmentDisplay,
          technician_id: booked.technicianId,
          booking_confirmed: true,
        },
        customer: {
          customer_id: customerId,
          first_name: refreshed?.firstName ?? null,
        },
        property: {
          property_id: propertyId,
          display_address: propertyAddress,
        },
      },
      { instruction: DO_NOT_DUPLICATE_CONFIRMATION }
    ),
  };
}
