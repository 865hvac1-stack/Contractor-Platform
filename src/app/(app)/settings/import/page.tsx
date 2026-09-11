import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { RECORD_TYPE_LABELS, SOURCE_LABELS } from "@/lib/imports/types";
import { FOUNDATION_ENTITY_TYPES, FOUNDATION_REASON, LIVE_ENTITY_TYPES, RECOMMENDED_ORDER } from "@/lib/imports/catalog";
import { StartImportForm } from "@/components/imports/import-forms";
import { WizardSteps } from "@/components/imports/wizard-steps";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildProvenanceCensus } from "@/lib/imports/census";
import { canManageImportReset } from "@/lib/imports/reset";
import { OWNERSHIP_COPY } from "@/lib/imports/modes";
import { HousecallResetDangerZone } from "@/components/imports/danger-zone";
import { QuickBooksHistoricalImport } from "@/components/imports/quickbooks-historical-import";
import { previewQuickBooksHistorical } from "@/lib/quickbooks/historical-import";
import { formatQboRealmEnvironment, loadQboRealmContext } from "@/lib/quickbooks/historical-reset";
import { PROVENANCE_LABELS, QUICKBOOKS_SOURCE } from "@/lib/imports/provenance";

export default async function ImportDataPage() {
  const ctx = await requirePermission("imports:manage");
  const canReset = canManageImportReset(ctx.role, ctx.user.isPlatformAdmin);
  const [sessions, projects, customerCount, census, lastReset, lastQboReset, reviewCount, qboPreview, qboRealm] = await Promise.all([
    prisma.importSession.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { migrationProject: { select: { name: true } } },
    }),
    prisma.migrationProject.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.customer.count({ where: { companyId: ctx.company.id } }),
    buildProvenanceCensus(prisma, ctx.company.id),
    prisma.importResetOperation.findFirst({
      where: { companyId: ctx.company.id, sourceSystem: "HOUSECALL_PRO" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.importResetOperation.findFirst({
      where: { companyId: ctx.company.id, sourceSystem: QUICKBOOKS_SOURCE },
      orderBy: { createdAt: "desc" },
    }),
    prisma.importReviewItem.count({ where: { companyId: ctx.company.id, status: "OPEN" } }),
    can(ctx.role, "accounting:view")
      ? previewQuickBooksHistorical(prisma, ctx.company.id).catch(() => null)
      : Promise.resolve(null),
    loadQboRealmContext(prisma, ctx.company.id),
  ]);

  const lastDryRun =
    lastReset && lastReset.mode === "DRY_RUN"
      ? {
          createdAt: lastReset.createdAt.toISOString(),
          jobs: Number((lastReset.counts as { jobs?: number } | null)?.jobs ?? 0),
          customers: Number((lastReset.counts as { customers?: number } | null)?.customers ?? 0),
          properties: Number((lastReset.counts as { properties?: number } | null)?.properties ?? 0),
          operationId: lastReset.id,
        }
      : null;

  const qboCounts = (lastQboReset?.counts as { invoices?: number; payments?: number; customers?: number } | null) ?? {};
  const lastQboDryRun =
    lastQboReset && lastQboReset.mode === "DRY_RUN"
      ? {
          createdAt: lastQboReset.createdAt.toISOString(),
          invoices: Number(qboCounts.invoices ?? 0),
          payments: Number(qboCounts.payments ?? 0),
          customers: Number(qboCounts.customers ?? 0),
          operationId: lastQboReset.id,
        }
      : null;
  const lastQboExecute =
    lastQboReset && lastQboReset.mode === "EXECUTE"
      ? {
          createdAt: lastQboReset.createdAt.toISOString(),
          invoices: Number(qboCounts.invoices ?? 0),
          payments: Number(qboCounts.payments ?? 0),
          customers: Number(qboCounts.customers ?? 0),
          operationId: lastQboReset.id,
          executed: !lastQboReset.idempotentReplay,
        }
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Data & Imports</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          ContractorYou owns live operations. QuickBooks owns accounting history. Housecall Pro is historical service
          only. Every import scans, matches, and previews before it writes.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <SourceCard title="ContractorYou" body={OWNERSHIP_COPY.CONTRACTORYOU} />
        <SourceCard title="QuickBooks" body={OWNERSHIP_COPY.QUICKBOOKS} />
        <SourceCard title="Housecall Pro" body={OWNERSHIP_COPY.HOUSECALL_PRO} />
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-semibold text-[var(--cy-navy)]">Import health</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Health label="Canonical / live customers" value={census.customers.NATIVE_LIVE} />
          <Health label="Housecall Pro customers" value={census.customers.HOUSECALL_PRO} />
          <Health label="QuickBooks customers" value={census.customers.QUICKBOOKS} />
          <Health label="Unmatched identities" value={reviewCount} />
          <Health label="Historical jobs" value={census.jobs.HOUSECALL_PRO + census.jobs.QUICKBOOKS + census.jobs.OTHER_IMPORT} />
          <Health label="Live jobs" value={census.jobs.NATIVE_LIVE} />
          <Health label={PROVENANCE_LABELS.UNKNOWN} value={census.customers.UNKNOWN + census.jobs.UNKNOWN} />
        </dl>
      </section>

      {can(ctx.role, "accounting:view") ? (
        <QuickBooksHistoricalImport
          preview={qboPreview}
          canReset={canReset}
          realm={{
            companyName: qboRealm.companyName,
            realmId: qboRealm.realmId,
            environmentLabel: formatQboRealmEnvironment(qboRealm.environment),
            connectionStatus: qboRealm.connectionStatus,
          }}
          lastDryRun={lastQboDryRun}
          lastExecute={lastQboExecute}
        />
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Housecall Pro</p>
        <h2 className="mt-2 font-semibold text-[var(--cy-navy)]">Historical service history</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Upload an export, scan columns, match to canonical customers, then preview. Historical jobs will not enter
          Dispatch, Ready to Invoice, or Billing Watchdog. Name-only matches go to the review queue.
        </p>
        <div className="mt-5">
          <StartImportForm
            canImport={can(ctx.role, "imports:manage")}
            projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          />
        </div>
        <WizardSteps current={1} />
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Recommended order: existing ContractorYou records → QuickBooks identities → Housecall Pro service history.
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
          {RECOMMENDED_ORDER.map((type) => (
            <li key={type}>{RECORD_TYPE_LABELS[type]}</li>
          ))}
        </ol>
      </section>

      {customerCount === 0 ? (
        <section className="rounded-2xl border border-dashed border-[var(--cy-orange)]/40 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Start with your people
          </p>
          <h2 className="mt-2 font-display text-2xl">Bring your list with you</h2>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted-foreground)]">
            Housecall Pro, ServiceTitan, Jobber, QuickBooks, or a spreadsheet. A file import is not a live connection.
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-semibold text-[var(--cy-navy)]">What you can import today</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {LIVE_ENTITY_TYPES.map((type) => (
            <div key={type} className="rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/40 px-4 py-3">
              <p className="font-medium">{RECORD_TYPE_LABELS[type]}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--cy-orange)]">Historical unless created in ContractorYou</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-[var(--cy-navy)]">Foundation ready</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          These types are recognized by the importer, but ContractorYou does not yet have a production record for them.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {FOUNDATION_ENTITY_TYPES.filter((type) => type !== "OTHER").map((type) => (
            <div key={type} className="rounded-xl border border-dashed border-[var(--border)] bg-white px-4 py-3">
              <p className="font-medium">{RECORD_TYPE_LABELS[type]}</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{FOUNDATION_REASON[type]}</p>
            </div>
          ))}
        </div>
      </section>

      {projects.length ? (
        <section className="space-y-3">
          <h2 className="font-semibold text-[var(--cy-navy)]">Migrations</h2>
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            {projects.map((project) => (
              <li key={project.id} className="px-4 py-3">
                <p className="font-medium">{project.name}</p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Started {project.createdAt.toLocaleDateString()} · {SOURCE_LABELS[project.sourceType]}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-semibold text-[var(--cy-navy)]">Import history</h2>
        {sessions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-6 text-sm text-[var(--muted-foreground)]">
            No imports yet. Upload a spreadsheet to get started.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <ul className="divide-y divide-[var(--border)]">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {RECORD_TYPE_LABELS[session.recordType]} · Imported from {SOURCE_LABELS[session.sourceType]}
                    </p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {session.rowCount.toLocaleString()} rows · {session.fileName} ·{" "}
                      {session.createdAt.toLocaleDateString()}
                      {session.migrationProject ? ` · ${session.migrationProject.name}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={session.status} />
                    <Link
                      href={`/settings/import/${session.id}`}
                      className={cn(buttonVariants({ variant: "outline" }), "h-8")}
                    >
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {canReset ? (
        <div className="space-y-4">
          {lastQboReset ? (
            <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
              <h2 className="font-semibold text-[var(--cy-navy)]">
                Last QuickBooks historical reset {lastQboReset.mode === "DRY_RUN" ? "dry run" : "execution"}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {lastQboReset.createdAt.toLocaleString()} · Operation {lastQboReset.id} ·{" "}
                {lastQboReset.idempotentReplay ? "Idempotent — nothing left to remove" : lastQboReset.status}
              </p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries((lastQboReset.counts as Record<string, number>) || {}).map(([key, value]) => (
                  <Health key={key} label={key} value={Number(value) || 0} />
                ))}
              </dl>
            </section>
          ) : null}
          {lastReset ? (
            <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
              <h2 className="font-semibold text-[var(--cy-navy)]">
                Last Housecall Pro reset {lastReset.mode === "DRY_RUN" ? "dry run" : "execution"}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {lastReset.createdAt.toLocaleString()} · Operation {lastReset.id} ·{" "}
                {lastReset.idempotentReplay ? "Idempotent — nothing left to remove" : lastReset.status}
              </p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries((lastReset.counts as Record<string, number>) || {}).map(([key, value]) => (
                  <Health key={key} label={key} value={Number(value) || 0} />
                ))}
              </dl>
            </section>
          ) : null}
          <HousecallResetDangerZone lastDryRun={lastDryRun} />
        </div>
      ) : null}
    </div>
  );
}

function SourceCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <h2 className="font-semibold text-[var(--cy-navy)]">{title}</h2>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{body}</p>
    </article>
  );
}

function Health({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--cy-gray)]/50 px-3 py-2">
      <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-lg font-semibold text-[var(--cy-navy)]">{value.toLocaleString()}</dd>
    </div>
  );
}
