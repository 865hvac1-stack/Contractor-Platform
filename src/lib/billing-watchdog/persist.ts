import type { Prisma, PrismaClient } from "@prisma/client";
import type { DetectedFinding } from "@/lib/billing-watchdog/types";

export async function persistWatchdogFindings(
  prisma: PrismaClient,
  companyId: string,
  detected: DetectedFinding[],
  asOf = new Date()
) {
  const existing = await prisma.billingWatchdogFinding.findMany({
    where: { companyId, status: { in: ["OPEN", "EXCLUDED"] } },
  });
  const byFingerprint = new Map(existing.map((row) => [row.fingerprint, row]));
  const seen = new Set<string>();

  for (const finding of detected) {
    seen.add(finding.fingerprint);
    const current = byFingerprint.get(finding.fingerprint);
    if (current?.status === "EXCLUDED") continue;
    const data = {
      type: finding.type,
      severity: finding.severity,
      jobId: finding.jobId,
      invoiceId: finding.invoiceId,
      paymentId: finding.paymentId,
      customerId: finding.customerId,
      technicianId: finding.technicianId,
      amountAtRiskCents: finding.amountAtRiskCents,
      amountUnknown: finding.amountUnknown,
      reason: finding.reason,
      recommendedAction: finding.recommendedAction,
      metadata: {
        ...finding.metadata,
        title: finding.title,
        subtitle: finding.subtitle,
        actions: finding.actions,
      } as Prisma.InputJsonValue,
      lastDetectedAt: asOf,
      status: "OPEN" as const,
      resolvedAt: null,
    };
    if (!current) {
      await prisma.billingWatchdogFinding.create({
        data: {
          companyId,
          fingerprint: finding.fingerprint,
          detectedAt: asOf,
          firstDetectedAt: asOf,
          ...data,
        },
      });
      continue;
    }
    await prisma.billingWatchdogFinding.update({
      where: { id: current.id },
      data,
    });
  }

  const stale = existing.filter((row) => row.status === "OPEN" && !seen.has(row.fingerprint));
  if (stale.length) {
    await prisma.billingWatchdogFinding.updateMany({
      where: { companyId, id: { in: stale.map((row) => row.id) } },
      data: { status: "RESOLVED", resolvedAt: asOf },
    });
  }
}

export async function excludeWatchdogFinding(
  prisma: PrismaClient,
  input: {
    companyId: string;
    findingId: string;
    actorId: string;
    code: string;
    reason: string;
  }
) {
  return prisma.billingWatchdogFinding.updateMany({
    where: { id: input.findingId, companyId: input.companyId, status: "OPEN" },
    data: {
      status: "EXCLUDED",
      excludedAt: new Date(),
      excludedById: input.actorId,
      exclusionCode: input.code,
      exclusionReason: input.reason,
      resolvedAt: new Date(),
    },
  });
}
