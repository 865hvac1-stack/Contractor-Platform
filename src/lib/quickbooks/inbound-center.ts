import type { PrismaClient } from "@prisma/client";
import { getCompanyConnection } from "@/lib/integrations/store";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { getQuickBooksSettings } from "@/lib/quickbooks/connection";
import { loadQuickBooksSyncCenter } from "@/lib/quickbooks/center";
import { loadQuickBooksProductionPreview } from "@/lib/quickbooks/production-preview";
import { mappingScopeWhere, type QuickBooksScope } from "@/lib/quickbooks/ownership";
import { INBOUND_LABELS, INBOUND_OBJECT_TYPES, type InboundObjectType } from "@/lib/quickbooks/inbound-types";
import { QUICKBOOKS_WRITEBACK_ENABLED } from "@/lib/quickbooks/writeback";
import type { ImportPlan } from "@/lib/quickbooks/analysis";

export async function loadInboundSyncCenter(prisma: PrismaClient, scope: QuickBooksScope) {
  const [connection, settings, center, preview, latestAnalysis, latestImport, reviews, runs, mappingCounts] =
    await Promise.all([
      getCompanyConnection(scope.companyId, QUICKBOOKS_PROVIDER_KEY),
      getQuickBooksSettings(scope.companyId),
      loadQuickBooksSyncCenter(prisma, scope),
      loadQuickBooksProductionPreview(prisma, scope.companyId).catch((error) => ({
        error: error instanceof Error ? error.message : "Preview unavailable",
        preview: null,
      })),
      prisma.quickBooksSyncRun.findFirst({
        where: { companyId: scope.companyId, environment: scope.environment, realmId: scope.realmId, type: "ANALYSIS" },
        orderBy: { createdAt: "desc" },
        include: { categories: true },
      }),
      prisma.quickBooksSyncRun.findFirst({
        where: { companyId: scope.companyId, environment: scope.environment, realmId: scope.realmId, type: "IMPORT" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.quickBooksImportReview.groupBy({
        by: ["objectType", "confidence", "status"],
        where: { companyId: scope.companyId, environment: scope.environment, realmId: scope.realmId },
        _count: { _all: true },
      }),
      prisma.quickBooksSyncRun.findMany({
        where: { companyId: scope.companyId, environment: scope.environment, realmId: scope.realmId },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      Promise.all(
        INBOUND_OBJECT_TYPES.map(async (objectType) => [
          objectType,
          await prisma.quickBooksMapping.count({
            where: {
              ...mappingScopeWhere(scope),
              entityType:
                objectType === "PURCHASE"
                  ? "EXPENSE"
                  : objectType === "ITEM"
                    ? "ITEM"
                    : objectType,
            },
          }),
        ] as const)
      ),
    ]);

  const linked = Object.fromEntries(mappingCounts) as Record<InboundObjectType, number>;
  const previewData = preview && "customers" in preview ? preview : null;
  const previewError = preview && "error" in preview ? preview.error : null;
  const qboTotals: Record<InboundObjectType, number | null> = {
    CUSTOMER: previewData?.customers.count ?? null,
    INVOICE: previewData?.invoices.count ?? null,
    PAYMENT: previewData?.payments.count ?? null,
    ITEM: previewData?.items.count ?? null,
    PURCHASE: previewData?.expenses.count ?? null,
    VENDOR: latestAnalysis?.categories.find((row) => row.objectType === "VENDOR")?.availableInQbo ?? null,
    ACCOUNT: latestAnalysis?.categories.find((row) => row.objectType === "ACCOUNT")?.availableInQbo ?? null,
  };

  const reviewStats = (objectType: InboundObjectType) => {
    const rows = reviews.filter((row) => row.objectType === objectType);
    const count = (confidence?: string, status?: string) =>
      rows
        .filter((row) => (confidence ? row.confidence === confidence : true) && (status ? row.status === status : true))
        .reduce((sum, row) => sum + row._count._all, 0);
    const analysisRow = latestAnalysis?.categories.find((row) => row.objectType === objectType);
    return {
      available: qboTotals[objectType],
      linked: linked[objectType] ?? 0,
      newCount: analysisRow?.newCount ?? count("NONE", "READY") + count("NONE", "APPROVED"),
      updated: analysisRow?.updatedCount ?? 0,
      duplicates: count("POSSIBLE") || analysisRow?.duplicateCount || 0,
      conflicts: analysisRow?.conflictCount ?? count(undefined, "OPEN"),
      skipped: analysisRow?.skippedCount ?? count(undefined, "IGNORED"),
      failed: analysisRow?.failedCount ?? count(undefined, "FAILED"),
      lastSynced: analysisRow?.lastSyncedAt ?? latestImport?.completedAt ?? null,
      exact: count("EXACT"),
      high: count("HIGH"),
      possible: count("POSSIBLE"),
      none: count("NONE"),
    };
  };

  return {
    connection,
    settings,
    center,
    preview: previewData,
    previewError,
    latestAnalysis,
    latestImport,
    plan: (latestAnalysis?.plan as ImportPlan | null) ?? null,
    runs,
    writeBackEnabled: QUICKBOOKS_WRITEBACK_ENABLED && settings.writeBackEnabled,
    categories: INBOUND_OBJECT_TYPES.map((objectType) => ({
      objectType,
      label: INBOUND_LABELS[objectType],
      ...reviewStats(objectType),
    })),
  };
}
