import { prisma } from "@/lib/db";
import { jobAccessFilter } from "@/lib/tenant";
import type { CompanyRole } from "@prisma/client";

export function customerSearchWhere(companyId: string, raw: string) {
  const query = raw.trim();
  if (!query) return { companyId };
  const digits = query.replace(/\D/g, "");
  const tokens = query.split(/\s+/).filter(Boolean);
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
  ];
  if (tokens.length >= 2) {
    or.push({
      AND: [
        { firstName: { contains: tokens[0], mode: "insensitive" } },
        { lastName: { contains: tokens.slice(1).join(" "), mode: "insensitive" } },
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
        take: 1,
        orderBy: { isPrimary: "desc" },
        select: { address: true, city: true, state: true, zip: true },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: input.take ?? 12,
  });
}
