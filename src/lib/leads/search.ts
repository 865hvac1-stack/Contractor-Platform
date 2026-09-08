import type { LeadSource, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LEAD_SOURCES, LEAD_STATUSES } from "@/lib/leads/sources";

export const LEAD_PAGE_SIZE = 25;

export type LeadListFilters = {
  q?: string;
  status?: string;
  source?: string;
  assigned?: string;
  age?: string;
  followUp?: string;
  needsResponse?: string;
  page?: string;
};

export function parseLeadStatus(value?: string): LeadStatus | undefined {
  return LEAD_STATUSES.includes(value as LeadStatus) ? (value as LeadStatus) : undefined;
}

export function parseLeadSource(value?: string): LeadSource | undefined {
  return LEAD_SOURCES.includes(value as LeadSource) ? (value as LeadSource) : undefined;
}

export function leadSearchWhere(companyId: string, raw: string): Prisma.LeadWhereInput {
  const query = raw.trim();
  if (!query) return { companyId };
  const digits = query.replace(/\D/g, "");
  const tokens = query.split(/\s+/).filter(Boolean);
  const or: Prisma.LeadWhereInput[] = [
    { firstName: { contains: query, mode: "insensitive" } },
    { lastName: { contains: query, mode: "insensitive" } },
    { email: { contains: query, mode: "insensitive" } },
    { phone: { contains: query, mode: "insensitive" } },
    { customer: { is: { companyId, businessName: { contains: query, mode: "insensitive" } } } },
  ];
  if (tokens.length >= 2) {
    or.push({
      AND: [
        { firstName: { contains: tokens[0], mode: "insensitive" } },
        { lastName: { contains: tokens.slice(1).join(" "), mode: "insensitive" } },
      ],
    });
  }
  for (const token of tokens) {
    if (token.length < 2) continue;
    or.push({ firstName: { contains: token, mode: "insensitive" } });
    or.push({ lastName: { contains: token, mode: "insensitive" } });
  }
  if (digits.length >= 3) {
    or.push({ phone: { contains: digits } });
    if (digits.length >= 10) or.push({ phone: { contains: digits.slice(-10) } });
  }
  return { companyId, OR: or };
}

function ageCutoff(age?: string, now = new Date()) {
  const days = age === "1" ? 1 : age === "3" ? 3 : age === "7" ? 7 : age === "14" ? 14 : null;
  if (!days) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function leadListWhere(companyId: string, filters: LeadListFilters, now = new Date()): Prisma.LeadWhereInput {
  const query = filters.q?.trim() || "";
  const status = parseLeadStatus(filters.status);
  const source = parseLeadSource(filters.source);
  const assigned = filters.assigned?.trim() || "";
  const unanswered = filters.needsResponse === "1";
  const followUp = filters.followUp === "1";
  const receivedBefore = ageCutoff(filters.age, now);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const where: Prisma.LeadWhereInput = {
    ...(query ? leadSearchWhere(companyId, query) : { companyId }),
    ...(source ? { source } : {}),
    ...(assigned === "unassigned"
      ? { assignedUserId: null }
      : assigned
        ? { assignedUserId: assigned }
        : {}),
    ...(receivedBefore ? { receivedAt: { lte: receivedBefore } } : {}),
  };

  if (unanswered) {
    where.firstRespondedAt = null;
    where.status = { in: ["NEW", "CONTACTED"] };
  } else if (status) {
    where.status = status;
  }

  if (followUp) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { status: { notIn: ["WON", "LOST", "SPAM"] } },
      {
        OR: [
          { firstRespondedAt: null, lastContactAt: null, status: { in: ["NEW", "CONTACTED"] } },
          { nextActionAt: { lt: now }, status: { notIn: ["WON", "LOST", "SPAM"] } },
          {
            status: "ESTIMATE_SENT",
            OR: [{ lastContactAt: null }, { lastContactAt: { lte: twoDaysAgo } }],
          },
        ],
      },
    ];
  }

  return where;
}

export async function searchLeads(companyId: string, filters: LeadListFilters) {
  const page = Math.max(1, Number.parseInt(filters.page || "1", 10) || 1);
  const where = leadListWhere(companyId, filters);
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            businessName: true,
          },
        },
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        estimate: { select: { id: true, estimateNumber: true, status: true, totalCents: true } },
      },
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * LEAD_PAGE_SIZE,
      take: LEAD_PAGE_SIZE,
    }),
  ]);

  return {
    leads,
    total,
    page,
    pageSize: LEAD_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / LEAD_PAGE_SIZE)),
  };
}

export function leadListHref(filters: LeadListFilters, page?: number) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (parseLeadStatus(filters.status)) params.set("status", filters.status!);
  if (parseLeadSource(filters.source)) params.set("source", filters.source!);
  if (filters.assigned?.trim()) params.set("assigned", filters.assigned.trim());
  if (filters.age === "1" || filters.age === "3" || filters.age === "7" || filters.age === "14") {
    params.set("age", filters.age);
  }
  if (filters.followUp === "1") params.set("followUp", "1");
  if (filters.needsResponse === "1") params.set("needsResponse", "1");
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/marketing/leads?${query}` : "/marketing/leads";
}
