import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ASK_NAME_THEN_BOOK,
  DO_NOT_CLAIM_BOOKED,
  HAND_OFF_TO_OFFICE,
  TRIGGER_BOOK_SELECTED_SLOT,
  agentInstructionForReadiness,
  blockedBookingPayload,
  evaluateBookingReadiness,
  mergeSchedulingIntake,
  parseToolPersonName,
  parseToolServiceAddress,
  selectedSlotFromState,
  toolAddressSchema,
} from "@/lib/agent-tools/booking-contract";
import { customerPayload, resolveToolCustomer, validateHighLevelLocation } from "@/lib/agent-tools/context";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import {
  loadActiveSchedulingState,
  persistOfferedSlots,
  persistSelectedSlot,
  resolveActionThread,
} from "@/lib/agent-tools/persist-offers";
import { sendActionResultSms } from "@/lib/agent-tools/send-result";
import { signSlotToken } from "@/lib/agent-tools/slot-token";
import { bookAppointmentTool } from "@/lib/agent-tools/book-appointment";
import { parseIntake } from "@/lib/scheduling/conversation-identity";
import { parseOfferedSlots, resolveOfferedSlotSelection } from "@/lib/scheduling/conversation-turn";
import {
  askAddressMessage,
  askNameBeforeFinishingSchedule,
  askWhichPropertyMessage,
  clarifyOfferedSlotsMessage,
  unmatchedOfferedSlotMessage,
} from "@/lib/scheduling/templates";
import { formatLocalDateShort, formatWindowChip } from "@/lib/scheduling/time";
import { propertyChoiceLabel } from "@/lib/scheduling/conversation-identity";

export const selectOfferedSlotSchema = z.object({
  location_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  conversation_id: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  customer_first_name: z.string().optional().nullable(),
  customer_last_name: z.string().optional().nullable(),
  customer_reply: z.string().min(1),
  service_type: z.string().optional().nullable(),
  service_need: z.string().optional().nullable(),
  service_address: toolAddressSchema.optional().nullable(),
  send_to_customer: z.boolean().optional(),
});

function slotRef(slot: { date: string; windowId: string }) {
  return createHash("sha256").update(`${slot.date}:${slot.windowId}`).digest("hex").slice(0, 12);
}

function displaySlot(date: string, startMinutes: number, endMinutes: number, timeZone: string) {
  return `${formatLocalDateShort(date, timeZone)} from ${formatWindowChip(startMinutes, endMinutes)}`;
}

function missingMessage(readiness: ReturnType<typeof evaluateBookingReadiness>, properties: Array<{ address: string; isPrimary: boolean }>) {
  if (readiness.requires_customer_name) return askNameBeforeFinishingSchedule();
  if (readiness.requires_property_selection) {
    return askWhichPropertyMessage(properties.map((row, index) => propertyChoiceLabel({ ...row, city: "", state: "", zip: "", id: String(index) }, index)));
  }
  if (readiness.requires_service_address) return askAddressMessage();
  if (readiness.requires_office) return "I’ve asked the office to finish scheduling this. Someone from our team will text you back shortly.";
  return null;
}

