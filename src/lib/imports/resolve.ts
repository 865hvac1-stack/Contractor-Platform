import type { PrismaClient } from "@prisma/client";
import { addressKey, digitsOnly, nameKey, normalizeEmail, normalizeText } from "@/lib/imports/normalize";

export type ResolvedLink = {
  id: string | null;
  reason: string;
  verdict: "MATCHED" | "NEEDS_REVIEW" | "MISSING";
};

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
  if (input.externalId) {
    const ref = await prisma.importExternalRef.findFirst({
      where: { companyId, recordType: "CUSTOMERS", externalId: input.externalId },
    });
    if (ref) return { id: ref.targetRecordId, reason: "Matched the source customer ID from an earlier import", verdict: "MATCHED" };
    const byExt = await prisma.customer.findFirst({
      where: { companyId, externalId: input.externalId },
      select: { id: true },
    });
    if (byExt) return { id: byExt.id, reason: "Matched customer source ID", verdict: "MATCHED" };
  }
  const email = normalizeEmail(input.email);
  if (email) {
    const hit = await prisma.customer.findFirst({ where: { companyId, email }, select: { id: true } });
    if (hit) return { id: hit.id, reason: "Matched customer email", verdict: "MATCHED" };
  }
  const phone = digitsOnly(input.phone);
  if (phone.length >= 10) {
    const customers = await prisma.customer.findMany({
      where: { companyId, phone: { not: null } },
      select: { id: true, phone: true },
      take: 4000,
    });
    const hit = customers.find((customer) => digitsOnly(customer.phone).slice(-10) === phone.slice(-10));
    if (hit) return { id: hit.id, reason: "Matched customer phone", verdict: "MATCHED" };
  }
  const display = normalizeText(input.name || `${input.firstName ?? ""} ${input.lastName ?? ""}`);
  if (display.length > 3 || input.businessName) {
    const customers = await prisma.customer.findMany({
      where: { companyId },
      select: { id: true, firstName: true, lastName: true, businessName: true },
      take: 4000,
    });
    const key = nameKey(input.firstName || display.split(" ")[0] || "", input.lastName || display.split(" ").slice(1).join(" "), input.businessName);
    const matches = customers.filter((customer) => nameKey(customer.firstName, customer.lastName, customer.businessName) === key);
    if (matches.length === 1) return { id: matches[0]!.id, reason: "Matched customer name", verdict: "MATCHED" };
    if (matches.length > 1) return { id: null, reason: "More than one customer has that name", verdict: "NEEDS_REVIEW" };
  }
  return { id: null, reason: "We could not match this row to a customer", verdict: "MISSING" };
}

export async function resolveProperty(
  prisma: PrismaClient,
  companyId: string,
  customerId: string | null,
  input: { externalId?: string | null; address?: string | null; city?: string | null; zip?: string | null }
): Promise<ResolvedLink> {
  if (input.externalId) {
    const ref = await prisma.importExternalRef.findFirst({
      where: { companyId, recordType: "PROPERTIES", externalId: input.externalId },
    });
    if (ref) return { id: ref.targetRecordId, reason: "Matched the source property ID", verdict: "MATCHED" };
  }
  if (customerId) {
    const properties = await prisma.property.findMany({
      where: { companyId, customerId },
    });
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

export async function resolveByExternalOrNumber(
  prisma: PrismaClient,
  companyId: string,
  kind: "JOBS" | "ESTIMATES" | "INVOICES",
  value?: string | null
): Promise<ResolvedLink> {
  if (!value) return { id: null, reason: `No ${kind.toLowerCase()} reference`, verdict: "MISSING" };
  const ref = await prisma.importExternalRef.findFirst({
    where: { companyId, recordType: kind, externalId: value },
  });
  if (ref) return { id: ref.targetRecordId, reason: `Matched source ${kind.toLowerCase()} ID`, verdict: "MATCHED" };
  if (kind === "JOBS") {
    const job = await prisma.job.findFirst({
      where: { companyId, OR: [{ externalId: value }, { jobNumber: value }] },
      select: { id: true },
    });
    if (job) return { id: job.id, reason: "Matched job number or source ID", verdict: "MATCHED" };
  }
  if (kind === "ESTIMATES") {
    const estimate = await prisma.estimate.findFirst({
      where: { companyId, OR: [{ externalId: value }, { estimateNumber: value }] },
      select: { id: true },
    });
    if (estimate) return { id: estimate.id, reason: "Matched estimate number or source ID", verdict: "MATCHED" };
  }
  if (kind === "INVOICES") {
    const invoice = await prisma.invoice.findFirst({
      where: { companyId, OR: [{ externalId: value }, { invoiceNumber: value }] },
      select: { id: true },
    });
    if (invoice) return { id: invoice.id, reason: "Matched invoice number or source ID", verdict: "MATCHED" };
  }
  return { id: null, reason: `We could not find that ${kind.toLowerCase().slice(0, -1)}`, verdict: "MISSING" };
}

export async function matchTeamMember(
  prisma: PrismaClient,
  companyId: string,
  name?: string | null
): Promise<{ userId: string | null; display: string | null }> {
  const text = normalizeText(name);
  if (!text) return { userId: null, display: null };
  const members = await prisma.membership.findMany({
    where: { companyId, status: "ACTIVE" },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const needle = text.toLowerCase();
  const hits = members.filter((member) => {
    const full = `${member.user.firstName} ${member.user.lastName}`.trim().toLowerCase();
    return full === needle || full.includes(needle) || needle.includes(full);
  });
  if (hits.length === 1) return { userId: hits[0]!.user.id, display: text };
  return { userId: null, display: text };
}
