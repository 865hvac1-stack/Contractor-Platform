import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import { validateHighLevelLocation } from "@/lib/agent-tools/context";
import { persistOfferedSlots, loadActiveSchedulingState, resolveActionThread } from "@/lib/agent-tools/persist-offers";
import { sendActionResultSms } from "@/lib/agent-tools/send-result";
import { signSlotToken } from "@/lib/agent-tools/slot-token";
import { parseOfferedSlots, resolveOfferedSlotSelection } from "@/lib/scheduling/conversation-turn";
import { clarifyOfferedSlotsMessage, unmatchedOfferedSlotMessage } from "@/lib/scheduling/templates";
import { formatLocalDateShort, formatWindowChip } from "@/lib/scheduling/time";

export const selectOfferedSlotSchema = z.object({
  location_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  conversation_id: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  customer_reply: z.string().min(1),
  send_to_customer: z.boolean().optional(),
});

function slotRef(slot: { date: string; windowId: string }) {
  return createHash("sha256").update(`${slot.date}:${slot.windowId}`).digest("hex").slice(0, 12);
}

function displaySlot(date: string, startMinutes: number, endMinutes: number, timeZone: string) {
  return `${formatLocalDateShort(date, timeZone)} from ${formatWindowChip(startMinutes, endMinutes)}`;
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
  const thread = await resolveActionThread({
    companyId: input.companyId,
    conversationId: body.conversation_id,
    phone: body.customer_phone,
  });
  if (!thread) {
    return {
      status: 422,
      body: toolError("select_offered_slot", "CONVERSATION_NOT_FOUND", "No ContractorYou conversation was found for that request."),
    };
  }
  const state = await loadActiveSchedulingState(input.companyId, thread.id);
  if (state?.status === "BOOKED") {
    return {
      status: 409,
      customerId: state.customerId,
      bookingId: state.bookedJobId,
      body: toolError("select_offered_slot", "ALREADY_BOOKED", "This conversation already has a booked appointment."),
    };
  }
  const offered = parseOfferedSlots(state?.offeredSlots);
  const selection = resolveOfferedSlotSelection(body.customer_reply, offered);
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

  if (selection.kind === "match") {
    const display = displaySlot(selection.slot.date, selection.slot.startMinutes, selection.slot.endMinutes, timeZone);
    const token = signSlotToken({
      companyId: input.companyId,
      date: selection.slot.date,
      windowId: selection.slot.windowId,
      serviceTypeId: state?.serviceTypeId ?? null,
    });
    if (state) {
      await prisma.conversationSchedulingState.update({
        where: { id: state.id },
        data: {
          requestedDate: new Date(`${selection.slot.date}T00:00:00.000Z`),
          requestedWindowId: selection.slot.windowId,
          lastAiAction: "select_offered_slot",
        },
      });
    }
    await persistOfferedSlots({
      companyId: input.companyId,
      threadId: thread.id,
      customerId: state?.customerId ?? thread.customerId,
      propertyId: state?.propertyId,
      serviceTypeId: state?.serviceTypeId,
      slots: offered,
    });
    return {
      status: 200,
      customerId: state?.customerId ?? thread.customerId,
      propertyId: state?.propertyId,
      serviceTypeId: state?.serviceTypeId,
      body: toolOk(
        "select_offered_slot",
        {
          match_status: "exact",
          slot_token: token,
          display,
          date: selection.slot.date,
          window_id: selection.slot.windowId,
          available_slots: [{ slot_token: token, display, date: selection.slot.date }],
        },
        { instruction: "Use this exact slot_token to book. Do not invent another time." }
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
    await sendActionResultSms({
      companyId: input.companyId,
      phone: body.customer_phone || thread.phone,
      customerId: state?.customerId ?? thread.customerId,
      body: message,
      send: Boolean(body.send_to_customer),
    });
    return {
      status: 200,
      customerId: state?.customerId ?? thread.customerId,
      propertyId: state?.propertyId,
      body: toolOk(
        "select_offered_slot",
        { match_status: "ambiguous", choices, available_slots: choices },
        { instruction: message }
      ),
    };
  }

  const message = unmatchedOfferedSlotMessage();
  await sendActionResultSms({
    companyId: input.companyId,
    phone: body.customer_phone || thread.phone,
    customerId: state?.customerId ?? thread.customerId,
    body: message,
    send: Boolean(body.send_to_customer),
  });
  return {
    status: 200,
    customerId: state?.customerId ?? thread.customerId,
    propertyId: state?.propertyId,
    body: toolOk(
      "select_offered_slot",
      { match_status: "none", choices: [], available_slots: [] },
      { instruction: message }
    ),
  };
}
