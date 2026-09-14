import type { Prisma, PrismaClient } from "@prisma/client";
import { quickBooksReviewFingerprint } from "@/lib/quickbooks/analysis";
import { blockerLabel, normalizeReviewAddress } from "@/lib/quickbooks/customer-review-automation";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";
import { digitsOnly, normalizeEmail, normalizeText, splitFullName } from "@/lib/imports/normalize";

const UNRESOLVED = ["OPEN", "READY", "RE_REVIEW_REQUIRED", "FAILED"];
const RESOLVED = ["APPROVED", "IGNORED", "NOT_SAME", "RESOLVED"];

export const EXCEPTION_REASONS = [
  "ADDRESS_CONFLICT",
  "NAME_CONFLICT",
  "PHONE_MISSING",
  "OTHER",
  "MULTIPLE_CANDIDATES",
  "POSSIBLE_DUPLICATE",
] as const;

export type ExceptionResolution = "LINK" | "CREATE" | "NOT_DUPLICATE" | "IGNORE";

type QboAddress = {
  Line1?: string;
  Line2?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
};

type QboCustomer = {
  DisplayName?: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: QboAddress;
  ShipAddr?: QboAddress;
};

type Candidate = {
  id: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  properties: Array<{ id: string; address: string; city: string; state: string; zip: string; isPrimary: boolean }>;
};

export function exceptionPriority(blocker?: string | null) {
  const priority: Record<string, number> = {
    ADDRESS_CONFLICT: 1,
    NAME_CONFLICT: 2,
    PHONE_MISSING: 3,
    OTHER: 4,
    IDENTITY_CONFLICT: 4,
    MULTIPLE_CANDIDATES: 5,
    POSSIBLE_DUPLICATE: 6,
  };
  return priority[blocker || "OTHER"] ?? 4;
}

function textAddress(address?: QboAddress | null) {
  return [
    address?.Line1,
    address?.Line2,
    address?.City,
    address?.CountrySubDivisionCode,
    address?.PostalCode,
  ].filter(Boolean).join(", ");
}

function customerFingerprint(customer: Candidate) {
  return quickBooksReviewFingerprint({
    firstName: customer.firstName,
    lastName: customer.lastName,
    businessName: customer.businessName,
    phone: customer.phone,
    email: customer.email,
    properties: customer.properties
      .map(({ address, city, state, zip }) => ({ address, city, state, zip }))
      .sort((a, b) => `${a.address}|${a.city}|${a.state}|${a.zip}`.localeCompare(`${b.address}|${b.city}|${b.state}|${b.zip}`)),
  });
}

