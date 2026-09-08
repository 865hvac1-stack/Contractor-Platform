import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canonicalizeUsPhone } from "@/lib/phone";

export const CUSTOMERS_PAGE_SIZE = 25;

export type CustomerListView = "recent" | "attention" | "all";

export function parseCustomerListQuery(input: { q?: string; view?: string; page?: string }) {
  const page = Number(input.page || "1");
  const view = input.view === "attention" || input.view === "all" ? input.view : "recent";
  return {
    q: input.q?.trim() || "",
    view: view as CustomerListView,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

export function customerSearchWhere(companyId: string, q: string, view: CustomerListView): Prisma.CustomerWhereInput {
  const digits = q.replace(/\D/g, "");
  const canonical = canonicalizeUsPhone(q);
  const search: Prisma.CustomerWhereInput | null = q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { businessName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { secondaryPhone: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }, { secondaryPhone: { contains: digits } }] : []),
          ...(canonical ? [{ phone: { contains: canonical } }, { secondaryPhone: { contains: canonical } }] : []),
          ...(q.split(/\s+/).filter((token) => token.length >= 2).length >= 2
            ? [
                {
                  AND: [
                    { firstName: { contains: q.split(/\s+/)[0], mode: "insensitive" as const } },
                    { lastName: { contains: q.split(/\s+/).slice(1).join(" "), mode: "insensitive" as const } },
                  ],
                },
              ]
            : []),
          {
            properties: {
              some: {
                OR: [
                  { address: { contains: q, mode: "insensitive" } },
                  { city: { contains: q, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      }
    : null;

  const attention: Prisma.CustomerWhereInput | null =
    view === "attention"
      ? {
          OR: [
            { waitingRecords: { some: { state: "ACTIVE" } } },
            { invoices: { some: { status: "OVERDUE", balanceCents: { gt: 0 } } } },
            { estimates: { some: { status: { in: ["SENT", "VIEWED"] } } } },
          ],
        }
      : null;

  return {
    companyId,
    ...(search ?? {}),
    ...(attention ?? {}),
  };
}

export async function loadCustomerList(companyId: string, input: { q?: string; view?: string; page?: string }) {
  const query = parseCustomerListQuery(input);
  const where = customerSearchWhere(companyId, query.q, query.view);
  const skip = (query.page - 1) * CUSTOMERS_PAGE_SIZE;
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    query.view === "all" ? [{ lastName: "asc" }, { firstName: "asc" }] : [{ updatedAt: "desc" }];

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy,
      skip,
      take: CUSTOMERS_PAGE_SIZE,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        phone: true,
        email: true,
        status: true,
        updatedAt: true,
        properties: { select: { city: true, address: true }, take: 1, orderBy: { createdAt: "asc" } },
      },
    }),
  ]);

  return {
    query,
    total,
    pages: Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE)),
    customers,
  };
}

export function customersListHref(query: { q?: string; view?: string; page?: number }, page = query.page ?? 1) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.view && query.view !== "recent") params.set("view", query.view);
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/customers?${text}` : "/customers";
}
