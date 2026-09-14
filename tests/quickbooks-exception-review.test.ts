import { describe, expect, it, vi } from "vitest";
import {
  exceptionPriority,
  loadStageOneImportPreview,
  resolveQuickBooksException,
  skipQuickBooksException,
  undoLastQuickBooksExceptionDecision,
} from "@/lib/quickbooks/exception-review";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";
import { approvedMap } from "@/lib/quickbooks/inbound-import";

const scope: QuickBooksScope = {
  companyId: "tenant-865",
  environment: "production",
  realmId: "realm-865",
};

const review = {
  id: "review-1",
  companyId: scope.companyId,
  runId: "analysis-1",
  quickbooksId: "QB-341",
  objectType: "CUSTOMER",
  status: "OPEN",
  proposedAction: "REVIEW",
  proposedInternalId: "customer-1",
  confidence: "POSSIBLE",
  reason: "Phone differs",
  resolutionType: null,
  sourceFingerprint: null,
  candidateFingerprint: null,
  reviewedAt: null,
  reviewedById: null,
  skippedAt: null,
  payload: { Id: "QB-341", DisplayName: "TJ Hurst" },
};

describe("QuickBooks exception review", () => {
  it("prioritizes easier blocker categories first", () => {
    expect([
      "POSSIBLE_DUPLICATE",
      "MULTIPLE_CANDIDATES",
      "OTHER",
      "PHONE_MISSING",
      "NAME_CONFLICT",
      "ADDRESS_CONFLICT",
    ].sort((a, b) => exceptionPriority(a) - exceptionPriority(b))).toEqual([
      "ADDRESS_CONFLICT",
      "NAME_CONFLICT",
      "PHONE_MISSING",
      "OTHER",
      "MULTIPLE_CANDIDATES",
      "POSSIBLE_DUPLICATE",
    ]);
  });

  it("persists a link decision and fingerprints without modifying customers", async () => {
    const updated = {
      ...review,
      status: "APPROVED",
      proposedAction: "LINK",
      proposedInternalId: "customer-2",
      resolutionType: "LINK",
      sourceFingerprint: "source",
      candidateFingerprint: "candidate",
      reviewedAt: new Date(),
      reviewedById: "owner-1",
    };
    const tx = {
      quickBooksImportReview: {
        findFirst: vi.fn().mockResolvedValue(review),
        update: vi.fn().mockImplementation(async ({ data }) => ({ ...updated, ...data })),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue({
          id: "customer-2",
          firstName: "TJ",
          lastName: "Hurst",
          businessName: null,
          phone: "8655551212",
          email: "tj@example.com",
          properties: [],
        }),
      },
      quickBooksReviewDecision: {
        create: vi.fn().mockResolvedValue({ id: "decision-1" }),
      },
    };
    const prisma = { $transaction: vi.fn((callback) => callback(tx)) };
    const result = await resolveQuickBooksException({
      prisma: prisma as never,
      scope,
      reviewId: review.id,
      resolution: "LINK",
      actorId: "owner-1",
      targetCustomerId: "customer-2",
    });
    expect(result).toMatchObject({ ok: true, decisionId: "decision-1" });
    expect(tx.quickBooksImportReview.update).toHaveBeenCalledWith({
      where: { id: review.id },
      data: expect.objectContaining({
        status: "APPROVED",
        resolutionType: "LINK",
        proposedInternalId: "customer-2",
      }),
    });
    expect(tx.quickBooksReviewDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: scope.companyId,
        realmId: scope.realmId,
        analysisRunId: "analysis-1",
        quickbooksId: "QB-341",
        selectedCustomerId: "customer-2",
      }),
    });
    expect("update" in tx.customer).toBe(false);
    expect("create" in tx.customer).toBe(false);
  });

  it("skips without resolving the review", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const result = await skipQuickBooksException({
      prisma: { quickBooksImportReview: { updateMany } } as never,
      scope,
      reviewId: review.id,
    });
    expect(result.ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: review.id, status: { in: expect.any(Array) } }),
      data: { skippedAt: expect.any(Date), skipCount: { increment: 1 } },
    });
    expect(updateMany.mock.calls[0]![0].data.status).toBeUndefined();
  });

  it("undoes only when the review still equals the saved resulting state", async () => {
    const previousState = {
      status: "OPEN",
      proposedAction: "REVIEW",
      proposedInternalId: "customer-1",
      confidence: "POSSIBLE",
      reason: "Phone differs",
      resolutionType: null,
      sourceFingerprint: null,
      candidateFingerprint: null,
      reviewedAt: null,
      reviewedById: null,
      skippedAt: null,
    };
    const resultingState = {
      ...previousState,
      status: "IGNORED",
      proposedAction: "IGNORE",
      proposedInternalId: null,
      resolutionType: "IGNORE",
      sourceFingerprint: "source",
      reviewedAt: "2026-09-14T13:00:00.000Z",
      reviewedById: "owner-1",
    };
    const tx = {
      quickBooksReviewDecision: {
        findFirst: vi.fn().mockResolvedValue({
          id: "decision-1",
          reviewId: review.id,
          previousState,
          resultingState,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      quickBooksImportReview: {
        findFirst: vi.fn().mockResolvedValue({
          ...review,
          ...resultingState,
          reviewedAt: new Date(resultingState.reviewedAt),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const result = await undoLastQuickBooksExceptionDecision({
      prisma: { $transaction: vi.fn((callback) => callback(tx)) } as never,
      scope,
      actorId: "owner-1",
    });
    expect(result.ok).toBe(true);
    expect(tx.quickBooksImportReview.update).toHaveBeenCalledWith({
      where: { id: review.id },
      data: expect.objectContaining({ status: "OPEN", resolutionType: null }),
    });
    expect(tx.quickBooksReviewDecision.update).toHaveBeenCalledWith({
      where: { id: "decision-1" },
      data: { undoneAt: expect.any(Date), undoneById: "owner-1" },
    });
  });

  it("builds a final plan whose totals reconcile", async () => {
    const count = vi.fn()
      .mockResolvedValueOnce(3_017)
      .mockResolvedValueOnce(2_741)
      .mockResolvedValueOnce(201)
      .mockResolvedValueOnce(54)
      .mockResolvedValueOnce(0);
    const preview = await loadStageOneImportPreview(
      { quickBooksImportReview: { count } } as never,
      scope
    );
    expect(preview).toEqual({
      total: 3_017,
      link: 2_741,
      create: 201,
      ignore: 54,
      otherResolved: 21,
      unresolved: 0,
      reconciles: true,
    });
  });

  it("prepares Stage 1 to import only explicitly approved customer plans", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await approvedMap(
      { quickBooksImportReview: { findMany } } as never,
      scope.companyId,
      scope,
      "CUSTOMER"
    );
    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        objectType: "CUSTOMER",
        status: "APPROVED",
        proposedAction: { in: ["LINK", "CREATE"] },
      }),
    });
  });
});
