import { z } from "zod";
import { prisma } from "@/lib/db";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { mapContactToCustomer } from "@/lib/highlevel/contacts";
import { bookAppointment, findNextAvailableOptions, getAvailability } from "@/lib/scheduling";
import {
  createCustomerForConversation,
  createPropertyForConversation,
  jobDescriptionFromConcern,
  loadSchedulingCustomerContext,
  parsePersonName,
  parseServiceAddress,
} from "@/lib/scheduling/conversation-identity";
import { uniqueWindowOffers } from "@/lib/scheduling/conversation-turn";
import { findOpenMaintenanceVisit } from "@/lib/scheduling/maintenance";
import { companyTodayKey, formatWindowChip, zonedLocalDateTime } from "@/lib/scheduling/time";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import { sendActionResultSms } from "@/lib/agent-tools/send-result";
import { signSlotToken, verifySlotToken } from "@/lib/agent-tools/slot-token";
import {
  customerPayload,
  hhmm,
  resolveServiceType,
  resolveToolCustomer,
  validateHighLevelLocation,
} from "@/lib/agent-tools/context";

export const bookAppointmentSchema = z.object({
  location_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  conversation_id: z.string().optional().nullable(),
  slot_token: z.string().min(8),
  customer_phone: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  service_type: z.string().optional().nullable(),
  service_need: z.string().optional().nullable(),
  property_id: z.string().optional().nullable(),
  service_address: z
    .object({
      line1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional()
    .nullable(),
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

function addressFromBody(address?: { line1?: string; city?: string; state?: string; postal_code?: string } | null) {
  if (!address?.line1 || !address.city || !address.state || !address.postal_code) return null;
  return {
    street: address.line1.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    zip: address.postal_code.trim(),
  };
}

export async function bookAppointmentTool(input: {
  companyId: string;
  body: unknown;
  idempotencyKey?: string | null;
}) {
  const parsed = bookAppointmentSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      status: 400,
      body: toolError("book_appointment", "INVALID_REQUEST", "The booking request was missing a valid slot token."),
    };
  }
  const body = parsed.data;
  const location = await validateHighLevelLocation(input.companyId, body.location_id);
  if (!location.ok) {
    return { status: 403, body: toolError("book_appointment", location.code, location.message) };
  }

  const slot = verifySlotToken(body.slot_token, input.companyId);
  if (!slot) {
    return {
      status: 422,
      body: toolError("book_appointment", "SLOT_TOKEN_INVALID", "That appointment choice is no longer valid. Check availability again."),
    };
  }

  const company = await prisma.company.findFirst({
    where: { id: input.companyId },
    select: { timezone: true },
  });
  const timeZone = company?.timezone || "America/New_York";
  const service = await resolveServiceType({
    companyId: input.companyId,
    serviceType: body.service_type,
    serviceNeed: body.service_need,
  });
  if (!service.ok) {
    return {
      status: 422,
      body: toolError("book_appointment", service.code, "Choose the service type before booking.", {
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
  let customerId = resolved.identity.customerId;
  let context = resolved.context;
  let createdPropertyId: string | null = null;
  const suppliedAddress =
    addressFromBody(body.service_address) ||
    (typeof body.service_address?.line1 === "string" ? parseServiceAddress(body.service_address.line1) : null);

  if (!customerId) {
    const name = parsePersonName(body.customer_name || "");
    if (!name) {
      return {
        status: 422,
        body: toolError("book_appointment", "CUSTOMER_NAME_REQUIRED", "A customer name is required before booking a new customer.", {
          required_fields: ["customer_name", "service_address"],
        }),
      };
    }
    if (!suppliedAddress) {
      return {
        status: 422,
        body: toolError("book_appointment", "SERVICE_ADDRESS_REQUIRED", "A service address is required before booking.", {
          required_fields: ["service_address.line1", "service_address.city", "service_address.state", "service_address.postal_code"],
        }),
      };
    }
    customerId = await createCustomerForConversation(prisma, {
      companyId: input.companyId,
      firstName: name.firstName,
      lastName: name.lastName,
      phone: body.customer_phone,
      threadId: resolved.thread?.id,
      contactId: body.contact_id,
      leadId: resolved.identity.leadId,
      source: "SMS",
    });
    const propertyId = await createPropertyForConversation(prisma, {
      companyId: input.companyId,
      customerId,
      street: suppliedAddress.street,
      city: suppliedAddress.city,
      state: suppliedAddress.state,
      zip: suppliedAddress.zip,
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
  let propertyId = body.property_id || customer.property_id || createdPropertyId;
  if (propertyId && context && !context.properties.some((row) => row.id === propertyId)) {
    propertyId = null;
  }
  if (!propertyId && customer.property_status === "multiple") {
    return {
      status: 422,
      customerId,
      body: toolError("book_appointment", "PROPERTY_SELECTION_REQUIRED", "This customer has more than one property. Ask which address the visit is for.", {
        properties: customer.properties,
        required_fields: ["property_id"],
      }),
    };
  }
  if (!propertyId && customerId) {
    if (!suppliedAddress) {
      return {
        status: 422,
        customerId,
        body: toolError("book_appointment", "SERVICE_ADDRESS_REQUIRED", "A service address is required before booking.", {
          required_fields: ["service_address.line1", "service_address.city", "service_address.state", "service_address.postal_code"],
        }),
      };
    }
    propertyId = await createPropertyForConversation(prisma, {
      companyId: input.companyId,
      customerId,
      street: suppliedAddress.street,
      city: suppliedAddress.city,
      state: suppliedAddress.state,
      zip: suppliedAddress.zip,
    });
    context = await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId });
  }
  if (!customerId || !propertyId) {
    return {
      status: 422,
      body: toolError("book_appointment", "SERVICE_ADDRESS_REQUIRED", "A customer and service address are required before booking."),
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
        { available_slots: alternatives },
        {
          instruction:
            "That window was just taken. Offer only the newly returned available_slots. Do not invent another time.",
        }
      ),
    };
  }

  const thread = body.conversation_id
    ? await prisma.communicationThread.findFirst({
        where: { companyId: input.companyId, provider: HIGHLEVEL_PROVIDER_KEY, externalId: body.conversation_id },
        select: { id: true },
      })
    : resolved.thread;
  const idempotencyKey =
    input.idempotencyKey ||
    body.idempotency_key ||
    `agent:${input.companyId}:${body.conversation_id || body.contact_id || body.customer_phone || "anon"}:${body.slot_token}`;

  const booked = await bookAppointment({
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
    description: jobDescriptionFromConcern(body.service_need ?? null),
    sendConfirmation: false,
    maintenance: service.maintenance,
  });

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
      body: toolError("book_appointment", booked.code, booked.error),
    };
  }

  const job = await prisma.job.findFirst({
    where: { id: booked.jobId, companyId: input.companyId },
    select: {
      jobNumber: true,
      schedulingBooking: { select: { id: true } },
      property: { select: { id: true, address: true, city: true, state: true, zip: true } },
    },
  });
  const refreshed = await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId });
  const appointmentDisplay = slotDisplay(booked.date, stillOpen.startMinutes, stillOpen.endMinutes, timeZone);
  if (body.send_to_customer) {
    await sendActionResultSms({
      companyId: input.companyId,
      phone: body.customer_phone,
      customerId,
      body: `You’re scheduled for ${appointmentDisplay}. We’ll text you when your technician is on the way.`,
      send: true,
    });
  }

  return {
    status: 200,
    customerId,
    propertyId,
    serviceTypeId: service.serviceType.id,
    jobId: booked.jobId,
    bookingId: job?.schedulingBooking?.id ?? booked.jobId,
    body: toolOk(
      "book_appointment",
      {
        booking: {
          booking_id: job?.schedulingBooking?.id ?? booked.jobId,
          job_id: booked.jobId,
          job_number: job?.jobNumber ?? null,
          status: booked.duplicate ? "confirmed_duplicate" : "confirmed",
          date: booked.date,
          window_start: hhmm(stillOpen.startMinutes),
          window_end: hhmm(stillOpen.endMinutes),
          display: appointmentDisplay,
          technician_id: booked.technicianId,
        },
        customer: {
          customer_id: customerId,
          first_name: refreshed?.firstName ?? null,
        },
        property: {
          property_id: propertyId,
          display_address: job?.property
            ? [job.property.address, job.property.city, job.property.state, job.property.zip].filter(Boolean).join(", ")
            : null,
        },
      },
      {
        instruction:
          "The appointment is confirmed. Confirm this exact appointment naturally. Do not offer a different time. Do not mention APIs or ContractorYou.",
      }
    ),
  };
}
