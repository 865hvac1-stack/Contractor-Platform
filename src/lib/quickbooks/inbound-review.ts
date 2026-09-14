import type { Prisma, PrismaClient } from "@prisma/client";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

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
  | "APPROVE_SAFE_NEW";

export async function bulkQuickBooksReviewDecision(input: {
  prisma: PrismaClient;
  companyId: string;
  scope: QuickBooksScope;
  actorId: string;
  action: BulkReviewAction;
  selectedIds: string[];
  allFiltered: boolean;
  confidenceFilter?: string | null;
  search?: string | null;
  reason?: string | null;
  differences?: string | null;
}) {
  const base: Prisma.QuickBooksImportReviewWhereInput = {
    companyId: input.companyId,
    environment: input.scope.environment,
    realmId: input.scope.realmId,
    objectType: "CUSTOMER",
    status: { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED"] },
  };
  const filterMap: Record<string, string> = {
    exact: "EXACT",
    high: "HIGH",
    new: "NONE",
    possible: "POSSIBLE",
  };
  const selection = input.allFiltered
    ? {
        ...base,
        ...(input.confidenceFilter && filterMap[input.confidenceFilter]
          ? { confidence: filterMap[input.confidenceFilter] }
          : {}),
        ...(input.search ? { searchText: { contains: input.search, mode: "insensitive" as const } } : {}),
        ...(input.reason ? { reason: { contains: input.reason, mode: "insensitive" as const } } : {}),
        ...(input.differences === "yes" ? { differenceCount: { gt: 0 } } : {}),
        ...(input.differences === "no" ? { differenceCount: 0 } : {}),
      }
    : { ...base, id: { in: input.selectedIds } };
  if (!input.allFiltered && input.selectedIds.length === 0) {
    return { ok: false as const, error: "Select at least one review record." };
  }
  const reviewed = { reviewedAt: new Date(), reviewedById: input.actorId };

  if (input.action === "APPROVE_SAFE_EXACT" || input.action === "APPROVE_SAFE_NEW") {
    const confidence = input.action === "APPROVE_SAFE_EXACT" ? "EXACT" : "NONE";
    const result = await input.prisma.quickBooksImportReview.updateMany({
      where: { ...base, confidence, safeAutoApprove: true },
      data: {
        status: "APPROVED",
        proposedAction: confidence === "EXACT" ? "LINK" : "CREATE",
        ...reviewed,
      },
    });
    return {
      ok: true as const,
      count: result.count,
      message: `${result.count.toLocaleString()} safe ${confidence === "EXACT" ? "exact mappings" : "new-customer plans"} approved. No customer data was changed.`,
    };
  }

  if (input.action === "APPROVE_SELECTED") {
    const [links, creates] = await input.prisma.$transaction([
      input.prisma.quickBooksImportReview.updateMany({
        where: {
          ...selection,
          confidence: { in: ["EXACT", "HIGH"] },
          proposedInternalId: { not: null },
        },
        data: { status: "APPROVED", proposedAction: "LINK", ...reviewed },
      }),
      input.prisma.quickBooksImportReview.updateMany({
        where: { ...selection, confidence: "NONE", safeAutoApprove: true },
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
