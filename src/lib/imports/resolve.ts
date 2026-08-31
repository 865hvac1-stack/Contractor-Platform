import type { PrismaClient } from "@prisma/client";
import { addressKey, digitsOnly, nameKey, normalizeEmail, normalizeText } from "@/lib/imports/normalize";

export type ResolvedLink = {
  id: string | null;
  reason: string;
  verdict: "MATCHED" | "NEEDS_REVIEW" | "MISSING";
};

export type IndexedCustomerRow = {
  id: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
};

export type IndexedPropertyRow = {
  id: string;
  customerId: string;
  address: string;
  city: string;
  zip: string;
  isPrimary: boolean;
  externalId: string | null;
};

export type CompanyLinkIndex = {
  refs: Map<string, string>;
  customersById: Map<string, IndexedCustomerRow>;
  customersByExternalId: Map<string, string>;
  customersByEmail: Map<string, string>;
  customers: IndexedCustomerRow[];
  propertiesByCustomerId: Map<string, IndexedPropertyRow[]>;
  propertiesByExternalId: Map<string, string>;
  jobsByKey: Map<string, string>;
  estimatesByKey: Map<string, string>;
  invoicesByKey: Map<string, string>;
  team: { userId: string; full: string }[];
};

function refKey(recordType: string, externalId: string) {
  return `${recordType}:${externalId}`;
}

function last10(phone: string) {
  return digitsOnly(phone).slice(-10);
}

