import type { Prisma, PrismaClient } from "@prisma/client";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";
import { mappingScopeWhere } from "@/lib/quickbooks/ownership";
import { buildInboundCustomerIndex, classifyInboundCustomer } from "@/lib/quickbooks/inbound-match";
import { quickBooksReviewFingerprint } from "@/lib/quickbooks/analysis";
import {
  buildAutoApprovalUniverse,
  evaluateCustomerAutoApproval,
} from "@/lib/quickbooks/customer-review-automation";

export type ReviewDecision =
  | "APPROVE"
  | "APPROVE_NEW"
  | "LINK"
  | "CREATE"
  | "MERGE"
  | "IGNORE"
  | "NOT_DUPLICATE"
  | "NOT_SAME"
  | "MANUAL_REVIEW"
  | "MOVE_DUPLICATE"
  | "MARK_INACTIVE";

export async function applyQuickBooksReviewDecision(input: {
  prisma: PrismaClient;
  companyId: string;
  scope: QuickBooksScope;
  reviewId: string;
  action: ReviewDecision;
  targetCustomerId?: string | null;
  actorId: string;
  confirmation?: string | null;
}) {
  const review = await input.prisma.quickBooksImportReview.findFirst({
    where: {
      id: input.reviewId,
      companyId: input.companyId,
      environment: input.scope.environment,
      realmId: input.scope.realmId,
    },
  });
  if (!review) return { ok: false as const, error: "Review item not found for this QuickBooks company." };
  const reviewed = { reviewedAt: new Date(), reviewedById: input.actorId };

  if (input.action === "APPROVE") {
    if (
      review.objectType !== "CUSTOMER" ||
      !review.proposedInternalId ||
      !["EXACT", "HIGH"].includes(review.confidence)
    ) {
      return { ok: false as const, error: "Only a proposed exact or high-confidence customer mapping can be approved." };
    }
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: { status: "APPROVED", proposedAction: "LINK", ...reviewed },
    });
    return { ok: true as const, message: "Proposed mapping approved. No customer data was changed." };
  }

  if (input.action === "APPROVE_NEW") {
    if (review.objectType !== "CUSTOMER" || review.confidence !== "NONE") {
      return { ok: false as const, error: "Only a customer classified as new can be approved as new." };
    }
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: { status: "APPROVED", proposedAction: "CREATE", proposedInternalId: null, ...reviewed },
    });
    return { ok: true as const, message: "New-customer plan approved. No customer was created." };
  }

  if (input.action === "LINK") {
    if (!input.targetCustomerId) return { ok: false as const, error: "Choose an existing ContractorYou customer to link." };
    const customer = await input.prisma.customer.findFirst({
      where: { id: input.targetCustomerId, companyId: input.companyId },
      select: { id: true },
    });
    if (!customer) return { ok: false as const, error: "That customer is not in this company." };
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        proposedAction: "LINK",
        proposedInternalId: customer.id,
        status: "APPROVED",
        confidence: "HIGH",
        reason: "Owner linked this QuickBooks record to an existing ContractorYou customer.",
        ...reviewed,
      },
    });
    return { ok: true as const, message: "Queued to link on the next approved import." };
  }

  if (input.action === "CREATE") {
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        proposedAction: "CREATE",
        proposedInternalId: null,
        status: "APPROVED",
        confidence: "NONE",
        reason: "Owner approved creating a new ContractorYou customer.",
        ...reviewed,
      },
    });
    return { ok: true as const, message: "Queued to create on the next approved import." };
  }

  if (input.action === "MERGE") {
    if (!input.targetCustomerId) return { ok: false as const, error: "Choose the surviving ContractorYou customer." };
    if (input.confirmation !== "REVIEW MERGE MAPPING") {
      return { ok: false as const, error: "Type REVIEW MERGE MAPPING to confirm this proposed mapping. No records will be merged yet." };
    }
    const target = await input.prisma.customer.findFirst({
      where: { id: input.targetCustomerId, companyId: input.companyId },
      select: { id: true },
    });
    if (!target) return { ok: false as const, error: "The surviving customer is not in this company." };
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        proposedAction: "LINK",
        proposedInternalId: input.targetCustomerId,
        status: "APPROVED",
        reason: "Owner approved a merge onto the selected customer. Duplicate QuickBooks identity will link, not clone.",
        ...reviewed,
      },
    });
    return { ok: true as const, message: "Merge queued as a link. Records are not deleted." };
  }

  if (input.action === "IGNORE") {
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: { proposedAction: "IGNORE", status: "IGNORED", ...reviewed },
    });
    return { ok: true as const, message: "QuickBooks record will be skipped." };
  }

  if (input.action === "NOT_DUPLICATE") {
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        proposedAction: "CREATE",
        proposedInternalId: null,
        status: "APPROVED",
        confidence: "NONE",
        reason: "Owner marked this as not a duplicate.",
        ...reviewed,
      },
    });
    return { ok: true as const, message: "Marked not duplicate. A new customer can be created on import." };
  }

  if (input.action === "NOT_SAME" || input.action === "MANUAL_REVIEW") {
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        proposedAction: "REVIEW",
        status: "OPEN",
        safeAutoApprove: false,
        confidence: input.action === "NOT_SAME" ? "POSSIBLE" : review.confidence,
        reason:
          input.action === "NOT_SAME"
            ? "Owner marked the proposed ContractorYou customer as not the same customer."
            : "Owner moved this proposal to manual review.",
        reviewedAt: null,
        reviewedById: null,
      },
    });
    return { ok: true as const, message: "Moved to manual review. No customer data was changed." };
  }

  if (input.action === "MOVE_DUPLICATE") {
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        proposedAction: "REVIEW",
        status: "OPEN",
        confidence: "POSSIBLE",
        safeAutoApprove: false,
        reason: "Owner moved this new-customer proposal to possible duplicates.",
        reviewedAt: null,
        reviewedById: null,
      },
    });
    return { ok: true as const, message: "Moved to possible duplicates. No customer data was changed." };
  }

  await input.prisma.quickBooksImportReview.update({
    where: { id: review.id },
    data: { proposedAction: "MARK_INACTIVE", status: "IGNORED", ...reviewed },
  });
  return { ok: true as const, message: "Marked inactive and skipped." };
}