function phoneKey(value?: string | null) {
  const digits = digitsOnly(value || "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function nameKey(payload: QboCustomer) {
  const split = splitFullName(payload.DisplayName || `${payload.GivenName || ""} ${payload.FamilyName || ""}`);
  return normalizeText(`${payload.GivenName || split.firstName} ${payload.FamilyName || split.lastName}`).toLowerCase();
}

function candidateName(candidate: Candidate) {
  return candidate.businessName || `${candidate.firstName} ${candidate.lastName}`.trim();
}

function compareCandidate(payload: QboCustomer, candidate: Candidate) {
  const qboAddresses = [payload.BillAddr, payload.ShipAddr]
    .map((address) => normalizeReviewAddress({
      line1: address?.Line1,
      line2: address?.Line2,
      city: address?.City,
      zip: address?.PostalCode,
    }))
    .filter(Boolean);
  const propertyKeys = new Map(
    candidate.properties.map((property) => [
      normalizeReviewAddress({ line1: property.address, city: property.city, zip: property.zip }),
      property.id,
    ])
  );
  const matchingPropertyIds = [...new Set(qboAddresses.map((address) => propertyKeys.get(address)).filter((id): id is string => Boolean(id)))];
  const qboName = nameKey(payload);
  const localName = normalizeText(`${candidate.firstName} ${candidate.lastName}`).toLowerCase();
  const qboCompany = normalizeText(payload.CompanyName).toLowerCase();
  const localCompany = normalizeText(candidate.businessName).toLowerCase();
  const qboPhone = phoneKey(payload.PrimaryPhone?.FreeFormNumber);
  const localPhone = phoneKey(candidate.phone);
  const qboEmail = normalizeEmail(payload.PrimaryEmailAddr?.Address) || "";
  const localEmail = normalizeEmail(candidate.email) || "";
  const comparisons = [
    comparison("Name", payload.DisplayName || `${payload.GivenName || ""} ${payload.FamilyName || ""}`.trim(), `${candidate.firstName} ${candidate.lastName}`.trim(), qboName, localName),
    comparison("Company", payload.CompanyName, candidate.businessName, qboCompany, localCompany),
    comparison("Phone", payload.PrimaryPhone?.FreeFormNumber, candidate.phone, qboPhone, localPhone),
    comparison("Email", payload.PrimaryEmailAddr?.Address, candidate.email, qboEmail, localEmail),
    {
      field: "Address",
      quickBooks: textAddress(payload.ShipAddr) || textAddress(payload.BillAddr) || null,
      contractorYou: candidate.properties.map((property) => `${property.address}, ${property.city}, ${property.state} ${property.zip}`).join(" · ") || null,
      status: matchingPropertyIds.length ? "MATCH" as const : qboAddresses.length && propertyKeys.size ? "DIFFERENT" as const : "MISSING" as const,
    },
  ];
  const matchedFields = comparisons.filter((row) => row.status === "MATCH").map((row) => row.field);
  const differentFields = comparisons.filter((row) => row.status === "DIFFERENT").map((row) => row.field);
  return {
    id: candidate.id,
    name: candidateName(candidate),
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    company: candidate.businessName,
    phone: candidate.phone,
    email: candidate.email,
    properties: candidate.properties.map((property) => ({
      ...property,
      matching: matchingPropertyIds.includes(property.id),
    })),
    comparisons,
    matchedFields,
    differentFields,
    confidence: Math.min(99, matchedFields.length * 20 + (matchedFields.includes("Phone") || matchedFields.includes("Email") ? 15 : 0)),
    fingerprint: customerFingerprint(candidate),
  };
}

function comparison(
  field: string,
  quickBooks: string | null | undefined,
  contractorYou: string | null | undefined,
  qboNormalized: string,
  localNormalized: string
) {
  const status = qboNormalized && localNormalized
    ? qboNormalized === localNormalized ? "MATCH" as const : "DIFFERENT" as const
    : "MISSING" as const;
  return { field, quickBooks: quickBooks || null, contractorYou: contractorYou || null, status };
}

function candidateIds(row: { proposedInternalId: string | null; matchSignals: Prisma.JsonValue | null }) {
  const signals = row.matchSignals && typeof row.matchSignals === "object" && !Array.isArray(row.matchSignals)
    ? row.matchSignals as { candidateIds?: unknown }
    : null;
  const stored = Array.isArray(signals?.candidateIds) ? signals.candidateIds.map(String) : [];
  return [...new Set([row.proposedInternalId, ...stored].filter((id): id is string => Boolean(id)))];
}

export async function loadQuickBooksExceptionReview(
  prisma: PrismaClient,
  scope: QuickBooksScope,
  input: { reason?: string | null; skipped?: boolean; customerSearch?: string | null } = {}
) {
  const base = {
    companyId: scope.companyId,
    environment: scope.environment,
    realmId: scope.realmId,
    objectType: "CUSTOMER",
  } satisfies Prisma.QuickBooksImportReviewWhereInput;
  const unresolvedWhere = {
    ...base,
    status: { in: UNRESOLVED },
    safeAutoApprove: false,
  } satisfies Prisma.QuickBooksImportReviewWhereInput;
  const categoryWhere = input.reason && input.reason !== "ALL"
    ? { autoApprovalBlocker: input.reason }
    : {};
  const queueWhere = {
    ...unresolvedWhere,
    ...categoryWhere,
    ...(input.skipped ? { skippedAt: { not: null } } : {}),
  } satisfies Prisma.QuickBooksImportReviewWhereInput;

  const [queue, unresolved, resolvedExceptions, blockers, latestDecision] = await Promise.all([
    prisma.quickBooksImportReview.findMany({ where: queueWhere, take: 5_000 }),
    prisma.quickBooksImportReview.count({ where: unresolvedWhere }),
    prisma.quickBooksImportReview.count({ where: { ...base, status: { in: RESOLVED }, resolutionType: { not: null } } }),
    prisma.quickBooksImportReview.groupBy({
      by: ["autoApprovalBlocker"],
      where: unresolvedWhere,
      _count: { _all: true },
    }),
    prisma.quickBooksReviewDecision.findFirst({
      where: { companyId: scope.companyId, environment: scope.environment, realmId: scope.realmId, undoneAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, resolutionType: true, quickbooksId: true, createdAt: true },
    }),
  ]);
  queue.sort((a, b) =>
    Number(Boolean(a.skippedAt)) - Number(Boolean(b.skippedAt)) ||
    exceptionPriority(a.autoApprovalBlocker) - exceptionPriority(b.autoApprovalBlocker) ||
    b.confidenceScore - a.confidenceScore ||
    a.displayName.localeCompare(b.displayName)
  );
  const current = queue[0] ?? null;
  const ids = current ? candidateIds(current) : [];
  const search = input.customerSearch?.trim();
  const [storedCandidates, searchedCandidates] = await Promise.all([
    ids.length ? prisma.customer.findMany({
      where: { companyId: scope.companyId, id: { in: ids } },
      select: customerSelect,
    }) : Promise.resolve([]),
    search ? prisma.customer.findMany({
      where: {
        companyId: scope.companyId,
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { businessName: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
          { email: { contains: search, mode: "insensitive" } },
          { properties: { some: { address: { contains: search, mode: "insensitive" } } } },
        ],
      },
      select: customerSelect,
      take: 10,
    }) : Promise.resolve([]),
  ]);
  const payload = current ? current.payload as QboCustomer : null;
  const candidateById = new Map(storedCandidates.map((candidate) => [candidate.id, candidate]));
  const orderedCandidates = ids
    .map((id) => candidateById.get(id))
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .map((candidate) => compareCandidate(payload!, candidate))
    .sort((a, b) => b.confidence - a.confidence);
  const searched = searchedCandidates
    .filter((candidate) => !ids.includes(candidate.id))
    .map((candidate) => compareCandidate(payload!, candidate))
    .sort((a, b) => b.confidence - a.confidence);
  const total = unresolved + resolvedExceptions;

  return {
    total,
    resolved: resolvedExceptions,
    remaining: unresolved,
    percent: total ? Math.round((resolvedExceptions / total) * 100) : 100,
    blockerCounts: Object.fromEntries(blockers.map((row) => [row.autoApprovalBlocker || "OTHER", row._count._all])),
    latestDecision,
    current: current && payload ? {
      id: current.id,
      runId: current.runId,
      quickbooksId: current.quickbooksId,
      displayName: current.displayName,
      confidence: current.confidence,
      confidenceScore: current.confidenceScore,
      blocker: current.autoApprovalBlocker || "OTHER",
      blockerLabel: blockerLabel(current.autoApprovalBlocker),
      reason: current.reason,
      skipped: Boolean(current.skippedAt),
      qbo: {
        name: payload.DisplayName || `${payload.GivenName || ""} ${payload.FamilyName || ""}`.trim() || current.displayName,
        company: payload.CompanyName || null,
        phone: payload.PrimaryPhone?.FreeFormNumber || null,
        email: payload.PrimaryEmailAddr?.Address || null,
        billingAddress: textAddress(payload.BillAddr) || null,
        serviceAddress: textAddress(payload.ShipAddr) || null,
      },
      candidates: orderedCandidates,
      searchedCandidates: searched,
    } : null,
  };
}

const customerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  businessName: true,
  phone: true,
  email: true,
  properties: {
    select: { id: true, address: true, city: true, state: true, zip: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" as const }, { address: "asc" as const }],
  },
};

type ReviewState = {
  status: string;
  proposedAction: string;
  proposedInternalId: string | null;
  confidence: string;
  reason: string;
  resolutionType: string | null;
  sourceFingerprint: string | null;
  candidateFingerprint: string | null;
  reviewedAt: Date | null;
  reviewedById: string | null;
  skippedAt: Date | null;
};

function stateOf(review: ReviewState) {
  return {
    status: review.status,
    proposedAction: review.proposedAction,
    proposedInternalId: review.proposedInternalId,
    confidence: review.confidence,
    reason: review.reason,
    resolutionType: review.resolutionType,
    sourceFingerprint: review.sourceFingerprint,
    candidateFingerprint: review.candidateFingerprint,
    reviewedAt: review.reviewedAt?.toISOString() || null,
    reviewedById: review.reviewedById,
    skippedAt: review.skippedAt?.toISOString() || null,
  };
}

function stateMatches(review: ReviewState, state: ReturnType<typeof stateOf>) {
  return JSON.stringify(stateOf(review)) === JSON.stringify(state);
}

export async function resolveQuickBooksException(input: {
  prisma: PrismaClient;
  scope: QuickBooksScope;
  reviewId: string;
  resolution: ExceptionResolution;
  actorId: string;
  targetCustomerId?: string | null;
}) {
  return input.prisma.$transaction(async (tx) => {
    const review = await tx.quickBooksImportReview.findFirst({
      where: {
        id: input.reviewId,
        companyId: input.scope.companyId,
        environment: input.scope.environment,
        realmId: input.scope.realmId,
        objectType: "CUSTOMER",
        status: { in: UNRESOLVED },
        safeAutoApprove: false,
      },
    });
    if (!review) return { ok: false as const, error: "This exception was already resolved or is no longer current." };
    const sourceFingerprint = quickBooksReviewFingerprint(review.payload);
    let candidateFingerprint: string | null = null;
    if (input.resolution === "LINK") {
      if (!input.targetCustomerId) return { ok: false as const, error: "Choose a ContractorYou customer to link." };
      const candidate = await tx.customer.findFirst({
        where: { id: input.targetCustomerId, companyId: input.scope.companyId },
        select: customerSelect,
      });
      if (!candidate) return { ok: false as const, error: "That customer is not in this company." };
      candidateFingerprint = customerFingerprint(candidate);
    }
    const previousState = stateOf(review);
    const reviewedAt = new Date();
    const data = input.resolution === "LINK"
      ? {
          status: "APPROVED",
          proposedAction: "LINK",
          proposedInternalId: input.targetCustomerId!,
          resolutionType: "LINK",
          reason: "Owner linked this QuickBooks customer to the selected ContractorYou customer.",
        }
      : input.resolution === "IGNORE"
        ? {
            status: "IGNORED",
            proposedAction: "IGNORE",
            proposedInternalId: null,
            resolutionType: "IGNORE",
            reason: "Owner chose not to import this QuickBooks customer.",
          }
        : {
            status: "APPROVED",
            proposedAction: "CREATE",
            proposedInternalId: null,
            confidence: "NONE",
            resolutionType: input.resolution,
            reason: input.resolution === "NOT_DUPLICATE"
              ? "Owner confirmed this is not a duplicate and approved it as a new customer."
              : "Owner approved creating this QuickBooks customer as a new ContractorYou customer.",
          };
    const updated = await tx.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        ...data,
        sourceFingerprint,
        candidateFingerprint,
        reviewedAt,
        reviewedById: input.actorId,
        skippedAt: null,
      },
    });
    const resultingState = stateOf(updated);
    const decision = await tx.quickBooksReviewDecision.create({
      data: {
        companyId: input.scope.companyId,
        environment: input.scope.environment,
        realmId: input.scope.realmId,
        analysisRunId: review.runId,
        reviewId: review.id,
        quickbooksId: review.quickbooksId,
        resolutionType: input.resolution,
        selectedCustomerId: input.targetCustomerId || null,
        sourceFingerprint,
        candidateFingerprint,
        previousState,
        resultingState,
        actorId: input.actorId,
      },
    });
    return { ok: true as const, decisionId: decision.id, message: "Decision saved. No customer or QuickBooks record was changed." };
  });
}

