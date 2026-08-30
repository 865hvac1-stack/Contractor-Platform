import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { formatMoney } from "@/lib/money";

export type PulseItem = {
  id: string;
  category: "Sales" | "Marketing" | "Money" | "Operations" | "Reputation";
  title: string;
  summary: string;
  href: string;
};

/**
 * Command Center pulse: 3–7 items from verified company data only.
 * Never fabricate channel performance or AI conclusions.
 */
export async function getBusinessPulse(companyId: string): Promise<PulseItem[]> {
  const items: PulseItem[] = [];
  const attention = await getNeedsAttention(companyId);

  const unanswered = await prisma.lead.count({
    where: {
      companyId,
      firstRespondedAt: null,
      status: { in: ["NEW", "CONTACTED"] },
    },
  });
  if (unanswered > 0) {
    items.push({
      id: "unanswered-leads",
      category: "Marketing",
      title: `${unanswered} unanswered lead${unanswered === 1 ? "" : "s"}`,
      summary: "No first response recorded yet.",
      href: "/marketing/leads?status=NEW",
    });
  }

  const openLeads = await prisma.lead.count({
    where: {
      companyId,
      status: { in: ["NEW", "CONTACTED", "BOOKED", "ESTIMATE_SCHEDULED", "ESTIMATE_SENT"] },
    },
  });
  if (openLeads > 0) {
    items.push({
      id: "open-leads",
      category: "Marketing",
      title: `${openLeads} open opportunit${openLeads === 1 ? "y" : "ies"}`,
      summary: "Leads still in the pipeline.",
      href: "/marketing/leads",
    });
  }

  const estimateFollowUps = attention.filter((a) => a.type === "estimate_not_followed_up");
  if (estimateFollowUps.length > 0) {
    items.push({
      id: "estimate-follow-up",
      category: "Sales",
      title: `${estimateFollowUps.length} estimate${estimateFollowUps.length === 1 ? "" : "s"} need follow-up`,
      summary: "Open estimates with no recent activity.",
      href: "/estimates",
    });
  }

  const overdue = attention.filter((a) => a.type === "invoice_overdue");
  if (overdue.length > 0) {
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
        dueDate: { lt: new Date() },
      },
      select: { balanceCents: true },
    });
    const cents = overdueInvoices.reduce((s, i) => s + i.balanceCents, 0);
    items.push({
      id: "overdue",
      category: "Money",
      title: `${formatMoney(cents)} overdue`,
      summary: `${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? "" : "s"} past due.`,
      href: "/invoices",
    });
  }

  const jobsToday = attention.filter(
    (a) => a.type === "job_missing_completion" || a.type === "job_missing_invoice"
  );
  if (jobsToday.length > 0) {
    items.push({
      id: "ops-attention",
      category: "Operations",
      title: `${jobsToday.length} job${jobsToday.length === 1 ? "" : "s"} need attention`,
      summary: "On hold, dispatched, or in progress.",
      href: "/jobs",
    });
  }

  const needsResponse = await prisma.review.count({
    where: { companyId, needsResponse: true },
  });
  if (needsResponse > 0) {
    items.push({
      id: "reviews-response",
      category: "Reputation",
      title: `${needsResponse} review${needsResponse === 1 ? "" : "s"} need a response`,
      summary: "Imported reviews waiting on a reply.",
      href: "/marketing/reviews",
    });
  }

  return items.slice(0, 7);
}

export async function getDailyOwnerBrief(companyId: string, firstName: string) {
  const pulse = await getBusinessPulse(companyId);
  const jobsToday = await prisma.job.count({
    where: {
      companyId,
      status: { not: "CANCELED" },
      scheduledStart: {
        gte: new Date(new Date().setHours(0, 0, 0, 0)),
        lte: new Date(new Date().setHours(23, 59, 59, 999)),
      },
    },
  });

  return {
    greeting: `Good morning, ${firstName}.`,
    jobsToday,
    pulse,
    recommendedAction: pulse[0] ?? null,
    disclaimer:
      "This brief uses recorded ContractorYou data only. Channel performance appears after a provider is connected and synced.",
  };
}