export type BulkReviewAction =
  | "APPROVE_SELECTED"
  | "NOT_SAME_SELECTED"
  | "MANUAL_SELECTED"
  | "APPROVE_SAFE_EXACT"
  | "APPROVE_SAFE_HIGH"
  | "APPROVE_SAFE_NEW";

type CustomerReviewRow = Awaited<
  ReturnType<PrismaClient["quickBooksImportReview"]["findMany"]>
>[number];

async function revalidateCustomerPlans(
  prisma: PrismaClient,
  scope: QuickBooksScope,
  rows: CustomerReviewRow[]
) {
  const [customers, mappings] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: scope.companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        email: true,
        phone: true,
        sourceSystem: true,
        externalId: true,
        quickbooksCustomerId: true,
        properties: { select: { address: true, city: true, zip: true } },
      },
    }),
    prisma.quickBooksMapping.findMany({
      where: { ...mappingScopeWhere(scope), entityType: "CUSTOMER" },
      select: { internalId: true, quickbooksId: true },
    }),
  ]);
  const index = buildInboundCustomerIndex(
    customers.map((customer) => ({
      ...customer,
      externalId: customer.quickbooksCustomerId || customer.externalId,
    })),
    mappings.map((mapping) => ({
      customerId: mapping.internalId,
      quickbooksId: mapping.quickbooksId,
    }))
  );
  const universe = buildAutoApprovalUniverse(
    customers,
    mappings.map((mapping) => ({
      customerId: mapping.internalId,
      quickbooksId: mapping.quickbooksId,
    }))
  );
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const mappingByQbo = new Map(mappings.map((mapping) => [mapping.quickbooksId, mapping.internalId]));
  const safeExact: string[] = [];
  const safeHigh: string[] = [];
  const safeNew: string[] = [];
  const excluded: string[] = [];
  const blockers = new Map<string, string>();

  for (const row of rows) {
    if (row.status !== "READY" || !row.reviewFingerprint || row.runId == null || !row.quickbooksId) {
      excluded.push(row.id);
      blockers.set(row.id, !row.reviewFingerprint ? "STALE_FINGERPRINT" : "OTHER");
      continue;
    }
    const payload = row.payload as {
      DisplayName?: string;
      GivenName?: string;
      FamilyName?: string;
      CompanyName?: string;
      PrimaryEmailAddr?: { Address?: string };
      PrimaryPhone?: { FreeFormNumber?: string };
      BillAddr?: { Line1?: string; Line2?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string };
      ShipAddr?: { Line1?: string; Line2?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string };
    };
    const match = classifyInboundCustomer(
      index,
      {
        quickbooksId: row.quickbooksId,
        displayName: payload.DisplayName,
        givenName: payload.GivenName,
        familyName: payload.FamilyName,
        companyName: payload.CompanyName,
        email: payload.PrimaryEmailAddr?.Address,
        phone: payload.PrimaryPhone?.FreeFormNumber,
        billAddr: payload.BillAddr,
        shipAddr: payload.ShipAddr,
      },
      mappingByQbo.get(row.quickbooksId)
    );
    const candidate = row.proposedInternalId ? customerById.get(row.proposedInternalId) : null;
    const storedSignals =
      row.matchSignals && typeof row.matchSignals === "object" && !Array.isArray(row.matchSignals)
        ? (row.matchSignals as { contractorYouSnapshot?: unknown })
        : null;
    const currentSnapshot = candidate
      ? {
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          businessName: candidate.businessName,
          email: candidate.email,
          phone: candidate.phone,
          properties: candidate.properties,
        }
      : null;
    const candidateUnchanged =
      row.confidence === "NONE"
        ? true
        : Boolean(storedSignals?.contractorYouSnapshot) &&
          quickBooksReviewFingerprint(storedSignals?.contractorYouSnapshot) ===
            quickBooksReviewFingerprint(currentSnapshot);
    const automation = evaluateCustomerAutoApproval({
      probe: {
        quickbooksId: row.quickbooksId,
        displayName: payload.DisplayName,
        givenName: payload.GivenName,
        familyName: payload.FamilyName,
        companyName: payload.CompanyName,
        email: payload.PrimaryEmailAddr?.Address,
        phone: payload.PrimaryPhone?.FreeFormNumber,
        billAddr: payload.BillAddr,
        shipAddr: payload.ShipAddr,
      },
      match,
      universe,
      fingerprintFresh: true,
      candidateUnchanged,
    });
    if (
      automation.eligible &&
      row.safeAutoApprove &&
      match.customerId === row.proposedInternalId
    ) {
      if (row.confidence === "EXACT") safeExact.push(row.id);
      else if (row.confidence === "HIGH") safeHigh.push(row.id);
      else if (row.confidence === "NONE") safeNew.push(row.id);
      else excluded.push(row.id);
    } else {
      excluded.push(row.id);
      blockers.set(row.id, automation.blocker || "OTHER");
    }
  }
  return { safeExact, safeHigh, safeNew, excluded, blockers };
}

