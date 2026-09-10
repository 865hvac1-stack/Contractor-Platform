import { prisma } from "@/lib/db";
import { startOfMonth } from "date-fns";

export async function recordReceptionistV2Usage(input: {
  companyId: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicrousd: number;
  latencyMs: number;
  status?: string;
  errorKind?: string | null;
}) {
  await prisma.aIUsageEvent.create({
    data: {
      companyId: input.companyId,
      feature: "receptionist_v2",
      model: input.model || "fallback",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostMicrousd: input.costMicrousd,
      latencyMs: input.latencyMs,
      status: input.status || "OK",
      errorKind: input.errorKind ?? null,
    },
  });
}

export async function loadReceptionistV2Usage(companyId: string) {
  const since = startOfMonth(new Date());
  const [turns, usage] = await Promise.all([
    prisma.receptionistTurn.count({
      where: {
        companyId,
        createdAt: { gte: since },
        OR: [{ shadow: true }, { mode: { in: ["CONTRACTORYOU_SHADOW", "CONTRACTORYOU_AI"] } }],
      },
    }),
    prisma.aIUsageEvent.aggregate({
      where: { companyId, feature: "receptionist_v2", createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicrousd: true },
      _count: true,
    }),
  ]);
  return {
    turnsThisMonth: turns,
    usageEventsThisMonth: usage._count,
    inputTokens: usage._sum.inputTokens ?? 0,
    outputTokens: usage._sum.outputTokens ?? 0,
    estimatedCostMicrousd: usage._sum.estimatedCostMicrousd ?? 0,
  };
}
