import { describe, expect, it, vi } from "vitest";
import { assertQuickBooksImportStageReady, quickBooksImportReadiness } from "@/lib/quickbooks/import-readiness";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

const scope: QuickBooksScope = {
  companyId: "tenant-865",
  environment: "production",
  realmId: "realm-865",
};

function db(input: {
  analysisStatus?: string;
  reviews?: Array<{ objectType: string; confidence: string; status: string; _count: { _all: number } }>;
  completed?: string[];
}) {
  return {
    quickBooksSyncRun: {
      findFirst: vi.fn().mockResolvedValue({
        status: input.analysisStatus ?? "COMPLETE",
        writeBackAttempted: false,
        categories: [{ availableInQbo: 0 }],
      }),
      findMany: vi.fn().mockResolvedValue((input.completed ?? []).map((objectType) => ({ objectType }))),
    },
    quickBooksImportReview: {
      groupBy: vi.fn().mockResolvedValue(input.reviews ?? []),
      findMany: vi.fn().mockResolvedValue([]),
    },
    quickBooksMapping: { findMany: vi.fn().mockResolvedValue([]) },
    quickBooksReviewDecision: { findMany: vi.fn().mockResolvedValue([]) },
    customer: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("QuickBooks import readiness", () => {
  it("blocks Stage 1 while possible customer duplicates remain", async () => {
    const prisma = db({
      reviews: [
        { objectType: "CUSTOMER", confidence: "POSSIBLE", status: "OPEN", _count: { _all: 158 } },
      ],
    });
    const readiness = await quickBooksImportReadiness(prisma as never, scope);
    expect(readiness[0]).toMatchObject({
      ready: false,
      status: "REVIEW_REQUIRED",
    });
    expect(readiness[0]!.reason).toContain("158");
    await expect(assertQuickBooksImportStageReady(prisma as never, scope, 1)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("confirmation phrase cannot override"),
    });
  });

  it("enforces dependency order even when no review issues remain", async () => {
    const readiness = await quickBooksImportReadiness(db({ reviews: [] }) as never, scope);
    expect(readiness[0]!.ready).toBe(true);
    expect(readiness.slice(1).every((row) => !row.ready)).toBe(true);
    expect(readiness[1]!.reason).toContain("Stage 1 must complete first");
  });
});
