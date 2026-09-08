import type { AppointmentDaypart } from "@prisma/client";
import { prisma } from "@/lib/db";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";
import {
  loadSchedulingCustomerContext,
  resolveSchedulingCustomer,
  type SchedulingCustomerContext,
} from "@/lib/scheduling/conversation-identity";
import { loadSchedulingPolicy } from "@/lib/scheduling/capacity";

export type ResolvedCustomer = {
  status: "existing" | "new" | "ambiguous";
  customer_id: string | null;
  first_name: string | null;
  property_status: "resolved" | "missing" | "multiple";
  property_id: string | null;
  property_count: number;
  membership_status: "none" | "active";
  properties: Array<{ id: string; display_address: string }>;
};

export async function validateHighLevelLocation(companyId: string, locationId?: string | null) {
  const supplied = sanitizeHighLevelLocationId(locationId);
  if (!supplied) return { ok: true as const, locationId: null };
  const connection = await prisma.integrationConnection.findFirst({
    where: { companyId, providerKey: HIGHLEVEL_PROVIDER_KEY },
    select: { externalAccountId: true },
  });
  const configured = sanitizeHighLevelLocationId(connection?.externalAccountId);
  if (configured && configured !== supplied) {
    return { ok: false as const, code: "LOCATION_MISMATCH" as const, message: "HighLevel location does not belong to this company." };
  }
  return { ok: true as const, locationId: supplied };
}

export async function resolveToolCustomer(input: {
  companyId: string;
  contactId?: string | null;
  conversationId?: string | null;
  phone?: string | null;
}) {
  const thread = input.conversationId
    ? await prisma.communicationThread.findFirst({
        where: {
          companyId: input.companyId,
          provider: HIGHLEVEL_PROVIDER_KEY,
          externalId: input.conversationId,
        },
        select: { id: true, customerId: true, phone: true, externalContactId: true },
      })
    : null;
  const identity = await resolveSchedulingCustomer(prisma, {
    companyId: input.companyId,
    customerId: thread?.customerId,
    phone: input.phone || thread?.phone,
    threadId: thread?.id,
    contactId: input.contactId || thread?.externalContactId,
  });
  const context = identity.customerId
    ? await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId: identity.customerId })
    : null;
  return { identity, context, thread };
}

export function customerPayload(
  context: SchedulingCustomerContext | null,
  membershipStatus: "none" | "active" = "none"
): ResolvedCustomer {
  if (!context) {
    return {
      status: "new",
      customer_id: null,
      first_name: null,
      property_status: "missing",
      property_id: null,
      property_count: 0,
      membership_status: membershipStatus,
      properties: [],
    };
  }
  const properties = context.properties.map((row) => ({
    id: row.id,
    display_address: [row.address, row.city, row.state, row.zip].filter(Boolean).join(", "),
  }));
  const propertyStatus =
    properties.length === 1 ? "resolved" : properties.length > 1 ? "multiple" : "missing";
  return {
    status: "existing",
    customer_id: context.customerId,
    first_name: context.firstName,
    property_status: propertyStatus,
    property_id: properties.length === 1 ? properties[0]!.id : null,
    property_count: properties.length,
    membership_status: membershipStatus,
    properties,
  };
}

export async function resolveServiceType(input: {
  companyId: string;
  serviceType?: string | null;
  serviceNeed?: string | null;
}) {
  const policy = await loadSchedulingPolicy(prisma, input.companyId);
  const types = await prisma.serviceType.findMany({
    where: { companyId: input.companyId, active: true, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, key: true },
  });
  const requested = (input.serviceType || "").trim().toLowerCase();
  const need = `${input.serviceType || ""} ${input.serviceNeed || ""}`.toLowerCase();
  const maintenanceIntent = /\b(maintenance|tune[- ]?up|membership visit)\b/.test(need);

  if (requested) {
    const exact = types.filter((row) => row.name.toLowerCase() === requested || row.key.toLowerCase() === requested);
    if (exact.length === 1) return { ok: true as const, serviceType: exact[0]!, maintenance: maintenanceIntent };
    const partial = types.filter(
      (row) => row.name.toLowerCase().includes(requested) || requested.includes(row.name.toLowerCase())
    );
    if (partial.length === 1) return { ok: true as const, serviceType: partial[0]!, maintenance: maintenanceIntent };
    if (partial.length > 1) {
      return {
        ok: false as const,
        code: "SERVICE_TYPE_REQUIRED" as const,
        options: partial.map((row) => ({ id: row.id, name: row.name })),
      };
    }
  }

  const fallbackId = maintenanceIntent ? policy.maintenanceServiceTypeId ?? policy.defaultServiceTypeId : policy.defaultServiceTypeId;
  const fallback = types.find((row) => row.id === fallbackId) ?? types[0] ?? null;
  if (!fallback) {
    return { ok: false as const, code: "SERVICE_TYPE_REQUIRED" as const, options: types.map((row) => ({ id: row.id, name: row.name })) };
  }
  return { ok: true as const, serviceType: fallback, maintenance: maintenanceIntent };
}

export function parseRequestedDaypart(value?: string | null): AppointmentDaypart | null {
  const lower = (value || "").trim().toLowerCase();
  if (lower === "morning" || lower === "am") return "MORNING";
  if (lower === "afternoon" || lower === "pm") return "AFTERNOON";
  if (lower === "evening") return "EVENING";
  if (lower === "any" || lower === "anytime") return "ANY";
  return null;
}

export function hhmm(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
