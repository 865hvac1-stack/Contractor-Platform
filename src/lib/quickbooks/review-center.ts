import type { Prisma, PrismaClient } from "@prisma/client";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";
import { customerFieldComparison } from "@/lib/quickbooks/analysis-classification";

type ReviewView = "review" | "duplicates" | "conflicts";

type CustomerPayload = {
  DisplayName?: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: Address;
  ShipAddr?: Address;
};

type Address = {
  Line1?: string;
  Line2?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
};

function addressText(address?: Address | null) {
  return [
    address?.Line1,
    address?.Line2,
    address?.City,
    address?.CountrySubDivisionCode,
    address?.PostalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function loadQuickBooksReviewRows(
  prisma: PrismaClient,
  scope: QuickBooksScope,
  input: {
    view: ReviewView;
    filter?: string | null;
    search?: string | null;
    page?: number;
    pageSize?: number;
    sort?: string | null;
    reason?: string | null;
    differences?: string | null;
    reviewed?: string | null;
    automation?: string | null;
  }
) {
  const filterMap: Record<string, string> = {
    exact: "EXACT",
    high: "HIGH",
    possible: "POSSIBLE",
    new: "NONE",
    conflict: "CONFLICT",
  };
  const pageSize = [25, 50, 100].includes(input.pageSize ?? 25) ? input.pageSize ?? 25 : 25;
  const page = Math.max(1, input.page ?? 1);
  const currentStatuses = ["OPEN", "READY", "APPROVED", "IGNORED", "NOT_SAME", "RESOLVED", "RE_REVIEW_REQUIRED", "FAILED"];
  const reviewedStatuses = ["APPROVED", "IGNORED", "NOT_SAME", "RESOLVED"];
  const where: Prisma.QuickBooksImportReviewWhereInput = {
      companyId: scope.companyId,
      environment: scope.environment,
      realmId: scope.realmId,
      status: { in: input.reviewed === "reviewed" ? reviewedStatuses : input.reviewed === "unreviewed" ? ["OPEN", "READY", "RE_REVIEW_REQUIRED", "FAILED"] : currentStatuses },
      ...(input.view === "review" ? { objectType: "CUSTOMER" } : {}),
      ...(input.view === "duplicates" ? { objectType: "CUSTOMER", confidence: "POSSIBLE" } : {}),
      ...(input.view === "conflicts"
        ? { OR: [{ confidence: "CONFLICT" }, { status: "FAILED" }] }
        : {}),
      ...(input.filter && filterMap[input.filter] ? { confidence: filterMap[input.filter] } : {}),
      ...(input.filter === "reviewed" ? { status: { in: reviewedStatuses } } : {}),
      ...(input.search ? { searchText: { contains: input.search.trim(), mode: "insensitive" } } : {}),
      ...(input.reason ? { reason: { contains: input.reason.trim(), mode: "insensitive" } } : {}),
      ...(input.differences === "yes" ? { differenceCount: { gt: 0 } } : {}),
      ...(input.differences === "no" ? { differenceCount: 0 } : {}),
      ...(input.automation === "eligible" ? { safeAutoApprove: true, status: "READY" } : {}),
      ...(input.automation === "blocked"
        ? { safeAutoApprove: false, status: { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED"] } }
        : {}),
      ...(input.automation === "missing_email" ? { autoApprovalBlocker: "EMAIL_MISSING" } : {}),
      ...(input.automation === "missing_phone" ? { autoApprovalBlocker: "PHONE_MISSING" } : {}),
      ...(input.automation === "shared_identifier"
        ? { autoApprovalBlocker: { in: ["PHONE_NOT_UNIQUE", "EMAIL_NOT_UNIQUE"] } }
        : {}),
      ...(input.automation === "identity_conflict"
        ? { autoApprovalBlocker: { in: ["IDENTITY_CONFLICT", "PHONE_EMAIL_RESOLVE_DIFFERENT_CUSTOMERS", "NAME_CONFLICT", "ADDRESS_CONFLICT"] } }
        : {}),
      ...(input.automation === "multiple" ? { autoApprovalBlocker: "MULTIPLE_CANDIDATES" } : {}),
      ...(input.automation === "possible" ? { confidence: "POSSIBLE" } : {}),
  };
  const orderBy: Prisma.QuickBooksImportReviewOrderByWithRelationInput[] =
    input.sort === "lowest"
      ? [{ confidenceScore: "asc" }, { displayName: "asc" }]
      : input.sort === "name"
        ? [{ displayName: "asc" }]
        : input.sort === "differences"
          ? [{ differenceCount: "desc" }, { confidenceScore: "desc" }]
          : [{ confidenceScore: "desc" }, { displayName: "asc" }];
  const customerScope = {
    companyId: scope.companyId,
    environment: scope.environment,
    realmId: scope.realmId,
    objectType: "CUSTOMER",
    status: { in: currentStatuses },
  } satisfies Prisma.QuickBooksImportReviewWhereInput;
  const [total, rows, all, exact, high, fresh, possible, reviewed, approvedExact, approvedHigh, approvedNew, resolvedPossible, safeExact, unsafeExact, safeHigh, safeNew] =
    await Promise.all([
      prisma.quickBooksImportReview.count({ where }),
      prisma.quickBooksImportReview.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.quickBooksImportReview.count({ where: customerScope }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "EXACT" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "HIGH" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "NONE" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "POSSIBLE" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, status: { in: reviewedStatuses } } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "EXACT", status: "APPROVED" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "HIGH", status: "APPROVED" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "NONE", status: "APPROVED" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "POSSIBLE", status: { in: reviewedStatuses } } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "EXACT", safeAutoApprove: true, status: "READY" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "EXACT", safeAutoApprove: false, status: { in: ["READY", "RE_REVIEW_REQUIRED"] } } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "HIGH", safeAutoApprove: true, status: "READY" } }),
      prisma.quickBooksImportReview.count({ where: { ...customerScope, confidence: "NONE", safeAutoApprove: true, status: "READY" } }),
    ]);
  const [tierRows, blockerRows, manualRequired] = await Promise.all([
    prisma.quickBooksImportReview.groupBy({
      by: ["autoApprovalTier", "confidence"],
      where: {
        ...customerScope,
        status: "READY",
        safeAutoApprove: true,
      },
      _count: { _all: true },
    }),
    prisma.quickBooksImportReview.groupBy({
      by: ["autoApprovalBlocker", "confidence"],
      where: {
        ...customerScope,
        status: { in: ["READY", "OPEN", "RE_REVIEW_REQUIRED"] },
        safeAutoApprove: false,
      },
      _count: { _all: true },
    }),
    prisma.quickBooksImportReview.count({
      where: {
        ...customerScope,
        status: { in: ["READY", "OPEN", "RE_REVIEW_REQUIRED"] },
        safeAutoApprove: false,
      },
    }),
  ]);
  const candidateIds = rows.flatMap((row) => {
    const signals =
      row.matchSignals && typeof row.matchSignals === "object" && !Array.isArray(row.matchSignals)
        ? (row.matchSignals as { candidateIds?: unknown })
        : null;
    return Array.isArray(signals?.candidateIds) ? signals.candidateIds.map(String) : [];
  });
  const customerIds = [
    ...new Set([
      ...rows.map((row) => row.proposedInternalId).filter((id): id is string => Boolean(id)),
      ...candidateIds,
    ]),
  ];
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { companyId: scope.companyId, id: { in: customerIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true,
          email: true,
          properties: { select: { address: true, city: true, state: true, zip: true }, take: 5 },
        },
      })
    : [];
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const presented = rows.map((row) => {
    const payload = row.payload as CustomerPayload;
    const customer = row.proposedInternalId ? customerById.get(row.proposedInternalId) ?? null : null;
    const qbo = {
      name: payload.DisplayName || `${payload.GivenName || ""} ${payload.FamilyName || ""}`.trim() || row.displayName,
      company: payload.CompanyName || null,
      phone: payload.PrimaryPhone?.FreeFormNumber || null,
      email: payload.PrimaryEmailAddr?.Address || null,
      billingAddress: addressText(payload.BillAddr) || null,
      serviceAddress: addressText(payload.ShipAddr) || null,
    };
    const contractorYou = customer
      ? {
          id: customer.id,
          name: `${customer.firstName} ${customer.lastName}`.trim(),
          company: customer.businessName,
          phone: customer.phone,
          email: customer.email,
          serviceAddress:
            customer.properties
              .map((property) => `${property.address}, ${property.city}, ${property.state} ${property.zip}`)
              .join(" · ") || null,
        }
      : null;
    const storedSignals =
      row.matchSignals && typeof row.matchSignals === "object" && !Array.isArray(row.matchSignals)
        ? (row.matchSignals as { matched?: unknown; differing?: unknown; conflictReasons?: unknown })
        : null;
    const comparison =
      row.objectType === "CUSTOMER" && customer
        ? customerFieldComparison(
            {
              displayName: payload.DisplayName,
              givenName: payload.GivenName,
              familyName: payload.FamilyName,
              companyName: payload.CompanyName,
              email: payload.PrimaryEmailAddr?.Address,
              phone: payload.PrimaryPhone?.FreeFormNumber,
              billingAddress: addressText(payload.BillAddr),
              serviceAddress: addressText(payload.ShipAddr),
            },
            customer
          )
        : { matched: [] as string[], differing: [] as string[] };
    return {
      ...row,
      qbo,
      contractorYou,
      candidates:
        Array.isArray((storedSignals as { candidateIds?: unknown } | null)?.candidateIds)
          ? ((storedSignals as { candidateIds: unknown[] }).candidateIds)
              .map((id) => customerById.get(String(id)))
              .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
              .map((candidate) => ({
                id: candidate.id,
                name: candidate.businessName || `${candidate.firstName} ${candidate.lastName}`.trim(),
                phone: candidate.phone,
                email: candidate.email,
                address:
                  candidate.properties
                    .map((property) => `${property.address}, ${property.city}, ${property.state} ${property.zip}`)
                    .join(" · ") || null,
              }))
          : [],
      matchedFields: Array.isArray(storedSignals?.matched)
        ? storedSignals.matched.map(String)
        : comparison.matched,
      differingFields: Array.isArray(storedSignals?.differing)
        ? storedSignals.differing.map(String)
        : comparison.differing,
      conflictReasons: Array.isArray(storedSignals?.conflictReasons)
        ? storedSignals.conflictReasons.map(String)
        : row.confidence === "CONFLICT"
          ? [row.reason]
          : [],
    };
  });
  return {
    rows: presented,
    total,
    page: Math.min(page, Math.max(1, Math.ceil(total / pageSize))),
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    from: total ? (page - 1) * pageSize + 1 : 0,
    to: Math.min(page * pageSize, total),
    counts: { all, exact, high, new: fresh, possible, reviewed },
    progress: {
      exact: { total: exact, approved: approvedExact, remaining: exact - approvedExact },
      high: { total: high, approved: approvedHigh, remaining: high - approvedHigh },
      new: { total: fresh, approved: approvedNew, remaining: fresh - approvedNew },
      possible: { total: possible, resolved: resolvedPossible, remaining: possible - resolvedPossible },
    },
    safeBulk: { exact: safeExact, unsafeExact, high: safeHigh, new: safeNew },
    automation: {
      tiers: Object.fromEntries(
        tierRows.map((row) => [
          `${row.confidence}:${row.autoApprovalTier || "NONE"}`,
          row._count._all,
        ])
      ),
      blockers: sumGroups(blockerRows, (row) => row.autoApprovalBlocker || "OTHER"),
      blockersByConfidence: sumGroups(
        blockerRows,
        (row) => `${row.confidence}:${row.autoApprovalBlocker || "OTHER"}`
      ),
      manualRequired,
      autoResolved: approvedExact + approvedHigh,
      safeNewApproved: approvedNew,
    },
  };
}

function sumGroups<T extends { _count: { _all: number } }>(
  rows: T[],
  key: (row: T) => string
) {
  return rows.reduce<Record<string, number>>((totals, row) => {
    const group = key(row);
    totals[group] = (totals[group] ?? 0) + row._count._all;
    return totals;
  }, {});
}
