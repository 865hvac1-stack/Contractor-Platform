import { addHours } from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { getOpportunities } from "@/lib/intelligence/opportunities";
import { getCompanyMetrics } from "@/lib/intelligence/metrics";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";

function severityFromAttention(level: string) {
  if (level === "critical") return "CRITICAL";
  if (level === "warning") return "ATTENTION";
  return "INFO";
}

function categoryFromType(type: string) {
  if (type.includes("estimate") || type.includes("lead")) return "SALES";
  if (type.includes("invoice") || type.includes("expense")) return "MONEY";
  if (type.includes("job") || type.includes("playbook") || type.includes("technician")) return "OPERATIONS";
  if (type.includes("review") || type.includes("call")) return "FOLLOW_UP";
  return "OPERATIONS";
}

export async function refreshCompanyInsights(companyId: string) {
  const [attention, opportunities, metrics] = await Promise.all([
    getNeedsAttention(companyId),
    getOpportunities(companyId),
    getCompanyMetrics(companyId, "month"),
  ]);

  await prisma.insight.deleteMany({
    where: scopedCompanyWhere(companyId, { dataSource: "deterministic" }),
  });

  const cards: {
    insightType: string;
    category: string;
    severity: string;
    title: string;
    summary: string;
    recommendedAction: string;
    metric?: string;
    currentValue?: string;
    supportingData?: object;
  }[] = [];

  const grouped = new Map<string, typeof attention>();
  for (const item of attention) {
    const list = grouped.get(item.type) ?? [];
    list.push(item);
    grouped.set(item.type, list);
  }
  for (const [type, items] of grouped) {
    cards.push({
      insightType: type,
      category: categoryFromType(type),
      severity: severityFromAttention(items[0]?.severity ?? "info"),
      title: items[0]?.title ?? type,
      summary: `${items.length} recorded item${items.length === 1 ? "" : "s"} need a look.`,
      recommendedAction: items[0]?.href ?? "/dashboard",
      supportingData: { count: items.length, href: items[0]?.href },
    });
  }

  const highValue = opportunities.filter((o) => o.priority === "HIGH");
  if (highValue.length > 0) {
    const value = highValue.reduce((s, o) => s + (o.valueCents ?? 0), 0);
    cards.push({
      insightType: "sales_opportunity",
      category: "SALES",
      severity: "OPPORTUNITY",
      title: `${highValue.length} high-value estimate${highValue.length === 1 ? "" : "s"} need follow-up`,
      summary: "Rule-based priority: high value and still open.",
      recommendedAction: highValue[0]?.href ?? "/estimates",
      metric: "sales.estimates_open_value",
      currentValue: String(value),
      supportingData: { count: highValue.length, href: "/estimates" },
    });
  }

  const booking = metrics.metrics.find((m) => m.key === "sales.booking_rate");
  if (booking?.available && booking.value != null) {
    cards.push({
      insightType: "booking_rate",
      category: "MARKETING",
      severity: "INFO",
      title: `Booking rate ${booking.value}% this month`,
      summary: booking.definition,
      recommendedAction: "/marketing/leads",
      metric: booking.key,
      currentValue: String(booking.value),
      supportingData: { href: "/marketing/leads", definition: booking.definition },
    });
  }

  const ranked = cards
    .sort((a, b) => {
      const order = { CRITICAL: 0, ATTENTION: 1, OPPORTUNITY: 2, IMPORTANT: 3, INFO: 4 };
      return (order[a.severity as keyof typeof order] ?? 5) - (order[b.severity as keyof typeof order] ?? 5);
    })
    .slice(0, 7);

  if (ranked.length === 0) return [];

  await prisma.insight.createMany({
    data: ranked.map((card) => ({
      companyId,
      insightType: card.insightType,
      category: card.category,
      severity: card.severity,
      title: card.title,
      summary: card.summary,
      metric: card.metric ?? null,
      currentValue: card.currentValue ?? null,
      recommendedAction: card.recommendedAction,
      dataSource: "deterministic",
      metricDefinition: card.summary,
      supportingData: card.supportingData ?? undefined,
      expiresAt: addHours(new Date(), 12),
    })),
  });

  return prisma.insight.findMany({
    where: scopedCompanyWhere(companyId, { dataSource: "deterministic", resolvedAt: null }),
    orderBy: { createdAt: "desc" },
    take: 7,
  });
}
