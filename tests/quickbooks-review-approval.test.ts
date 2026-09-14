import { describe, expect, it, vi } from "vitest";
import {
  applyQuickBooksReviewDecision,
  bulkQuickBooksReviewDecision,
} from "@/lib/quickbooks/inbound-review";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

const scope: QuickBooksScope = {
  companyId: "tenant-865",
  environment: "production",
  realmId: "realm-865",
};

describe("QuickBooks Stage 1 review approvals", () => {
  it("approves a proposed mapping without modifying customer or QuickBooks records", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      quickBooksImportReview: {
        findFirst: vi.fn().mockResolvedValue({
          id: "review-1",
          objectType: "CUSTOMER",
          proposedInternalId: "customer-1",
          confidence: "EXACT",
        }),
        update,
      },
    };
    const result = await applyQuickBooksReviewDecision({
      prisma: prisma as never,
      companyId: scope.companyId,
      scope,
      reviewId: "review-1",
      action: "APPROVE",
      actorId: "owner-1",
    });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { id: "review-1" },
      data: expect.objectContaining({ status: "APPROVED", proposedAction: "LINK" }),
    });
    expect("customer" in prisma).toBe(false);
  });

  it("bulk-approves only safe exact review metadata", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2_294 });
    const prisma = { quickBooksImportReview: { updateMany } };
    const result = await bulkQuickBooksReviewDecision({
      prisma: prisma as never,
      companyId: scope.companyId,
      scope,
      actorId: "owner-1",
      action: "APPROVE_SAFE_EXACT",
      selectedIds: [],
      allFiltered: true,
      confidenceFilter: "exact",
    });
    expect(result).toMatchObject({ ok: true, count: 2_294 });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        objectType: "CUSTOMER",
        confidence: "EXACT",
        safeAutoApprove: true,
      }),
      data: expect.objectContaining({ status: "APPROVED", proposedAction: "LINK" }),
    });
    expect("customer" in prisma).toBe(false);
  });

  it("never bulk-approves possible duplicates", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      quickBooksImportReview: { updateMany },
      $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
    };
    const result = await bulkQuickBooksReviewDecision({
      prisma: prisma as never,
      companyId: scope.companyId,
      scope,
      actorId: "owner-1",
      action: "APPROVE_SELECTED",
      selectedIds: ["possible-1"],
      allFiltered: false,
      confidenceFilter: "possible",
    });
    expect(result).toMatchObject({ ok: true, count: 0 });
    expect(updateMany.mock.calls.every(([arg]) => arg.where.confidence !== "POSSIBLE")).toBe(true);
  });
});