export async function skipQuickBooksException(input: {
  prisma: PrismaClient;
  scope: QuickBooksScope;
  reviewId: string;
}) {
  const result = await input.prisma.quickBooksImportReview.updateMany({
    where: {
      id: input.reviewId,
      companyId: input.scope.companyId,
      environment: input.scope.environment,
      realmId: input.scope.realmId,
      objectType: "CUSTOMER",
      status: { in: UNRESOLVED },
      safeAutoApprove: false,
    },
    data: { skippedAt: new Date(), skipCount: { increment: 1 } },
  });
  return result.count
    ? { ok: true as const, message: "Skipped for later. This customer remains unresolved." }
    : { ok: false as const, error: "This exception is no longer unresolved." };
}

export async function undoLastQuickBooksExceptionDecision(input: {
  prisma: PrismaClient;
  scope: QuickBooksScope;
  actorId: string;
}) {
  return input.prisma.$transaction(async (tx) => {
    const decision = await tx.quickBooksReviewDecision.findFirst({
      where: {
        companyId: input.scope.companyId,
        environment: input.scope.environment,
        realmId: input.scope.realmId,
        undoneAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!decision) return { ok: false as const, error: "There is no review decision to undo." };
    const review = await tx.quickBooksImportReview.findFirst({
      where: { id: decision.reviewId, companyId: input.scope.companyId },
    });
    if (!review || !stateMatches(review, decision.resultingState as ReturnType<typeof stateOf>)) {
      return { ok: false as const, error: "The last decision cannot be undone because this review changed afterward." };
    }
    const previous = decision.previousState as ReturnType<typeof stateOf>;
    await tx.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        status: previous.status,
        proposedAction: previous.proposedAction,
        proposedInternalId: previous.proposedInternalId,
        confidence: previous.confidence,
        reason: previous.reason,
        resolutionType: previous.resolutionType,
        sourceFingerprint: previous.sourceFingerprint,
        candidateFingerprint: previous.candidateFingerprint,
        reviewedAt: previous.reviewedAt ? new Date(previous.reviewedAt) : null,
        reviewedById: previous.reviewedById,
        skippedAt: previous.skippedAt ? new Date(previous.skippedAt) : null,
      },
    });
    await tx.quickBooksReviewDecision.update({
      where: { id: decision.id },
      data: { undoneAt: new Date(), undoneById: input.actorId },
    });
    return { ok: true as const, message: "Last decision undone. The customer is back in the exception queue." };
  });
}

