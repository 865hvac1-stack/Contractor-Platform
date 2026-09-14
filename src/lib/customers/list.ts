import type { MaintenanceVisitStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canonicalizeUsPhone } from "@/lib/phone";
import { startOfMonth } from "date-fns";

export const CUSTOMERS_PAGE_SIZE = 25;

export type CustomerListView =
  | "recent"
  | "attention"
  | "all"
  | "maintenance-due"
  | "open-estimates"
  | "balances-due"
  | "new-this-month";

const CUSTOMER_VIEWS = new Set<CustomerListView>([
  "recent",
  "attention",
  "all",
  "maintenance-due",
  "open-estimates",
  "balances-due",
  "new-this-month",
]);
const MAINTENANCE_DUE: MaintenanceVisitStatus[] = ["DUE_SOON", "UNSCHEDULED", "OVERDUE", "NEEDS_RESCHEDULE"];

const customerAttentionWhere: Prisma.CustomerWhereInput = {
  OR: [
    { waitingRecords: { some: { state: "ACTIVE" } } },
    { invoices: { some: { status: { in: ["OVERDUE", "SENT", "PARTIALLY_PAID"] }, balanceCents: { gt: 0 } } } },
    { estimates: { some: { status: { in: ["SENT", "VIEWED"] } } } },
    { maintenanceVisits: { some: { status: { in: MAINTENANCE_DUE } } } },
    { communicationThreads: { some: { unread: true } } },
  ],
};

export function parseCustomerListQuery(input: { q?: string; view?: string; page?: string }) {
  const page = Number(input.page || "1");
  const view = CUSTOMER_VIEWS.has(input.view as CustomerListView) ? (input.view as CustomerListView) : "recent";
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
                  { zip: { contains: q, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      }
    : null;

  const viewFilter: Prisma.CustomerWhereInput | null =
    view === "attention"
      ? customerAttentionWhere
      : view === "maintenance-due"
        ? { maintenanceVisits: { some: { status: { in: MAINTENANCE_DUE } } } }
        : view === "open-estimates"
          ? { estimates: { some: { status: { in: ["SENT", "VIEWED"] } } } }
          : view === "balances-due"
            ? { invoices: { some: { status: { in: ["OVERDUE", "SENT", "PARTIALLY_PAID"] }, balanceCents: { gt: 0 } } } }
            : view === "new-this-month"
              ? { createdAt: { gte: startOfMonth(new Date()) } }
              : null;

  return {
    companyId,
    ...(search && viewFilter ? { AND: [search, viewFilter] } : search ?? viewFilter ?? {}),
  };
}

export async function loadCustomerList(companyId: string, input: { q?: string; view?: string; page?: string }) {
  const query = parseCustomerListQuery(input);
  const where = customerSearchWhere(companyId, query.q, query.view);
  const skip = (query.page - 1) * CUSTOMERS_PAGE_SIZE;
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    query.view === "all" ? [{ lastName: "asc" }, { firstName: "asc" }] : [{ updatedAt: "desc" }];

  const [total, customers, summary] = await Promise.all([
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
        properties: { select: { id: true, city: true, address: true, zip: true, isPrimary: true }, take: 10, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        waitingRecords: { where: { state: "ACTIVE" }, select: { id: true }, take: 1 },
        invoices: { where: { status: { in: ["OVERDUE", "SENT", "PARTIALLY_PAID"] }, balanceCents: { gt: 0 } }, select: { balanceCents: true }, take: 1 },
        estimates: { where: { status: { in: ["SENT", "VIEWED"] } }, select: { id: true }, take: 1 },
        maintenanceVisits: { where: { status: { in: MAINTENANCE_DUE } }, select: { id: true }, take: 1 },
        communicationThreads: { where: { unread: true }, select: { id: true }, take: 1 },
      },
    }),
    loadCustomerOperationsSummary(companyId),
  ]);

  return {
    query,
    total,
    pages: Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE)),
    customers: customers.map((customer) => {
      const needle = query.q.toLowerCase();
      const matchedProperty = needle
        ? customer.properties.find((property) =>
            `${property.address} ${property.city} ${property.zip}`.toLowerCase().includes(needle)
          )
        : null;
      return { ...customer, matchedPropertyId: matchedProperty?.id ?? null, displayProperty: matchedProperty ?? customer.properties[0] ?? null };
    }),
    summary,
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

export async function loadCustomerOperationsSummary(companyId: string) {
  const base = { companyId };
  const [total, needsAttention, maintenanceDue, openEstimates, balancesDue, newThisMonth] = await Promise.all([
    prisma.customer.count({ where: base }),
    prisma.customer.count({ where: { ...base, ...customerAttentionWhere } }),
    prisma.customer.count({ where: { ...base, maintenanceVisits: { some: { status: { in: MAINTENANCE_DUE } } } } }),
    prisma.customer.count({ where: { ...base, estimates: { some: { status: { in: ["SENT", "VIEWED"] } } } } }),
    prisma.customer.count({
      where: { ...base, invoices: { some: { status: { in: ["OVERDUE", "SENT", "PARTIALLY_PAID"] }, balanceCents: { gt: 0 } } } },
    }),
    prisma.customer.count({ where: { ...base, createdAt: { gte: startOfMonth(new Date()) } } }),
  ]);
  return { total, needsAttention, maintenanceDue, openEstimates, balancesDue, newThisMonth };
}