export async function selectOfferedSlotTool(input: { companyId: string; body: unknown }) {
  const parsed = selectOfferedSlotSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      status: 400,
      body: toolError("select_offered_slot", "INVALID_REQUEST", "customer_reply is required."),
    };
  }
  const body = parsed.data;
  const location = await validateHighLevelLocation(input.companyId, body.location_id);
  if (!location.ok) {
    return { status: 403, body: toolError("select_offered_slot", location.code, location.message) };
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
    return {
      status: 422,
      body: toolError(
        "select_offered_slot",
        "CONVERSATION_AMBIGUOUS",
        "More than one active ContractorYou conversation matched that phone. The office needs to finish this.",
        blockedBookingPayload({
          readiness: evaluateBookingReadiness({ requiresOffice: true, selectedSlot: null }),
          customer_message: "I’ve asked the office to finish scheduling this. Someone from our team will text you back shortly.",
          error_code: "CONVERSATION_AMBIGUOUS",
        }),
        { instruction: HAND_OFF_TO_OFFICE }
      ),
    };
  }
  if (resolvedThread.status === "not_found") {
    return {
      status: 422,
      body: toolError("select_offered_slot", "CONVERSATION_NOT_FOUND", "No ContractorYou conversation was found for that request."),
    };
  }
  const thread = resolvedThread.thread;
  const state = await loadActiveSchedulingState(input.companyId, thread.id);
  if (state?.status === "BOOKED" && state.bookedJobId) {
    const job = await prisma.job.findFirst({
      where: { id: state.bookedJobId, companyId: input.companyId },
      select: { id: true, jobNumber: true, schedulingBooking: { select: { id: true } } },
    });
    if (job?.schedulingBooking) {
      return {
        status: 200,
        customerId: state.customerId,
        propertyId: state.propertyId,
        jobId: job.id,
        bookingId: job.schedulingBooking.id,
        body: toolOk(
          "select_offered_slot",
          {
            booking_confirmed: true,
            booking_id: job.schedulingBooking.id,
            job_id: job.id,
            job_number: job.jobNumber,
            slot_selected: true,
            ready_to_book: false,
            match_status: "already_booked",
            customer_message: null,
            agent_instruction: "This conversation already has a booked appointment. Do not send a duplicate confirmation.",
          },
          { instruction: "This conversation already has a booked appointment. Do not send a duplicate confirmation." }
        ),
      };
    }
  }

  const offered = parseOfferedSlots(state?.offeredSlots);
  const selection = resolveOfferedSlotSelection(body.customer_reply, offered);
  const inboundName = parseToolPersonName(body);
  const inboundAddress = parseToolServiceAddress(body.service_address) || parseToolServiceAddress(body.customer_reply);
  const existingIntake = mergeSchedulingIntake(parseIntake(state?.intake), {
    ...(inboundName ? { firstName: inboundName.firstName, lastName: inboundName.lastName } : {}),
    ...(inboundAddress ?? {}),
  });

  console.info(
    "[action-bridge]",
    JSON.stringify({
      companyId: input.companyId,
      conversationId: body.conversation_id ?? thread.id,
      inboundSelection: body.customer_reply.slice(0, 80),
      offeredSlotCount: offered.length,
      matchStatus: selection.kind,
      slotRef: selection.kind === "match" ? slotRef(selection.slot) : null,
    })
  );

  const resolved = await resolveToolCustomer({
    companyId: input.companyId,
    contactId: body.contact_id,
    conversationId: body.conversation_id,
    phone: body.customer_phone || thread.phone,
  });
  const customer = customerPayload(resolved.context);
  const priorSelected = selectedSlotFromState({
    requestedDate: state?.requestedDate,
    requestedWindowId: state?.requestedWindowId,
    offeredSlots: offered,
  });

  if (selection.kind === "match") {
    const display = displaySlot(selection.slot.date, selection.slot.startMinutes, selection.slot.endMinutes, timeZone);
    const token = signSlotToken({
      companyId: input.companyId,
      date: selection.slot.date,
      windowId: selection.slot.windowId,
      serviceTypeId: state?.serviceTypeId ?? null,
    });
    const readiness = evaluateBookingReadiness({
      customerId: customer.customer_id,
      customerFirstName: customer.first_name,
      propertyId: customer.property_id,
      propertyAddress: customer.properties[0]?.display_address,
      propertyCount: customer.property_count,
      intake: existingIntake,
      hasServiceContext: Boolean(state?.serviceTypeId || state?.customerConcern || body.service_need),
      offeredCount: offered.length,
      selectedSlot: { date: selection.slot.date, windowId: selection.slot.windowId },
    });
    await persistSelectedSlot({
      companyId: input.companyId,
      threadId: thread.id,
      stateId: state?.id,
      date: selection.slot.date,
      windowId: selection.slot.windowId,
      customerId: customer.customer_id,
      propertyId: customer.property_id,
      serviceTypeId: state?.serviceTypeId,
      intake: existingIntake,
      missingField: readiness.missingField,
      phase: readiness.phase,
      offeredSlots: offered,
      customerConcern: state?.customerConcern ?? body.service_need,
    });
    const message = missingMessage(readiness, resolved.context?.properties ?? []);
    if (message && body.send_to_customer) {
      await sendActionResultSms({
        companyId: input.companyId,
        phone: body.customer_phone || thread.phone,
        customerId: customer.customer_id,
        body: message,
        send: true,
      });
    }
    const instruction = readiness.ready_to_book
      ? TRIGGER_BOOK_SELECTED_SLOT
      : agentInstructionForReadiness(readiness, false);
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId: customer.property_id,
      serviceTypeId: state?.serviceTypeId,
      body: toolOk(
        "select_offered_slot",
        {
          ...blockedBookingPayload({
            readiness,
            customer_message: message || "",
            error_code: readiness.requires_customer_name
              ? "CUSTOMER_NAME_REQUIRED"
              : readiness.requires_service_address
                ? "SERVICE_ADDRESS_REQUIRED"
                : readiness.requires_property_selection
                  ? "PROPERTY_SELECTION_REQUIRED"
                  : null,
            slot_selected: true,
            match_status: "exact",
            appointment_display: display,
            slot_token: token,
          }),
          match_status: "exact",
          slot_token: token,
          display,
          date: selection.slot.date,
          window_id: selection.slot.windowId,
          available_slots: [{ slot_token: token, display, date: selection.slot.date }],
          agent_instruction: instruction,
        },
        { instruction }
      ),
    };
  }

  if (priorSelected && (inboundName || inboundAddress)) {
    await persistSelectedSlot({
      companyId: input.companyId,
      threadId: thread.id,
      stateId: state?.id,
      date: priorSelected.date,
      windowId: priorSelected.windowId,
      customerId: customer.customer_id,
      propertyId: customer.property_id,
      serviceTypeId: state?.serviceTypeId,
      intake: existingIntake,
      missingField: evaluateBookingReadiness({
        customerId: customer.customer_id,
        customerFirstName: customer.first_name,
        propertyId: customer.property_id,
        propertyCount: customer.property_count,
        intake: existingIntake,
        selectedSlot: priorSelected,
        hasServiceContext: true,
      }).missingField,
      phase: "SLOT_SELECTED",
      offeredSlots: offered,
      customerConcern: state?.customerConcern ?? body.service_need,
    });
    const readiness = evaluateBookingReadiness({
      customerId: customer.customer_id,
      customerFirstName: customer.first_name,
      propertyId: customer.property_id,
      propertyAddress: customer.properties[0]?.display_address,
      propertyCount: customer.property_count,
      intake: existingIntake,
      hasServiceContext: true,
      offeredCount: offered.length,
      selectedSlot: priorSelected,
    });
    if (readiness.ready_to_book || (inboundName && existingIntake.street)) {
      return bookAppointmentTool({
        companyId: input.companyId,
        body: {
          ...body,
          slot_token: undefined,
          customer_name: inboundName ? `${inboundName.firstName} ${inboundName.lastName}`.trim() : body.customer_name,
          service_address: existingIntake.street,
          send_to_customer: body.send_to_customer,
        },
      });
    }
    const message = missingMessage(readiness, resolved.context?.properties ?? []) || askNameBeforeFinishingSchedule();
    if (body.send_to_customer) {
      await sendActionResultSms({
        companyId: input.companyId,
        phone: body.customer_phone || thread.phone,
        customerId: customer.customer_id,
        body: message,
        send: true,
      });
    }
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId: customer.property_id,
      body: toolOk(
        "select_offered_slot",
        {
          ...blockedBookingPayload({
            readiness,
            customer_message: message,
            error_code: readiness.requires_customer_name ? "CUSTOMER_NAME_REQUIRED" : readiness.requires_service_address ? "SERVICE_ADDRESS_REQUIRED" : null,
            slot_selected: true,
            match_status: "exact",
            appointment_display: displaySlot(priorSelected.date, priorSelected.startMinutes, priorSelected.endMinutes, timeZone),
          }),
          agent_instruction: ASK_NAME_THEN_BOOK,
        },
        { instruction: ASK_NAME_THEN_BOOK }
      ),
    };
  }

  if (selection.kind === "ambiguous") {
    const choices = selection.candidates.map((slot) => ({
      display: displaySlot(slot.date, slot.startMinutes, slot.endMinutes, timeZone),
      date: slot.date,
      window_id: slot.windowId,
    }));
    const message = clarifyOfferedSlotsMessage({
      slots: selection.candidates.map((slot) => ({
        dateKey: slot.date,
        startMinutes: slot.startMinutes,
        endMinutes: slot.endMinutes,
        timeZone,
      })),
    });
    await persistOfferedSlots({
      companyId: input.companyId,
      threadId: thread.id,
      customerId: customer.customer_id,
      propertyId: customer.property_id,
      serviceTypeId: state?.serviceTypeId,
      slots: offered,
      intake: existingIntake,
      phase: "SLOTS_OFFERED",
    });
    await sendActionResultSms({
      companyId: input.companyId,
      phone: body.customer_phone || thread.phone,
      customerId: customer.customer_id,
      body: message,
      send: Boolean(body.send_to_customer),
    });
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId: customer.property_id,
      body: toolOk(
        "select_offered_slot",
        {
          ...blockedBookingPayload({
            readiness: evaluateBookingReadiness({
              customerId: customer.customer_id,
              customerFirstName: customer.first_name,
              propertyId: customer.property_id,
              propertyCount: customer.property_count,
              intake: existingIntake,
              offeredCount: offered.length,
              selectedSlot: null,
            }),
            customer_message: message,
            error_code: null,
            slot_selected: false,
            match_status: "ambiguous",
          }),
          match_status: "ambiguous",
          choices,
          available_slots: choices,
          agent_instruction: `${message} Do not tell the customer they are booked.`,
        },
        { instruction: `${message} Do not tell the customer they are booked.` }
      ),
    };
  }

  const message = unmatchedOfferedSlotMessage();
  await sendActionResultSms({
    companyId: input.companyId,
    phone: body.customer_phone || thread.phone,
    customerId: customer.customer_id,
    body: message,
    send: Boolean(body.send_to_customer),
  });
  return {
    status: 200,
    customerId: customer.customer_id,
    propertyId: customer.property_id,
    body: toolOk(
      "select_offered_slot",
      {
        ...blockedBookingPayload({
          readiness: evaluateBookingReadiness({
            customerId: customer.customer_id,
            customerFirstName: customer.first_name,
            propertyId: customer.property_id,
            propertyCount: customer.property_count,
            intake: existingIntake,
            offeredCount: offered.length,
            selectedSlot: priorSelected,
          }),
          customer_message: message,
          error_code: null,
          slot_selected: Boolean(priorSelected),
          match_status: "none",
        }),
        match_status: "none",
        choices: [],
        available_slots: [],
        agent_instruction: `${message} ${DO_NOT_CLAIM_BOOKED}`,
      },
      { instruction: `${message} ${DO_NOT_CLAIM_BOOKED}` }
    ),
  };
}
