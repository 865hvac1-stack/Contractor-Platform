import { describe, expect, it, vi } from "vitest";
import {
  EXCEPTION_REASONS,
  loadQuickBooksExceptionReview,
} from "@/lib/quickbooks/exception-review";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

const scope: QuickBooksScope = {
  companyId: "tenant-865",
  environment: "production",
  realmId: "realm-865",
};

const row = {
  id: "review-address-1",
  companyId: scope.companyId,
  environment: scope.environment,
  realmId: scope.realmId,
  runId: "analysis-1",
  objectType: "CUSTOMER",
  quickbooksId: "QB-1",
  displayName: "Ada West",
  confidence: "HIGH",
  confidenceScore: 94,
  status: "READY",
  safeAutoApprove: false,
  autoApprovalBlocker: "ADDRESS_CONFLICT",
  proposedInternalId: "customer-1",
  matchSignals: { candidateIds: ["customer-1"] },
  reason: "QuickBooks address does not match any candidate property.",
  payload: {
    Id: "QB-1",
    DisplayName: "Ada West",
    GivenName: "Ada",
    FamilyName: "West",
    PrimaryEmailAddr: { Address: "ada@example.com" },
    PrimaryPhone: { FreeFormNumber: "8655550100" },
    BillAddr: { Line1: "100 Main St", City: "Knoxville", CountrySubDivisionCode: "TN", PostalCode: "37902" },
  },
  skippedAt: null,
};

const customer = {
  id: "customer-1",
  firstName: "Ada",
  lastName: "West",
  businessName: null,
  phone: "8655550100",
  email: "ada@example.com",
  properties: [{
    id: "property-1",
    address: "200 Oak Rd",
    city: "Knoxville",
    state: "TN",
    zip: "37902",
    isPrimary: true,
  }],
};

function database(filteredCount = 20) {
  const findMany = vi.fn().mockResolvedValue([row]);
  const count = vi.fn()
    .mockResolvedValueOnce(filteredCount)
    .mockResolvedValueOnce(413)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0);
  return {
    prisma: {
      quickBooksImportReview: {
        findMany,
        count,
        groupBy: vi.fn().mockResolvedValue(
          EXCEPTION_REASONS.map((reason) => ({
            autoApprovalBlocker: reason,
            _count: { _all: reason === "ADDRESS_CONFLICT" ? 20 : 1 },
          }))
        ),
      },
      quickBooksReviewDecision: { findFirst: vi.fn().mockResolvedValue(null) },
      customer: { findMany: vi.fn().mockResolvedValue([customer]) },
    },
    findMany,
    count,
  };
}

describe("QuickBooks exception reason filters", () => {
  it.each(EXCEPTION_REASONS)("queries only unresolved %s exceptions and returns the first card", async (reason) => {
    const { prisma, findMany } = database(reason === "ADDRESS_CONFLICT" ? 20 : 1);
    const result = await loadQuickBooksExceptionReview(prisma as never, scope, { reason });

    expect(findMany.mock.calls[0]![0]).toEqual({
      where: expect.objectContaining({
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        objectType: "CUSTOMER",
        safeAutoApprove: false,
        status: { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED", "FAILED"] },
        autoApprovalBlocker: reason,
      }),
      take: 5_000,
    });
    expect(result.activeReason).toBe(reason);
    expect(result.filteredRemaining).toBe(reason === "ADDRESS_CONFLICT" ? 20 : 1);
    expect(result.current).toMatchObject({
      id: row.id,
      blocker: "ADDRESS_CONFLICT",
      qbo: { name: "Ada West" },
      candidates: [expect.objectContaining({ id: "customer-1" })],
    });
  });

  it("treats All and invalid reason parameters as the prioritized full queue", async () => {
    for (const reason of ["ALL", "NOT_A_REAL_REASON"]) {
      const { prisma, findMany } = database(413);
      const result = await loadQuickBooksExceptionReview(prisma as never, scope, { reason });
      expect(findMany.mock.calls[0]![0].where.autoApprovalBlocker).toBeUndefined();
      expect(result.activeReason).toBeNull();
      expect(result.filteredRemaining).toBe(413);
      expect(result.current?.id).toBe(row.id);
    }
  });

  it("applies skipped-only at the database query and keeps records unresolved", async () => {
    const { prisma, findMany } = database(4);
    const result = await loadQuickBooksExceptionReview(prisma as never, scope, { skipped: true });
    expect(findMany.mock.calls[0]![0].where).toEqual(expect.objectContaining({
      skippedAt: { not: null },
      status: { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED", "FAILED"] },
    }));
    expect(result.filteredRemaining).toBe(4);
  });
});