export async function flagQuickBooksMergeReview(input: {
  prisma: PrismaClient;
  scope: QuickBooksScope;
  reviewId: string;
  actorId: string;
  customerAId: string;
  customerBId: string;
}) {
  if (!input.customerAId || !input.customerBId || input.customerAId === input.customerBId) {
    return { ok: false as const, error: "Choose two different ContractorYou customers." };
  }
  const [review, count] = await Promise.all([
    input.prisma.quickBooksImportReview.findFirst({
      where: { id: input.reviewId, companyId: input.scope.companyId, environment: input.scope.environment, realmId: input.scope.realmId },
      select: { id: true, runId: true, payload: true },
    }),
    input.prisma.customer.count({
      where: { companyId: input.scope.companyId, id: { in: [input.customerAId, input.customerBId] } },
    }),
  ]);
  if (!review || count !== 2) return { ok: false as const, error: "Both customers must belong to this company." };
  const [customerAId, customerBId] = [input.customerAId, input.customerBId].sort();
  await input.prisma.quickBooksMergeReview.upsert({
    where: {
      companyId_environment_realmId_customerAId_customerBId: {
        companyId: input.scope.companyId,
        environment: input.scope.environment,
        realmId: input.scope.realmId,
        customerAId,
        customerBId,
      },
    },
    create: {
      companyId: input.scope.companyId,
      environment: input.scope.environment,
      realmId: input.scope.realmId,
      analysisRunId: review.runId,
      sourceReviewId: review.id,
      customerAId,
      customerBId,
      flaggedById: input.actorId,
      sourceFingerprint: quickBooksReviewFingerprint(review.payload),
    },
    update: { status: "OPEN", flaggedById: input.actorId, sourceReviewId: review.id },
  });
  return { ok: true as const, message: "Flagged for separate merge review. No customers were merged." };
}

export async function loadStageOneImportPreview(prisma: PrismaClient, scope: QuickBooksScope) {
  const base = {
    companyId: scope.companyId,
    environment: scope.environment,
    realmId: scope.realmId,
    objectType: "CUSTOMER",
  };
  const [total, link, create, ignore, unresolved] = await Promise.all([
    prisma.quickBooksImportReview.count({ where: base }),
    prisma.quickBooksImportReview.count({ where: { ...base, status: "APPROVED", proposedAction: "LINK" } }),
    prisma.quickBooksImportReview.count({ where: { ...base, status: "APPROVED", proposedAction: "CREATE" } }),
    prisma.quickBooksImportReview.count({ where: { ...base, status: "IGNORED", proposedAction: { in: ["IGNORE", "MARK_INACTIVE"] } } }),
    prisma.quickBooksImportReview.count({ where: { ...base, status: { in: UNRESOLVED } } }),
  ]);
  return {
    total,
    link,
    create,
    ignore,
    otherResolved: Math.max(0, total - link - create - ignore - unresolved),
    unresolved,
    reconciles: link + create + ignore + Math.max(0, total - link - create - ignore - unresolved) + unresolved === total,
  };
}
