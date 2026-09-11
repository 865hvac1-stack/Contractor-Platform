import { prisma } from "@/lib/db";
import type { AttentionItem } from "@/lib/attention";
import { TYPE_LABELS } from "@/lib/billing-watchdog/labels";

export async function detectBillingWatchdogAttention(companyId: string): Promise<AttentionItem[]> {
  const rows = await prisma.billingWatchdogFinding.findMany({
    where: { companyId, status: "OPEN", severity: { in: ["CRITICAL", "ACTION_NEEDED"] } },
    orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }],
    take: 12,
  });
  return rows.map((row) => {
    const metadata = (row.metadata || {}) as { title?: string; subtitle?: string };
    return {
      id: `watchdog-${row.id}`,
      type: `billing_watchdog_${row.type.toLowerCase()}`,
      title: TYPE_LABELS[row.type as keyof typeof TYPE_LABELS] || "Billing Watchdog",
      description: `${metadata.title || metadata.subtitle || row.reason}`,
      severity: row.severity === "CRITICAL" ? "critical" : "warning",
      href: "/billing-watchdog",
      entityType: row.invoiceId ? "Invoice" : row.jobId ? "Job" : "BillingWatchdog",
      entityId: row.invoiceId || row.jobId || row.id,
      createdAt: row.firstDetectedAt,
      amountCents: row.amountUnknown ? null : row.amountAtRiskCents,
      customerName: metadata.title ?? null,
      recommendedAction: row.recommendedAction,
      category: "money",
    };
  });
}
