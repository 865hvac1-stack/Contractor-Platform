import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  runAnalysis: vi.fn(),
  writeAudit: vi.fn(),
  revalidatePath: vi.fn(),
  bulkReview: vi.fn(),
  activeScope: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({ prisma: { marker: "tenant-db" } }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/tenant", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/quickbooks/analysis", () => ({ runQuickBooksImportAnalysis: mocks.runAnalysis }));
vi.mock("@/lib/quickbooks/inbound-import", () => ({ importApprovedQuickBooksRecords: vi.fn() }));
vi.mock("@/lib/quickbooks/inbound-review", () => ({
  applyQuickBooksReviewDecision: vi.fn(),
  bulkQuickBooksReviewDecision: mocks.bulkReview,
}));
vi.mock("@/lib/quickbooks/ownership", () => ({ getActiveQuickBooksScope: mocks.activeScope }));
vi.mock("@/lib/quickbooks/production-preview", () => ({ requestQuickBooksPreviewRefresh: vi.fn() }));

import {
  analyzeQuickBooksImportAction,
  bulkQuickBooksReviewAction,
} from "@/server/actions/quickbooks-sync-center";

describe("Analyze Import server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({
      company: { id: "tenant-865" },
      user: { id: "owner-1" },
    });
    mocks.activeScope.mockResolvedValue({
      ok: true,
      scope: { companyId: "tenant-865", environment: "production", realmId: "realm-865" },
    });
  });

  it("passes ALL_FILTERED mode and validated filter context to the server workflow", async () => {
    mocks.bulkReview.mockResolvedValue({
      ok: true,
      count: 2_253,
      message: "2,253 safe customer matches approved.",
    });
    const form = new FormData();
    form.set("selectionMode", "ALL_FILTERED");
    form.set("analysisRunId", "analysis-1");
    form.set("bulkAction", "APPROVE_SELECTED");
    form.set("confidenceFilter", "exact");
    form.set("search", "smith");

    const result = await bulkQuickBooksReviewAction(null, form);

    expect(result).toMatchObject({ ok: true });
    expect(mocks.bulkReview).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "tenant-865",
        selectionMode: "ALL_FILTERED",
        analysisRunId: "analysis-1",
        confidenceFilter: "exact",
        search: "smith",
        selectedIds: [],
      })
    );
  });

  it("resolves the authenticated tenant and invokes the resumable analysis service", async () => {
    mocks.runAnalysis.mockResolvedValue({
      ok: true,
      runId: "run-1",
      paused: true,
      finished: false,
      autoContinue: true,
      progress: {
        category: "CUSTOMER",
        categoryLabel: "Customers",
        recordsExamined: 50,
        totalAvailable: 31_315,
        percent: 1,
      },
    });
    const form = new FormData();
    form.set("resumeRunId", "run-1");

    const result = await analyzeQuickBooksImportAction(null, form);

    expect(mocks.requirePermission).toHaveBeenCalledWith("accounting:manage");
    expect(mocks.runAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "tenant-865",
        userId: "owner-1",
        resumeRunId: "run-1",
      })
    );
    expect(result).toMatchObject({
      ok: true,
      runId: "run-1",
      paused: true,
      autoContinue: true,
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "tenant-865", actorId: "owner-1", entityId: "run-1" })
    );
  });

  it("surfaces a safe visible error instead of failing silently", async () => {
    mocks.runAnalysis.mockRejectedValue(new Error("Bearer private-token"));

    const result = await analyzeQuickBooksImportAction(null, new FormData());

    expect(result).toEqual({ ok: false, error: "Import analysis failed. No records were changed." });
  });
});
