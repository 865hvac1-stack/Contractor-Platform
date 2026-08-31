import type { CompensationTrigger, Prisma, PrismaClient } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";
import { calculateCompensationAmount } from "@/lib/compensation/calculate";
import { loadJobFinancials } from "@/lib/costing/job";

async function latestVersion(prisma: PrismaClient, ruleId: string) {
  return prisma.compensationRuleVersion.findFirst({
    where: { ruleId },
    orderBy: { createdAt: "desc" },
  });
}

export async function applyCompensation(input: {
  prisma: PrismaClient;
  companyId: string;
  userId: string | null;
  trigger: CompensationTrigger;
  sourceType: string;
  sourceId: string;
  saleCents: number;
  jobId?: string | null;
  customerId?: string | null;
  importMode?: string | null;
  pricebookItemId?: string | null;
  membershipPlanId?: string | null;
  jobType?: string | null;
}) {
  if (!input.userId) return [];
  if (isHistoricalImport(input.importMode)) return [];
  const rules = await input.prisma.compensationRule.findMany({
    where: { companyId: input.companyId, active: true, trigger: input.trigger },
  });
  const created: string[] = [];
  for (const rule of rules) {
    if (rule.minAmountCents != null && input.saleCents < rule.minAmountCents) continue;
    if (rule.jobType && input.jobType && rule.jobType !== input.jobType) continue;
    if (rule.pricebookItemId && input.pricebookItemId !== rule.pricebookItemId) continue;
    if (rule.membershipPlanId && input.membershipPlanId !== rule.membershipPlanId) continue;
    if (rule.type === "TIERED" || rule.type === "THRESHOLD_BONUS") continue;
    let profit: number | null = null;
    if (rule.type === "PERCENT_OF_GROSS_PROFIT" && input.jobId) {
      const financials = await loadJobFinancials(input.companyId, input.jobId);
      profit = financials?.grossProfitCents ?? null;
    }
    const calc = calculateCompensationAmount({
      type: rule.type,
      amountCents: rule.amountCents,
      percentBps: rule.percentBps,
      saleCents: input.saleCents,
      grossProfitCents: profit,
    });
    if (!calc.supported || calc.amountCents <= 0) continue;
    let version = await latestVersion(input.prisma, rule.id);
    if (!version) {
      version = await input.prisma.compensationRuleVersion.create({
        data: {
          companyId: input.companyId,
          ruleId: rule.id,
          snapshot: {
            name: rule.name,
            type: rule.type,
            trigger: rule.trigger,
            amountCents: rule.amountCents,
            percentBps: rule.percentBps,
          } as Prisma.InputJsonValue,
        },
      });
    }
    const existing = await input.prisma.compensationEvent.findFirst({
      where: {
        companyId: input.companyId,
        ruleId: rule.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        userId: input.userId,
      },
    });
    if (existing) continue;
    const event = await input.prisma.compensationEvent.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        ruleId: rule.id,
        ruleVersionId: version.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        jobId: input.jobId ?? null,
        customerId: input.customerId ?? null,
        amountCents: calc.amountCents,
        calculationBasis: `${rule.name}: ${calc.basis}`,
        status: input.trigger === "INVOICE_PAID" || input.trigger === "JOB_COMPLETED" ? "QUALIFIED" : "PENDING",
      },
    });
    created.push(event.id);
  }
  return created;
}