export async function loadCompanyLinkIndex(prisma: PrismaClient, companyId: string): Promise<CompanyLinkIndex> {
  const [refs, customers, properties, jobs, estimates, invoices, members] = await Promise.all([
    prisma.importExternalRef.findMany({
      where: { companyId },
      select: { recordType: true, externalId: true, targetRecordId: true },
    }),
    prisma.customer.findMany({
      where: { companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        email: true,
        phone: true,
        externalId: true,
      },
    }),
    prisma.property.findMany({
      where: { companyId },
      select: { id: true, customerId: true, address: true, city: true, zip: true, isPrimary: true, externalId: true },
    }),
    prisma.job.findMany({
      where: { companyId },
      select: { id: true, externalId: true, jobNumber: true },
    }),
    prisma.estimate.findMany({
      where: { companyId },
      select: { id: true, externalId: true, estimateNumber: true },
    }),
    prisma.invoice.findMany({
      where: { companyId },
      select: { id: true, externalId: true, invoiceNumber: true },
    }),
    prisma.membership.findMany({
      where: { companyId, status: "ACTIVE" },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);

  const index: CompanyLinkIndex = {
    refs: new Map(),
    customersById: new Map(),
    customersByExternalId: new Map(),
    customersByEmail: new Map(),
    customers,
    propertiesByCustomerId: new Map(),
    propertiesByExternalId: new Map(),
    jobsByKey: new Map(),
    estimatesByKey: new Map(),
    invoicesByKey: new Map(),
    team: members.map((member) => ({
      userId: member.user.id,
      full: `${member.user.firstName} ${member.user.lastName}`.trim().toLowerCase(),
    })),
  };

  for (const ref of refs) {
    index.refs.set(refKey(ref.recordType, ref.externalId), ref.targetRecordId);
  }
  for (const customer of customers) {
    index.customersById.set(customer.id, customer);
    if (customer.externalId) index.customersByExternalId.set(customer.externalId, customer.id);
    const email = normalizeEmail(customer.email);
    if (email) index.customersByEmail.set(email, customer.id);
  }
  for (const property of properties) {
    const list = index.propertiesByCustomerId.get(property.customerId) ?? [];
    list.push(property);
    index.propertiesByCustomerId.set(property.customerId, list);
    if (property.externalId) index.propertiesByExternalId.set(property.externalId, property.id);
  }
  for (const job of jobs) {
    if (job.externalId) index.jobsByKey.set(job.externalId, job.id);
    if (job.jobNumber) index.jobsByKey.set(job.jobNumber, job.id);
  }
  for (const estimate of estimates) {
    if (estimate.externalId) index.estimatesByKey.set(estimate.externalId, estimate.id);
    if (estimate.estimateNumber) index.estimatesByKey.set(estimate.estimateNumber, estimate.id);
  }
  for (const invoice of invoices) {
    if (invoice.externalId) index.invoicesByKey.set(invoice.externalId, invoice.id);
    if (invoice.invoiceNumber) index.invoicesByKey.set(invoice.invoiceNumber, invoice.id);
  }

  return index;
}

export function matchCustomerFromIndex(
  index: CompanyLinkIndex,
  input: {
    externalId?: string | null;
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
    name?: string | null;
  }
): ResolvedLink {
  if (input.externalId) {
    const fromRef = index.refs.get(refKey("CUSTOMERS", input.externalId));
    if (fromRef) return { id: fromRef, reason: "Matched the source customer ID from an earlier import", verdict: "MATCHED" };
    const byExt = index.customersByExternalId.get(input.externalId);
    if (byExt) return { id: byExt, reason: "Matched customer source ID", verdict: "MATCHED" };
  }
  const email = normalizeEmail(input.email);
  if (email) {
    const hit = index.customersByEmail.get(email);
    if (hit) return { id: hit, reason: "Matched customer email", verdict: "MATCHED" };
  }
  const phone = digitsOnly(input.phone);
  if (phone.length >= 10) {
    const needle = phone.slice(-10);
    const hit = index.customers.find((customer) => customer.phone && last10(customer.phone) === needle);
    if (hit) return { id: hit.id, reason: "Matched customer phone", verdict: "MATCHED" };
  }
  const display = normalizeText(input.name || `${input.firstName ?? ""} ${input.lastName ?? ""}`);
  if (display.length > 3 || input.businessName) {
    const key = nameKey(
      input.firstName || display.split(" ")[0] || "",
      input.lastName || display.split(" ").slice(1).join(" "),
      input.businessName
    );
    const matches = index.customers.filter(
      (customer) => nameKey(customer.firstName, customer.lastName, customer.businessName) === key
    );
    if (matches.length === 1) return { id: matches[0]!.id, reason: "Matched customer name", verdict: "MATCHED" };
    if (matches.length > 1) return { id: null, reason: "More than one customer has that name", verdict: "NEEDS_REVIEW" };
  }
  return { id: null, reason: "We could not match this row to a customer", verdict: "MISSING" };
}

export function matchPropertyFromIndex(
  index: CompanyLinkIndex,
  customerId: string | null,
  input: { externalId?: string | null; address?: string | null; city?: string | null; zip?: string | null }
): ResolvedLink {
  if (input.externalId) {
    const fromRef = index.refs.get(refKey("PROPERTIES", input.externalId));
    if (fromRef) return { id: fromRef, reason: "Matched the source property ID", verdict: "MATCHED" };
    const byExt = index.propertiesByExternalId.get(input.externalId);
    if (byExt) return { id: byExt, reason: "Matched the source property ID", verdict: "MATCHED" };
  }
  if (customerId) {
    const properties = index.propertiesByCustomerId.get(customerId) ?? [];
    if (input.address) {
      const key = addressKey(input.address, input.city || "", input.zip || "");
      const hit = properties.find((property) => addressKey(property.address, property.city, property.zip) === key);
      if (hit) return { id: hit.id, reason: "Matched the service address", verdict: "MATCHED" };
    }
    const primary = properties.find((property) => property.isPrimary) ?? properties[0];
    if (primary) return { id: primary.id, reason: "Used this customer’s existing service location", verdict: "MATCHED" };
  }
  return { id: null, reason: "No service location matched", verdict: "MISSING" };
}

export function matchNumberedRecordFromIndex(
  index: CompanyLinkIndex,
  kind: "JOBS" | "ESTIMATES" | "INVOICES",
  value?: string | null
): ResolvedLink {
  if (!value) return { id: null, reason: `No ${kind.toLowerCase()} reference`, verdict: "MISSING" };
  const fromRef = index.refs.get(refKey(kind, value));
  if (fromRef) return { id: fromRef, reason: `Matched source ${kind.toLowerCase()} ID`, verdict: "MATCHED" };
  const map = kind === "JOBS" ? index.jobsByKey : kind === "ESTIMATES" ? index.estimatesByKey : index.invoicesByKey;
  const hit = map.get(value);
  if (hit) {
    const label = kind === "JOBS" ? "job" : kind === "ESTIMATES" ? "estimate" : "invoice";
    return { id: hit, reason: `Matched ${label} number or source ID`, verdict: "MATCHED" };
  }
  return { id: null, reason: `We could not find that ${kind.toLowerCase().slice(0, -1)}`, verdict: "MISSING" };
}

export function matchTeamMemberFromIndex(
  index: CompanyLinkIndex,
  name?: string | null
): { userId: string | null; display: string | null } {
  const text = normalizeText(name);
  if (!text) return { userId: null, display: null };
  const needle = text.toLowerCase();
  const hits = index.team.filter(
    (member) => member.full === needle || member.full.includes(needle) || needle.includes(member.full)
  );
  if (hits.length === 1) return { userId: hits[0]!.userId, display: text };
  return { userId: null, display: text };
}

export async function resolveCustomer(
  prisma: PrismaClient,
  companyId: string,
  input: {
    externalId?: string | null;
    sourceSystem?: string | null;
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
    name?: string | null;
  }
): Promise<ResolvedLink> {
  const index = await loadCompanyLinkIndex(prisma, companyId);
  return matchCustomerFromIndex(index, input);
}

export async function resolveProperty(
  prisma: PrismaClient,
  companyId: string,
  customerId: string | null,
  input: { externalId?: string | null; address?: string | null; city?: string | null; zip?: string | null }
): Promise<ResolvedLink> {
  const index = await loadCompanyLinkIndex(prisma, companyId);
  return matchPropertyFromIndex(index, customerId, input);
}

export async function resolveByExternalOrNumber(
  prisma: PrismaClient,
  companyId: string,
  kind: "JOBS" | "ESTIMATES" | "INVOICES",
  value?: string | null
): Promise<ResolvedLink> {
  const index = await loadCompanyLinkIndex(prisma, companyId);
  return matchNumberedRecordFromIndex(index, kind, value);
}

export async function matchTeamMember(
  prisma: PrismaClient,
  companyId: string,
  name?: string | null
): Promise<{ userId: string | null; display: string | null }> {
  const index = await loadCompanyLinkIndex(prisma, companyId);
  return matchTeamMemberFromIndex(index, name);
}
