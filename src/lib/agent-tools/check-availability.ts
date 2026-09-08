import { z } from "zod";
import { prisma } from "@/lib/db";
import { findNextAvailableOptions, getAvailability, loadSchedulingPolicy } from "@/lib/scheduling/capacity";
import { uniqueWindowOffers } from "@/lib/scheduling/conversation-turn";
import { matchesDaypart } from "@/lib/scheduling/daypart";
import { getCustomerMaintenanceSummary } from "@/lib/scheduling/maintenance";
import { addLocalDays, companyTodayKey, formatWindowChip, zonedLocalDateTime } from "@/lib/scheduling/time";
import { interpretSchedulingIntent } from "@/lib/scheduling/intent";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import { signSlotToken } from "@/lib/agent-tools/slot-token";
import {
  customerPayload,
  hhmm,
  parseRequestedDaypart,
  resolveServiceType,
  resolveToolCustomer,
  validateHighLevelLocation,
} from "@/lib/agent-tools/context";

export const checkAvailabilitySchema = z.object({
  location_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  conversation_id: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  service_type: z.string().optional().nullable(),
  service_need: z.string().optional().nullable(),
  requested_date: z.string().optional().nullable(),
  requested_daypart: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
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

export async function checkAvailabilityTool(input: {
  companyId: string;
  body: unknown;
}) {
  const parsed = checkAvailabilitySchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      status: 400,
      body: toolError("check_availability", "INVALID_REQUEST", "The availability request was missing required fields."),
    };
  }
  const body = parsed.data;
  const location = await validateHighLevelLocation(input.companyId, body.location_id);
  if (!location.ok) {
    return { status: 403, body: toolError("check_availability", location.code, location.message) };
  }

  const company = await prisma.company.findFirst({
    where: { id: input.companyId },
    select: { timezone: true },
  });
  const timeZone = body.timezone || company?.timezone || "America/New_York";
  const service = await resolveServiceType({
    companyId: input.companyId,
    serviceType: body.service_type,
    serviceNeed: body.service_need,
  });
  if (!service.ok) {
    return {
      status: 422,
      body: toolError("check_availability", service.code, "Choose the service type before offering times.", {
        requires_clarification: true,
        clarification: { field: "service_type", options: service.options },
      }),
    };
  }

  const resolved = await resolveToolCustomer({
    companyId: input.companyId,
    contactId: body.contact_id,
    conversationId: body.conversation_id,
    phone: body.customer_phone,
  });
  const membership = resolved.context
    ? await getCustomerMaintenanceSummary(input.companyId, resolved.context.customerId)
    : { hasActivePlan: false, next: null, visits: [] };
  const customer = customerPayload(resolved.context, membership.hasActivePlan ? "active" : "none");
  const requires: string[] = [];
  if (customer.property_status === "missing") requires.push("service_address");
  if (customer.property_status === "multiple") requires.push("property_id");
  if (customer.status === "new") requires.push("customer_name", "service_address");

  const policy = await loadSchedulingPolicy(prisma, input.companyId);
  const today = companyTodayKey(new Date(), timeZone);
  const intent = body.requested_date
    ? interpretSchedulingIntent({ text: body.requested_date, timeZone })
    : null;
  const requestedDate =
    body.requested_date && /^\d{4}-\d{2}-\d{2}$/.test(body.requested_date)
      ? body.requested_date
      : intent?.requestedDate ?? null;
  const daypart = parseRequestedDaypart(body.requested_daypart) ?? intent?.requestedDaypart ?? null;
  const horizon = service.maintenance ? policy.maintenanceHorizonDays : policy.standardHorizonDays;

  const rawOptions = requestedDate
    ? (
        await getAvailability({
          companyId: input.companyId,
          date: requestedDate,
          serviceTypeId: service.serviceType.id,
          maintenance: service.maintenance,
        })
      ).options.filter((option) => !daypart || matchesDaypart(option, daypart))
    : await findNextAvailableOptions({
        companyId: input.companyId,
        startDate: today,
        days: Math.min(horizon, service.maintenance ? 60 : 21),
        serviceTypeId: service.serviceType.id,
        daypart,
        maintenance: service.maintenance,
      });

  const slots = uniqueWindowOffers(rawOptions, 4).map((slot) => ({
    slot_token: signSlotToken({
      companyId: input.companyId,
      date: slot.date,
      windowId: slot.windowId,
      serviceTypeId: service.serviceType.id,
    }),
    date: slot.date,
    window_id: slot.windowId,
    window_start: hhmm(slot.startMinutes),
    window_end: hhmm(slot.endMinutes),
    display: slotDisplay(slot.date, slot.startMinutes, slot.endMinutes, timeZone),
  }));

  const maintenance = membership.next
    ? {
        status: membership.next.status,
        label: membership.next.label,
        due_start: membership.next.dueStart,
        already_scheduled: membership.next.status === "SCHEDULED",
        job_id: membership.next.jobId,
      }
    : { status: membership.hasActivePlan ? "none_due" : "no_plan" };

  if (!slots.length) {
    return {
      status: 200,
      customerId: customer.customer_id,
      propertyId: customer.property_id,
      serviceTypeId: service.serviceType.id,
      body: toolOk(
        "check_availability",
        {
          timezone: timeZone,
          customer,
          service_type: { id: service.serviceType.id, name: service.serviceType.name },
          available_slots: [],
          requires,
          requires_office: true,
          maintenance,
          horizon_days: horizon,
        },
        {
          instruction:
            "No valid openings were found. Do not promise an appointment. Offer to have the office follow up.",
        }
      ),
    };
  }

  return {
    status: 200,
    customerId: customer.customer_id,
    propertyId: customer.property_id,
    serviceTypeId: service.serviceType.id,
    body: toolOk(
      "check_availability",
      {
        timezone: timeZone,
        customer,
        service_type: { id: service.serviceType.id, name: service.serviceType.name },
        available_slots: slots,
        requires,
        requires_office: false,
        maintenance,
        next_search_date: addLocalDays(today, 1),
      },
      {
        instruction:
          "Offer only these available appointment windows. Do not invent additional availability. If more customer information is required, ask only for the missing fields.",
      }
    ),
  };
}
