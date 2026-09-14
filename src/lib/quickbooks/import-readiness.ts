import type { PrismaClient } from "@prisma/client";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";
import { validateStageOneImportPlan } from "@/lib/quickbooks/exception-review";

export type ImportStageReadiness = {
  stage: number;
  label: string;
  ready: boolean;
  status: "READY" | "NOT_READY" | "REVIEW_REQUIRED";
  reason: string;
};

export async function quickBooksImportReadiness(
  prisma: PrismaClient,
  scope: QuickBooksScope
): Promise<ImportStageReadiness[]> {
  const [analysis, openReviews, completedImports] = await Promise.all([
    prisma.quickBooksSyncRun.findFirst({
      where: {
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        type: "ANALYSIS",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quickBooksImportReview.groupBy({
      by: ["objectType", "confidence", "status"],
      where: {
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        status: { in: ["OPEN", "READY", "RE_REVIEW_REQUIRED", "FAILED"] },
      },
      _count: { _all: true },
    }),
    prisma.quickBooksSyncRun.findMany({
      where: {
        companyId: scope.companyId,
        environment: scope.environment,
        realmId: scope.realmId,
        type: "IMPORT",
        status: "COMPLETE",
      },
      select: { objectType: true },
    }),
  ]);
  const completed = new Set(completedImports.map((run) => run.objectType));
  const count = (objects: string[], confidences?: string[]) =>
    openReviews
      .filter(
        (row) =>
          objects.includes(row.objectType) &&
          (!confidences || confidences.includes(row.confidence) || row.status === "FAILED")
      )
      .reduce((sum, row) => sum + row._count._all, 0);
  const analysisReady = analysis?.status === "COMPLETE" && analysis.writeBackAttempted === false;
  const customers = count(["CUSTOMER"]);
  const mappings = count(["VENDOR", "ITEM", "ACCOUNT"]);
  const invoices = count(["INVOICE"]);
  const payments = count(["PAYMENT"]);
  const purchases = count(["PURCHASE"]);

  let stageOneIntegrity: Awaited<ReturnType<typeof validateStageOneImportPlan>> | null = null;
  let stageOneIntegrityError = false;
  if (analysisReady && customers === 0) {
    try {
      stageOneIntegrity = await validateStageOneImportPlan(prisma, scope);
    } catch (error) {
      stageOneIntegrityError = true;
      console.error("[quickbooks-stage-one-integrity] validation failed", error);
    }
  }
  const stage1Ready = analysisReady && customers === 0 && stageOneIntegrity?.ready === true;
  const stage2Ready = analysisReady && completed.has("STAGE_1") && mappings === 0;
  const stage3Ready = analysisReady && completed.has("STAGE_2") && invoices === 0;
  const stage4Ready = analysisReady && completed.has("STAGE_3") && payments === 0;
  const stage5Ready = analysisReady && completed.has("STAGE_4") && purchases === 0;

  return [
    stage1Ready
      ? readiness(1, "Customers", true, analysisReady, customers, "")
      : {
          ...readiness(1, "Customers", false, analysisReady, customers, "possible customer matches require review"),
          ...(analysisReady && customers === 0
            ? {
                status: "NOT_READY" as const,
                reason: stageOneIntegrityError
                  ? "Stage 1 plan integrity could not be verified. Import remains blocked."
                  : stageOneIntegrity?.issues.join(" ") || "Stage 1 plan integrity is incomplete.",
              }
            : {}),
        },
    readiness(
      2,
      "Accounting mappings",
      stage2Ready,
      analysisReady,
      mappings,
      completed.has("STAGE_1") ? "mapping records require review" : "Stage 1 must complete first"
    ),
    readiness(
      3,
      "Invoices",
      stage3Ready,
      analysisReady,
      invoices,
      completed.has("STAGE_2") ? "invoice duplicates or conflicts require review" : "Stage 2 must complete first"
    ),
    readiness(
      4,
      "Payments",
      stage4Ready,
      analysisReady,
      payments,
      completed.has("STAGE_3") ? "payment relationship conflicts require review" : "Stage 3 must complete first"
    ),
    readiness(
      5,
      "Expenses",
      stage5Ready,
      analysisReady,
      purchases,
      completed.has("STAGE_4") ? "expense conflicts require review" : "Stage 4 must complete first"
    ),
  ];
}

function readiness(
  stage: number,
  label: string,
  ready: boolean,
  analysisReady: boolean,
  issues: number,
  blocker: string
): ImportStageReadiness {
  if (ready) return { stage, label, ready, status: "READY", reason: "All required reviews and prior stages are complete." };
  if (!analysisReady) {
    return { stage, label, ready, status: "NOT_READY", reason: "A complete read-only analysis is required." };
  }
  return {
    stage,
    label,
    ready,
    status: issues > 0 ? "REVIEW_REQUIRED" : "NOT_READY",
    reason: issues > 0 ? `${issues.toLocaleString()} ${blocker}.` : blocker,
  };
}

export async function assertQuickBooksImportStageReady(
  prisma: PrismaClient,
  scope: QuickBooksScope,
  stage: number
) {
  const readinessRows = await quickBooksImportReadiness(prisma, scope);
  const row = readinessRows.find((item) => item.stage === stage);
  if (!row?.ready) {
    return {
      ok: false as const,
      error: `Import Stage ${stage} is blocked: ${row?.reason || "readiness could not be verified"}. The confirmation phrase cannot override this check.`,
    };
  }
  return { ok: true as const };
}
