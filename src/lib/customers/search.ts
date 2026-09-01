import { prisma } from "@/lib/db";
import { jobAccessFilter } from "@/lib/tenant";
import type { CompanyRole } from "@prisma/client";

export function customerSearchWhere(companyId: string, raw: string) {
  const query = raw.trim();
  if (!query) return { companyId };
  const digits = query.replace(/\D/g, "");
  const commaParts = query.split(",").map((part) => part.trim()).filter(Boolean);
  const tokens = query.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const or: Record<string, unknown>[] = [
    { firstName: { contains: query, mode: "insensitive" } },
    { lastName: { contains: query, mode: "insensitive" } },
    { businessName: { contains: query, mode: "insensitive" } },
    { email: { contains: query, mode: "insensitive" } },
    { phone: { contains: query, mode: "insensitive" } },
    {
      properties: {
        some: {
          companyId,
          OR: [
            { address: { contains: query, mode: "insensitive" } },
            { city: { contains: query, mode: "insensitive" } },
            { zip: { contains: query, mode: "insensitive" } },
          ],
        },
      },
    },
    {
      equipment: {
        some: {
          companyId,
          OR: [
            { model: { contains: query, mode: "insensitive" } },
            { serialNumber: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
          ],
        },
      },
    },
  ];
  if (tokens.length >= 2) {
    or.push({
      AND: [
        { firstName: { contains: tokens[0], mode: "insensitive" } },
        { lastName: { contains: tokens.slice(1).join(" "), mode: "insensitive" } },
      ],
    });
    or.push({
      AND: [
        { lastName: { contains: tokens[0], mode: "insensitive" } },
        { firstName: { contains: tokens.slice(1).join(" "), mode: "insensitive" } },
      ],
    });
  }
  if (commaParts.length >= 2) {
    or.push({
      AND: [
        { lastName: { contains: commaParts[0], mode: "insensitive" } },
        { firstName: { contains: commaParts.slice(1).join(" "), mode: "insensitive" } },
      ],
    });
  }
  if (digits.length >= 3) {
    or.push({ phone: { contains: digits } });
  }
  return { companyId, OR: or };
}

export async function searchCustomers(input: {
  companyId: string;
  role: CompanyRole;
  userId: string;
  query: string;
  take?: number;
}) {
  const access = jobAccessFilter(input.role, input.userId);
  const assignedOnly = Boolean(access.assignments);
  return prisma.customer.findMany({
    where: {
      ...customerSearchWhere(input.companyId, input.query),
      ...(assignedOnly
        ? { jobs: { some: { companyId: input.companyId, ...access } } }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      phone: true,
      email: true,
      properties: {
        take: 8,
        orderBy: [{ isPrimary: "desc" }, { address: "asc" }],
        select: { id: true, name: true, address: true, city: true, state: true, zip: true },
      },
      estimates: {
        where: { status: { in: ["SENT", "VIEWED"] } },
        orderBy: { totalCents: "desc" },
        take: 1,
        select: { id: true, totalCents: true, estimateNumber: true },
      },
      customerMemberships: {
        where: { status: "ACTIVE" },
        take: 1,
        select: { id: true, plan: { select: { name: true } } },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: input.take ?? 12,
  });
}
