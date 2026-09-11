import type { PrismaClient } from "@prisma/client";
import { addressKey, normalizeEmail, normalizeText } from "@/lib/imports/normalize";
import { buildIdentityIndex, resolveCanonicalCustomer } from "@/lib/imports/identity";

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

function indexNeeds(recordType?: string) {
  const all = {
    refs: true,
    customers: true,
    properties: true,
    jobs: true,
    estimates: true,
    invoices: true,
    team: true,
  };
  if (recordType === "JOBS" || recordType === "PROPERTIES" || recordType === "EQUIPMENT" || recordType === "NOTES") {
    return { ...all, estimates: false, invoices: false };
  }
  if (recordType === "PAYMENTS") {
    return { ...all, jobs: false, estimates: false, team: false };
  }
  if (recordType === "INVOICES") {
    return { ...all, estimates: false };
  }
  if (recordType === "ESTIMATES") {
    return { ...all, invoices: false };
  }
  return all;
}

export async function loadCompanyLinkIndex(
  prisma: PrismaClient,
  companyId: string,
  recordType?: string
): Promise<CompanyLinkIndex> {
  const needs = indexNeeds(recordType);
  // Sequential on purpose: Railway Postgres has a small connection cap.
  const refs = needs.refs
    ? await prisma.importExternalRef.findMany({
        where: { companyId },
        select: { recordType: true, externalId: true, targetRecordId: true },
      })
    : [];
  const customers = needs.customers
    ? await prisma.customer.findMany({
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
      })
    : [];
  const properties = needs.properties
    ? await prisma.property.findMany({
        where: { companyId },
        select: { id: true, customerId: true, address: true, city: true, zip: true, isPrimary: true, externalId: true },
      })
    : [];
  const jobs = needs.jobs
    ? await prisma.job.findMany({
        where: { companyId },
        select: { id: true, externalId: true, jobNumber: true },
      })
    : [];
  const estimates = needs.estimates
    ? await prisma.estimate.findMany({
        where: { companyId },
        select: { id: true, externalId: true, estimateNumber: true },
      })
    : [];
  const invoices = needs.invoices
    ? await prisma.invoice.findMany({
        where: { companyId },
        select: { id: true, externalId: true, invoiceNumber: true },
      })
    : [];
  const members = needs.team
    ? await prisma.membership.findMany({
        where: { companyId, status: "ACTIVE" },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      })
    : [];

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
    sourceSystem?: string | null;
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
    name?: string | null;
    address?: string | null;
    city?: string | null;
    zip?: string | null;
  }
): ResolvedLink {
  if (input.externalId) {
    const fromRef = index.refs.get(refKey("CUSTOMERS", input.externalId));
    if (fromRef) return { id: fromRef, reason: "Matched the source customer ID from an earlier import", verdict: "MATCHED" };
    const byExt = index.customersByExternalId.get(input.externalId);
    if (byExt) return { id: byExt, reason: "Matched customer source ID", verdict: "MATCHED" };
  }

  const identity = buildIdentityIndex(
    index.customers.map((customer) => ({
      ...customer,
      properties: (index.propertiesByCustomerId.get(customer.id) ?? []).map((property) => ({
        address: property.address,
        city: property.city,
        zip: property.zip,
      })),
    }))
  );
  const decision = resolveCanonicalCustomer(identity, input);
  if (decision.confidence === "AUTO_MATCH") {
    return { id: decision.customerId, reason: decision.reason, verdict: "MATCHED" };
  }
  if (decision.confidence === "REVIEW") {
    return { id: decision.customerId, reason: decision.reason, verdict: "NEEDS_REVIEW" };
  }
  return { id: null, reason: decision.reason, verdict: "MISSING" };
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
