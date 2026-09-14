import { describe, expect, it, vi } from "vitest";
import { loadStageOneCustomerAudit } from "@/lib/quickbooks/stage-one-audit";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";

const scope: QuickBooksScope = {
  companyId: "tenant-865",
  environment: "production",
  realmId: "realm-865",
};

function customer(id: string, qboId: string, sourceSystem: string | null = null) {
  return {
    id,
    companyId: scope.companyId,
    firstName: id,
    lastName: "Customer",
    businessName: null,
    phone: null,
    email: null,
    sourceSystem,
    externalId: sourceSystem ? qboId : null,
    quickbooksCustomerId: qboId,
    quickbooksRealmId: scope.realmId,
    properties: [],
  };
}

describe("Stage 1 customer import audit", () => {
  it("separates mutually exclusive outcomes from overlapping operation counters", async () => {
    const mappings = [
      { quickbooksId: "QB-LINK", internalId: "existing", realmId: scope.realmId, companyId: scope.companyId },
      { quickbooksId: "QB-NEW", internalId: "created", realmId: scope.realmId, companyId: scope.companyId },
    ];
    const mapped = [
      customer("existing", "QB-LINK"),
      customer("created", "QB-NEW", "quickbooks_online"),
    ];
    const audit = await loadStageOneCustomerAudit({
      quickBooksSyncRun: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: "import-1",
            status: "COMPLETE",
            startedAt: new Date(),
            completedAt: new Date(),
            recordsExamined: 4,
            createdCount: 1,
            updatedCount: 1,
            linkedCount: 1,
            skippedCount: 1,
            failedCount: 1,
            conflictCount: 0,
            writeBackAttempted: false,
          })
          .mockResolvedValueOnce({ categories: [{ availableInQbo: 4 }] }),
      },
      quickBooksImportReview: {
        findMany: vi.fn().mockResolvedValue([
          { id: "r1", quickbooksId: "QB-LINK", status: "LINKED", proposedAction: "LINK", proposedInternalId: "existing", errorMessage: null },
          { id: "r2", quickbooksId: "QB-NEW", status: "CREATED", proposedAction: "CREATE", proposedInternalId: null, errorMessage: null },
          { id: "r3", quickbooksId: "QB-IGNORE", status: "IGNORED", proposedAction: "IGNORE", proposedInternalId: null, errorMessage: null },
          { id: "r4", quickbooksId: "QB-FAIL", status: "FAILED", proposedAction: "LINK", proposedInternalId: "missing", errorMessage: "failed" },
        ]),
      },
      quickBooksMapping: { findMany: vi.fn().mockResolvedValue(mappings) },
      quickBooksSettings: { findUnique: vi.fn().mockResolvedValue({ writeBackEnabled: false }) },
      customer: {
        findMany: vi.fn()
          .mockResolvedValueOnce(mapped)
          .mockResolvedValueOnce(mapped),
      },
    } as never, scope);

    expect(audit?.outcomes).toEqual({
      linkedExisting: 1,
      createdNew: 1,
      ignored: 1,
      failed: 1,
      unresolved: 0,
      skipped: 0,
      other: 0,
    });
    expect(audit?.outcomeTotal).toBe(4);
    expect(audit?.operations).toMatchObject({ created: 1, updated: 1, linked: 1 });
    expect(audit?.updatedFieldBreakdown).toMatchObject({
      nameChanged: 0,
      phoneChanged: 0,
      emailChanged: 0,
      propertyChanged: 0,
    });
    expect(audit?.quickBooksWrites).toBe("ZERO");
    expect(audit?.stageTwoSafe).toBe(false);
  });

  it("flags a newly created customer sharing normalized identity with an existing customer", async () => {
    const created = {
      ...customer("created", "QB-NEW", "quickbooks_online"),
      firstName: "Ada",
      lastName: "West",
      phone: "(865) 555-0100",
    };
    const existing = {
      ...customer("existing", ""),
      quickbooksCustomerId: null,
      firstName: "Ada",
      lastName: "West",
      phone: "8655550100",
    };
    const audit = await loadStageOneCustomerAudit({
      quickBooksSyncRun: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: "import-1",
            status: "COMPLETE",
            startedAt: new Date(),
            completedAt: new Date(),
            recordsExamined: 1,
            createdCount: 1,
            updatedCount: 0,
            linkedCount: 0,
            skippedCount: 0,
            failedCount: 0,
            conflictCount: 0,
            writeBackAttempted: false,
          })
          .mockResolvedValueOnce({ categories: [{ availableInQbo: 1 }] }),
      },
      quickBooksImportReview: {
        findMany: vi.fn().mockResolvedValue([
          { id: "r1", quickbooksId: "QB-NEW", status: "CREATED", proposedAction: "CREATE", proposedInternalId: null, errorMessage: null },
        ]),
      },
      quickBooksMapping: {
        findMany: vi.fn().mockResolvedValue([
          { quickbooksId: "QB-NEW", internalId: "created", realmId: scope.realmId, companyId: scope.companyId },
        ]),
      },
      quickBooksSettings: { findUnique: vi.fn().mockResolvedValue({ writeBackEnabled: false }) },
      customer: {
        findMany: vi.fn()
          .mockResolvedValueOnce([created])
          .mockResolvedValueOnce([created, existing]),
      },
    } as never, scope);
    expect(audit?.created.potentialDuplicates).toBe(1);
    expect(audit?.stageTwoSafe).toBe(false);
  });
});
