import { describe, expect, it, vi } from "vitest";
import { loadQuickBooksReviewRows } from "@/lib/quickbooks/review-center";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

const scope: QuickBooksScope = {
  companyId: "tenant-865",
  environment: "production",
  realmId: "realm-865",
};

describe("QuickBooks review pagination", () => {
  it("uses database skip/take and never loads thousands of cards", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      quickBooksImportReview: {
        count: vi.fn().mockResolvedValue(2_294),
        findMany,
      },
      customer: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await loadQuickBooksReviewRows(prisma as never, scope, {
      view: "review",
      filter: "exact",
      search: "smith",
      page: 2,
      pageSize: 25,
      sort: "highest",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: expect.objectContaining({
          companyId: "tenant-865",
          confidence: "EXACT",
          searchText: { contains: "smith", mode: "insensitive" },
        }),
      })
    );
    expect(result.rows).toHaveLength(0);
    expect(result.pageSize).toBe(25);
    expect(result.total).toBe(2_294);
  });

  it("limits page size to the supported 25, 50, or 100 values", async () => {
    const prisma = {
      quickBooksImportReview: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await loadQuickBooksReviewRows(prisma as never, scope, {
      view: "review",
      page: 1,
      pageSize: 5_000,
    });
    expect(result.pageSize).toBe(25);
    expect(prisma.quickBooksImportReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 })
    );
  });
});