export async function bulkQuickBooksReviewDecision(input: {
  prisma: PrismaClient;
  companyId: string;
  scope: QuickBooksScope;
  actorId: string;
  action: BulkReviewAction;
  selectedIds: string[];
  selectionMode: "NONE" | "PAGE" | "ALL_FILTERED";
  analysisRunId: string;
  confidenceFilter?: string | null;
  search?: string | null;
  reason?: string | null;
  differences?: string | null;
  reviewed?: string | null;
  automation?: string | null;
}) {
  const allowedActions: BulkReviewAction[] = [
    "APPROVE_SELECTED",
    "NOT_SAME_SELECTED",
    "MANUAL_SELECTED",
    "APPROVE_SAFE_EXACT",
    "APPROVE_SAFE_HIGH",
    "APPROVE_SAFE_NEW",
  ];
  if (!allowedActions.includes(input.action)) {
    return { ok: false as const, error: "Choose a valid bulk review action." };
  }
  const latestAnalysis = await input.prisma.quickBooksSyncRun.findFirst({
    where: {
      companyId: input.companyId,
      environment: input.scope.environment,
      realmId: input.scope.realmId,
      type: "ANALYSIS",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, writeBackAttempted: true },
  });
  if (
    !latestAnalysis ||
    latestAnalysis.id !== input.analysisRunId ||
    latestAnalysis.status !== "COMPLETE" ||
    latestAnalysis.writeBackAttempted
  ) {
    return {
      ok: false as const,
      error: "The analysis changed or is incomplete. Refresh Review Matches before approving anything.",
    };
  }
  const scopeBase: Prisma.QuickBooksImportReviewWhereInput = {
    companyId: input.companyId,
    environment: input.scope.environment,
    realmId: input.scope.realmId,
    objectType: "CUSTOMER",
    runId: input.analysisRunId,
  };
  const eligibleBase: Prisma.QuickBooksImportReviewWhereInput = {
    ...scopeBase,
    status: { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED"] },
  };
  const selectionBase: Prisma.QuickBooksImportReviewWhereInput = {
    ...scopeBase,
    status:
      input.reviewed === "reviewed"
        ? { in: ["APPROVED", "IGNORED", "NOT_SAME", "RESOLVED"] }
        : input.reviewed === "unreviewed"
          ? { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED", "FAILED"] }
          : { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED", "FAILED", "APPROVED", "IGNORED", "NOT_SAME", "RESOLVED"] },
  };
  const filterMap: Record<string, string> = {
    exact: "EXACT",
    high: "HIGH",
    new: "NONE",
    possible: "POSSIBLE",
  };
  const selection = input.selectionMode === "ALL_FILTERED"
    ? {
        ...selectionBase,
        ...(input.confidenceFilter && filterMap[input.confidenceFilter]
          ? { confidence: filterMap[input.confidenceFilter] }
          : {}),
        ...(input.search ? { searchText: { contains: input.search, mode: "insensitive" as const } } : {}),
        ...(input.reason ? { reason: { contains: input.reason, mode: "insensitive" as const } } : {}),
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
      }
    : { ...selectionBase, id: { in: input.selectedIds } };
  if (input.selectionMode !== "ALL_FILTERED" && input.selectedIds.length === 0) {
    return { ok: false as const, error: "Select at least one review record." };
  }
  const reviewed = { reviewedAt: new Date(), reviewedById: input.actorId };

  if (
    input.action === "APPROVE_SAFE_EXACT" ||
    input.action === "APPROVE_SAFE_HIGH" ||
    input.action === "APPROVE_SAFE_NEW"
  ) {
    const confidence =
      input.action === "APPROVE_SAFE_EXACT"
        ? "EXACT"
        : input.action === "APPROVE_SAFE_HIGH"
          ? "HIGH"
          : "NONE";
    const candidates = await input.prisma.quickBooksImportReview.findMany({
      where: { ...eligibleBase, confidence, safeAutoApprove: true, status: "READY" },
    });
    const validated = await revalidateCustomerPlans(input.prisma, input.scope, candidates);
    const approvedIds =
      confidence === "EXACT"
        ? validated.safeExact
        : confidence === "HIGH"
          ? validated.safeHigh
          : validated.safeNew;
    const result = await input.prisma.quickBooksImportReview.updateMany({
      where: { ...eligibleBase, id: { in: approvedIds }, status: "READY" },
      data: {
        status: "APPROVED",
        proposedAction: confidence === "NONE" ? "CREATE" : "LINK",
        ...reviewed,
      },
    });
    if (validated.excluded.length) {
      const grouped = new Map<string, string[]>();
      for (const id of validated.excluded) {
        const blocker = validated.blockers.get(id) || "OTHER";
        grouped.set(blocker, [...(grouped.get(blocker) ?? []), id]);
      }
      for (const [blocker, ids] of grouped) {
        await input.prisma.quickBooksImportReview.updateMany({
          where: { ...eligibleBase, id: { in: ids } },
          data: {
            status: "RE_REVIEW_REQUIRED",
            safeAutoApprove: false,
            autoApprovalTier: null,
            autoApprovalBlocker: blocker,
            proposedAction: "REVIEW",
            reviewedAt: null,
            reviewedById: null,
            reason: "Safe-match revalidation failed because identity, candidate, or fingerprint data changed.",
          },
        });
      }
    }
    return {
      ok: true as const,
      count: result.count,
      message: `${result.count.toLocaleString()} safe customer matches approved. ${validated.excluded.length.toLocaleString()} excluded for review. No customers were imported and nothing was written to QuickBooks.`,
    };
  }

  if (input.action === "APPROVE_SELECTED") {
    const selectedRows = await input.prisma.quickBooksImportReview.findMany({ where: selection });
    const validated = await revalidateCustomerPlans(input.prisma, input.scope, selectedRows);
    const highIds = selectedRows
      .filter(
        (row) =>
          row.status === "READY" &&
          row.confidence === "HIGH" &&
          Boolean(row.proposedInternalId)
      )
      .map((row) => row.id);
    const linkIds = [...new Set([...validated.safeExact, ...validated.safeHigh, ...highIds])];
    const [links, creates] = await input.prisma.$transaction([
      input.prisma.quickBooksImportReview.updateMany({
        where: {
          ...eligibleBase,
          id: { in: linkIds },
          status: "READY",
        },
        data: { status: "APPROVED", proposedAction: "LINK", ...reviewed },
      }),
      input.prisma.quickBooksImportReview.updateMany({
        where: { ...eligibleBase, id: { in: validated.safeNew }, status: "READY" },
        data: { status: "APPROVED", proposedAction: "CREATE", ...reviewed },
      }),
    ]);
    const count = links.count + creates.count;
    return {
      ok: true as const,
      count,
      message: `${count.toLocaleString()} selected plans approved. Possible duplicates were excluded. No customer data was changed.`,
    };
  }

  const result = await input.prisma.quickBooksImportReview.updateMany({
    where: selection,
    data:
      input.action === "NOT_SAME_SELECTED"
        ? {
            status: "OPEN",
            proposedAction: "REVIEW",
            confidence: "POSSIBLE",
            safeAutoApprove: false,
            reason: "Owner marked the proposed match as not the same customer.",
            reviewedAt: null,
            reviewedById: null,
          }
        : {
            status: "OPEN",
            proposedAction: "REVIEW",
            safeAutoApprove: false,
            reason: "Owner moved this proposal to manual review.",
            reviewedAt: null,
            reviewedById: null,
          },
  });
  return {
    ok: true as const,
    count: result.count,
    message: `${result.count.toLocaleString()} proposals moved to review. No customer data was changed.`,
  };
}
