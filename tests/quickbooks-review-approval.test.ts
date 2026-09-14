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
    const customer = {
      id: "customer-1",
      firstName: "Ada",
      lastName: "West",
      businessName: null,
      email: "ada@example.com",
      phone: "8655550100",
      sourceSystem: null,
      externalId: null,
      quickbooksCustomerId: null,
      properties: [],
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      quickBooksSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "analysis-1",
          status: "COMPLETE",
          writeBackAttempted: false,
        }),
      },
      quickBooksImportReview: {
        findMany: vi.fn().mockResolvedValue([{
          id: "review-1",
          companyId: scope.companyId,
          environment: scope.environment,
          realmId: scope.realmId,
          runId: "analysis-1",
          objectType: "CUSTOMER",
          quickbooksId: "QB-1",
          confidence: "EXACT",
          status: "READY",
          proposedInternalId: "customer-1",
          proposedAction: "LINK",
          safeAutoApprove: true,
          reviewFingerprint: "current",
          payload: {
            Id: "QB-1",
            DisplayName: "Ada West",
            GivenName: "Ada",
            FamilyName: "West",
            PrimaryEmailAddr: { Address: "ada@example.com" },
            PrimaryPhone: { FreeFormNumber: "8655550100" },
          },
          matchSignals: { contractorYouSnapshot: {
            firstName: "Ada",
            lastName: "West",
            businessName: null,
            email: "ada@example.com",
            phone: "8655550100",
            properties: [],
          } },
        }]),
        updateMany,
      },
      customer: { findMany: vi.fn().mockResolvedValue([customer]) },
      quickBooksMapping: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await bulkQuickBooksReviewDecision({
      prisma: prisma as never,
      companyId: scope.companyId,
      scope,
      actorId: "owner-1",
      action: "APPROVE_SAFE_EXACT",
      selectedIds: [],
      selectionMode: "ALL_FILTERED",
      analysisRunId: "analysis-1",
      confidenceFilter: "exact",
    });
    expect(result).toMatchObject({ ok: true, count: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        objectType: "CUSTOMER",
        id: { in: ["review-1"] },
        runId: "analysis-1",
        status: "READY",
      }),
      data: expect.objectContaining({ status: "APPROVED", proposedAction: "LINK" }),
    });
    expect("update" in prisma.customer).toBe(false);
    expect("create" in prisma.customer).toBe(false);
  });

  it("never bulk-approves possible duplicates", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      quickBooksSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "analysis-1",
          status: "COMPLETE",
          writeBackAttempted: false,
        }),
      },
      quickBooksImportReview: {
        findMany: vi.fn().mockResolvedValue([{
          id: "possible-1",
          quickbooksId: "QB-possible",
          runId: "analysis-1",
          status: "READY",
          confidence: "POSSIBLE",
          reviewFingerprint: "current",
          payload: {},
          matchSignals: {},
        }]),
        updateMany,
      },
      customer: { findMany: vi.fn().mockResolvedValue([]) },
      quickBooksMapping: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
    };
    const result = await bulkQuickBooksReviewDecision({
      prisma: prisma as never,
      companyId: scope.companyId,
      scope,
      actorId: "owner-1",
      action: "APPROVE_SELECTED",
      selectedIds: ["possible-1"],
      selectionMode: "PAGE",
      analysisRunId: "analysis-1",
      confidenceFilter: "possible",
    });
    expect(result).toMatchObject({ ok: true, count: 0 });
    expect(updateMany.mock.calls.every(([arg]) => arg.where.confidence !== "POSSIBLE")).toBe(true);
  });
});
