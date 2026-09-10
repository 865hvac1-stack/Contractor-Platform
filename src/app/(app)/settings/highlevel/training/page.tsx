import Link from "next/link";
import { requireAnyPermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ensureReceptionistTrainingStarter, loadTrainingDashboard } from "@/lib/intelligence/receptionist/v2/training-store";
import { TrainingCenter } from "@/components/highlevel/training-center";

export default async function ReceptionistTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireAnyPermission(["receptionist:train", "intelligence:view", "marketing:manage"]);
  const { tab } = await searchParams;
  await ensureReceptionistTrainingStarter(ctx.company.id);
  const canEdit = can(ctx.role, "receptionist:train");
  const [counts, knowledge, rules, opportunities, examples, reviews] = await Promise.all([
    loadTrainingDashboard(ctx.company.id),
    prisma.receptionistKnowledgeItem.findMany({
      where: { companyId: ctx.company.id },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.receptionistConversationRule.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { priority: "asc" },
    }),
    prisma.receptionistOpportunityRule.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { priority: "asc" },
    }),
    prisma.receptionistApprovedExample.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.receptionistTurn.findMany({
      where: {
        companyId: ctx.company.id,
        proposedResponse: { not: null },
        OR: [{ reviewStatus: null }, { reviewStatus: "PENDING" }],
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        inboundMessageId: true,
        threadId: true,
        intent: true,
        proposedResponse: true,
        requestedAction: true,
        toolUsed: true,
        confidence: true,
        schedulingState: true,
        trainingSources: true,
        createdAt: true,
      },
    }),
  ]);
  const inboundIds = reviews.map((row) => row.inboundMessageId);
  const messages = inboundIds.length
    ? await prisma.communicationMessage.findMany({
        where: { companyId: ctx.company.id, OR: [{ id: { in: inboundIds } }, { externalId: { in: inboundIds } }] },
        select: { id: true, externalId: true, body: true },
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings/highlevel" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← HighLevel
        </Link>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Settings · AI receptionist
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Training</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Teach Regina how {ctx.company.businessName} operates. She only uses what you approve. Customer
          texts never retrain her automatically.
        </p>
      </div>
      <TrainingCenter
        tab={tab || "home"}
        canEdit={canEdit}
        counts={counts}
        knowledge={knowledge}
        rules={rules}
        opportunities={opportunities}
        examples={examples}
        reviews={reviews.map((row) => ({
          ...row,
          customerMessage:
            messages.find((message) => message.id === row.inboundMessageId || message.externalId === row.inboundMessageId)?.body ??
            null,
        }))}
      />
    </div>
  );
}
