import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { mapContactToCustomer } from "@/lib/highlevel/contacts";
import { getIdentityMap } from "@/lib/highlevel/identity";
import { canonicalizeUsPhone, phonesMatch } from "@/lib/phone";

export type SchedulingIntake = {
  firstName?: string | null;
  lastName?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type SchedulingPropertyView = {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
  name?: string | null;
};

export type SchedulingCustomerContext = {
  customerId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  preferredContactMethod: string;
  properties: SchedulingPropertyView[];
};

const PROBLEM_LANGUAGE =
  /\b(ac|a\/c|air ?cond|cool(ing)?|heat(ing)?|furnace|thermostat|outdoor|outside|unit|fan|humm|spin|leak|drip|freeze|frozen|ice|blowing|not work|won'?t|isn'?t|broken|maintenance|tune[- ]?up)\b/i;

const DIAGNOSIS_WORDS =
  /\b(capacitor|contactor|compressor failed|bad capacitor|needs a new|warranty|freon leak|quoted|\$\d+)\b/i;

export function parseIntake(value: unknown): SchedulingIntake {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const pick = (key: keyof SchedulingIntake) => (typeof row[key] === "string" ? String(row[key]) : null);
  return {
    firstName: pick("firstName"),
    lastName: pick("lastName"),
    street: pick("street"),
    city: pick("city"),
    state: pick("state"),
    zip: pick("zip"),
  };
}

export function parsePersonName(text: string): { firstName: string; lastName: string } | null {
  const cleaned = text
    .trim()
    .replace(/^(it'?s|this is|my name is|name is|i am|i'm)\s+/i, "")
    .replace(/[.!?,]+$/g, "")
    .replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 80) return null;
  if (/\d/.test(cleaned)) return null;
  if (PROBLEM_LANGUAGE.test(cleaned) && cleaned.split(" ").length > 4) return null;
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  if (parts.some((part) => !/^[a-zA-Z][a-zA-Z'-]*$/.test(part))) return null;
  return { firstName: titleCase(parts[0]!), lastName: parts.slice(1).map(titleCase).join(" ") };
}

export function parseServiceAddress(text: string): { street: string; city: string; state: string; zip: string } | null {
  const cleaned = text.trim().replace(/\s+/g, " ");
  const withComma = cleaned.match(
    /^(\d{1,6}\s+.+?),\s*([A-Za-z .'-]+?)\s*,?\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/
  );
  if (withComma) {
    return {
      street: withComma[1]!.trim(),
      city: titleCase(withComma[2]!.trim()),
      state: withComma[3]!.toUpperCase(),
      zip: withComma[4]!,
    };
  }
  const loose = cleaned.match(/^(\d{1,6}\s+.+?)\s+([A-Za-z .'-]+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (loose) {
    return {
      street: loose[1]!.trim(),
      city: titleCase(loose[2]!.trim()),
      state: loose[3]!.toUpperCase(),
      zip: loose[4]!,
    };
  }
  return null;
}

export function streetLabel(address: string) {
  const withoutNumber = address.trim().replace(/^\d+\s+/, "");
  const parts = withoutNumber.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(" ");
  return withoutNumber || address.trim();
}

export function propertyChoiceLabel(property: SchedulingPropertyView, index: number) {
  const street = streetLabel(property.address);
  if (property.isPrimary || index === 0) return `your home on ${street}`;
  return `the property on ${street}`;
}

export function matchPropertyFromText(text: string, properties: SchedulingPropertyView[]): SchedulingPropertyView[] {
  const lower = text.trim().toLowerCase();
  if (!properties.length) return [];
  if (/\b(first|1st|the house|my house|the home|my home|primary)\b/.test(lower) && properties.length) {
    const primary = properties.find((row) => row.isPrimary) ?? properties[0];
    return primary ? [primary] : [];
  }
  if (/\b(second|2nd|the other)\b/.test(lower) && properties[1]) return [properties[1]];
  return properties.filter((property) => {
    const label = streetLabel(property.address).toLowerCase();
    const street = property.address.toLowerCase();
    const city = property.city.toLowerCase();
    return (
      (label && lower.includes(label)) ||
      label.split(/\s+/).some((part) => part.length > 3 && lower.includes(part)) ||
      (street && lower.includes(street)) ||
      (city.length > 3 && lower.includes(city))
    );
  });
}

export function extractCustomerConcern(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed || !PROBLEM_LANGUAGE.test(trimmed)) return null;
  if (DIAGNOSIS_WORDS.test(trimmed)) {
    return trimmed.replace(DIAGNOSIS_WORDS, "").replace(/\s+/g, " ").trim().slice(0, 400) || trimmed.slice(0, 400);
  }
  return trimmed.slice(0, 400);
}

export function jobDescriptionFromConcern(concern: string | null, fallback = "Service call requested.") {
  if (!concern?.trim()) return fallback;
  const cleaned = concern.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  if (/^customer reports\b/i.test(cleaned)) return `${cleaned}.`;
  const body = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  return `Customer reports ${body}.`;
}

export async function resolveSchedulingCustomer(
  db: PrismaClient,
  input: {
    companyId: string;
    customerId?: string | null;
    phone?: string | null;
    threadId?: string | null;
    contactId?: string | null;
  }
): Promise<{ customerId: string | null; leadId: string | null; matchedOn: "input" | "thread" | "identity_map" | "phone" | "lead" | null }> {
  if (input.customerId) {
    const existing = await db.customer.findFirst({
      where: { id: input.customerId, companyId: input.companyId, status: { not: "ARCHIVED" } },
      select: { id: true },
    });
    if (existing) return { customerId: existing.id, leadId: null, matchedOn: "input" };
  }

  const thread = input.threadId
    ? await db.communicationThread.findFirst({
        where: { id: input.threadId, companyId: input.companyId },
        select: { customerId: true, leadId: true, phone: true, externalContactId: true },
      })
    : null;

  if (thread?.customerId) {
    const existing = await db.customer.findFirst({
      where: { id: thread.customerId, companyId: input.companyId, status: { not: "ARCHIVED" } },
      select: { id: true },
    });
    if (existing) return { customerId: existing.id, leadId: thread.leadId, matchedOn: "thread" };
  }

  const contactId = input.contactId || thread?.externalContactId || null;
  if (contactId) {
    const mapped = await getIdentityMap(db, {
      companyId: input.companyId,
      entityType: "CUSTOMER",
      externalId: contactId,
    });
    if (mapped) {
      const existing = await db.customer.findFirst({
        where: { id: mapped.internalId, companyId: input.companyId, status: { not: "ARCHIVED" } },
        select: { id: true },
      });
      if (existing) return { customerId: existing.id, leadId: thread?.leadId ?? null, matchedOn: "identity_map" };
    }
  }

  const phone = canonicalizeUsPhone(input.phone) || canonicalizeUsPhone(thread?.phone);
  if (phone) {
    const candidates = await db.customer.findMany({
      where: {
        companyId: input.companyId,
        status: { not: "ARCHIVED" },
        OR: [{ phone: { not: null } }, { secondaryPhone: { not: null } }],
      },
      select: { id: true, phone: true, secondaryPhone: true },
      take: 2000,
    });
    const hit = candidates.find((row) => phonesMatch(phone, row.phone) || phonesMatch(phone, row.secondaryPhone));
    if (hit) return { customerId: hit.id, leadId: thread?.leadId ?? null, matchedOn: "phone" };
  }

  if (thread?.leadId) {
    const lead = await db.lead.findFirst({
      where: { id: thread.leadId, companyId: input.companyId },
      select: { id: true, customerId: true },
    });
    if (lead?.customerId) return { customerId: lead.customerId, leadId: lead.id, matchedOn: "lead" };
    if (lead) return { customerId: null, leadId: lead.id, matchedOn: "lead" };
  }

  if (phone) {
    const leads = await db.lead.findMany({
      where: { companyId: input.companyId, phone: { not: null }, status: { notIn: ["LOST", "SPAM"] } },
      select: { id: true, customerId: true, phone: true },
      take: 200,
    });
    const lead = leads.find((row) => phonesMatch(phone, row.phone));
    if (lead?.customerId) return { customerId: lead.customerId, leadId: lead.id, matchedOn: "lead" };
    if (lead) return { customerId: null, leadId: lead.id, matchedOn: "lead" };
  }

  return { customerId: null, leadId: thread?.leadId ?? null, matchedOn: null };
}

export async function loadSchedulingCustomerContext(
  db: PrismaClient,
  input: { companyId: string; customerId: string }
): Promise<SchedulingCustomerContext | null> {
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      preferredContactMethod: true,
      properties: {
        select: { id: true, address: true, city: true, state: true, zip: true, isPrimary: true, name: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!customer) return null;
  return {
    customerId: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    preferredContactMethod: customer.preferredContactMethod,
    properties: customer.properties,
  };
}

export async function createCustomerForConversation(
  db: PrismaClient,
  input: {
    companyId: string;
    firstName: string;
    lastName?: string | null;
    phone?: string | null;
    leadId?: string | null;
    threadId?: string | null;
    contactId?: string | null;
    source?: string | null;
  }
) {
  const phone = canonicalizeUsPhone(input.phone);
  if (phone) {
    const existing = await resolveSchedulingCustomer(db, {
      companyId: input.companyId,
      phone,
      threadId: input.threadId,
      contactId: input.contactId,
    });
    if (existing.customerId) return existing.customerId;
  }

  const customer = await db.customer.create({
    data: {
      companyId: input.companyId,
      firstName: input.firstName.trim(),
      lastName: (input.lastName || "").trim(),
      phone,
      preferredContactMethod: "TEXT",
      status: "ACTIVE",
      source: input.source || "SMS",
      sourceSystem: "highlevel",
    },
  });

  if (input.leadId) {
    const lead = await db.lead.findFirst({
      where: { id: input.leadId, companyId: input.companyId },
      select: { id: true, customerId: true, source: true },
    });
    if (lead && !lead.customerId) {
      await db.lead.update({
        where: { id: lead.id },
        data: { customerId: customer.id, status: "BOOKED" },
      });
      if (lead.source) {
        await db.customer.update({
          where: { id: customer.id },
          data: { source: String(lead.source) },
        });
      }
    }
  }

  if (input.contactId) {
    await mapContactToCustomer(db, {
      companyId: input.companyId,
      customerId: customer.id,
      contactId: input.contactId,
    });
  }

  if (input.threadId) {
    await db.communicationThread.updateMany({
      where: { id: input.threadId, companyId: input.companyId },
      data: { customerId: customer.id },
    });
  }

  await writeAudit({
    companyId: input.companyId,
    action: "customer.created",
    entityType: "Customer",
    entityId: customer.id,
    metadata: { source: "conversation_scheduling", leadId: input.leadId ?? null },
  });

  return customer.id;
}

export async function createPropertyForConversation(
  db: PrismaClient,
  input: {
    companyId: string;
    customerId: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  }
) {
  const existing = await db.property.findMany({
    where: { companyId: input.companyId, customerId: input.customerId },
    select: { id: true, address: true, zip: true },
  });
  const street = input.street.trim();
  const zip = input.zip.trim();
  const duplicate = existing.find(
    (row) => row.address.trim().toLowerCase() === street.toLowerCase() && row.zip.trim() === zip
  );
  if (duplicate) return duplicate.id;

  const property = await db.property.create({
    data: {
      companyId: input.companyId,
      customerId: input.customerId,
      address: street,
      city: input.city.trim(),
      state: input.state.trim().toUpperCase(),
      zip,
      isPrimary: existing.length === 0,
      sourceSystem: "conversation_scheduling",
    },
  });
  await writeAudit({
    companyId: input.companyId,
    action: "property.created",
    entityType: "Property",
    entityId: property.id,
    metadata: { customerId: input.customerId, source: "conversation_scheduling" },
  });
  return property.id;
}

function titleCase(value: string) {
  return value
    .split(/(\s+|-)/)
    .map((part) => (/^[a-zA-Z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("");
}
