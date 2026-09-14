import type { PrismaClient } from "@prisma/client";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

export type ReviewDecision = "LINK" | "CREATE" | "MERGE" | "IGNORE" | "NOT_DUPLICATE" | "MARK_INACTIVE";

export async function applyQuickBooksReviewDecision(input: {
  prisma: PrismaClient;
  companyId: string;
  scope: QuickBooksScope;
  reviewId: string;
  action: ReviewDecision;
  targetCustomerId?: string | null;
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
      },
    });
    return { ok: true as const, message: "Queued to create on the next approved import." };
  }

  if (input.action === "MERGE") {
    if (!input.targetCustomerId) return { ok: false as const, error: "Choose the surviving ContractorYou customer." };
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: {
        proposedAction: "LINK",
        proposedInternalId: input.targetCustomerId,
        status: "APPROVED",
        reason: "Owner approved a merge onto the selected customer. Duplicate QuickBooks identity will link, not clone.",
      },
    });
    return { ok: true as const, message: "Merge queued as a link. Records are not deleted." };
  }

  if (input.action === "IGNORE") {
    await input.prisma.quickBooksImportReview.update({
      where: { id: review.id },
      data: { proposedAction: "IGNORE", status: "IGNORED" },
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
      },
    });
    return { ok: true as const, message: "Marked not duplicate. A new customer can be created on import." };
  }

  await input.prisma.quickBooksImportReview.update({
    where: { id: review.id },
    data: { proposedAction: "MARK_INACTIVE", status: "IGNORED" },
  });
  return { ok: true as const, message: "Marked inactive and skipped." };
}
