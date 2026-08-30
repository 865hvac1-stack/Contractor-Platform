import { prisma } from "@/lib/db";

function normalizePhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function normalizeEmail(email?: string | null) {
  const v = email?.trim().toLowerCase();
  return v || null;
}

/**
 * Deduplicate against existing customers in THIS company only.
 * Never search across tenants.
 */
export async function matchCustomerForLead(
  companyId: string,
  input: { email?: string | null; phone?: string | null }
) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  if (email) {
    const byEmail = await prisma.customer.findFirst({
      where: { companyId, email: { equals: email, mode: "insensitive" } },
    });
    if (byEmail) return { customer: byEmail, matchedOn: "email" as const };
  }

  if (phone) {
    const candidates = await prisma.customer.findMany({
      where: { companyId, OR: [{ phone: { not: null } }, { secondaryPhone: { not: null } }] },
      take: 500,
    });
    const hit = candidates.find((c) => {
      return normalizePhone(c.phone) === phone || normalizePhone(c.secondaryPhone) === phone;
    });
    if (hit) return { customer: hit, matchedOn: "phone" as const };
  }

  return null;
}

export async function findDuplicateLead(
  companyId: string,
  input: { email?: string | null; phone?: string | null; sinceHours?: number }
) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const since = new Date();
  since.setHours(since.getHours() - (input.sinceHours ?? 72));

  if (!email && !phone) return null;

  const recent = await prisma.lead.findMany({
    where: {
      companyId,
      receivedAt: { gte: since },
      status: { notIn: ["LOST", "SPAM"] },
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });

  return (
    recent.find((lead) => {
      if (email && normalizeEmail(lead.email) === email) return true;
      if (phone && normalizePhone(lead.phone) === phone) return true;
      return false;
    }) ?? null
  );
}
