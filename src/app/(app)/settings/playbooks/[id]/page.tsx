import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { parseDefinition } from "@/lib/playbooks/engine";
import { getPlaybookMetrics } from "@/lib/playbooks/metrics";
import { formatMoney } from "@/lib/money";
import { PlaybookBuilder } from "@/components/playbooks/playbook-builder";
import { StatusBadge } from "@/components/status-badge";

export default async function PlaybookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("playbooks:view");
  const { id } = await params;
  const playbook = await prisma.playbook.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
  });
  if (!playbook) notFound();

  const version = playbook.currentVersionId
    ? await prisma.playbookVersion.findFirst({
        where: { id: playbook.currentVersionId, companyId: ctx.company.id },
      })
    : playbook.versions[0];
  if (!version) notFound();

  const metrics = await getPlaybookMetrics(ctx.company.id, playbook.id);
  const metricsLabel =
    metrics && metrics.jobs > 0
      ? `${metrics.jobs} jobs · ${metrics.completedJobs} completed · ${formatMoney(metrics.revenueCents)} paid · avg ticket ${formatMoney(metrics.averageTicketCents)}`
      : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/playbooks" className="text-sm text-[var(--muted-foreground)]">
          ← Playbooks
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
            {playbook.name}
          </h1>
          <StatusBadge status={playbook.status} />
        </div>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Version {version.versionNumber}. When this happens → do this. Editing here does not
          change jobs that already started.
        </p>
      </div>
      <PlaybookBuilder
        playbookId={playbook.id}
        name={playbook.name}
        description={playbook.description ?? ""}
        status={playbook.status}
        definition={parseDefinition(version.definition)}
        canManage={can(ctx.role, "playbooks:manage")}
        metricsLabel={metricsLabel}
      />
    </div>
  );
}
