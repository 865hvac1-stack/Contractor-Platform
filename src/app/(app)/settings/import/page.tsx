import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { RECORD_TYPE_LABELS, SOURCE_LABELS } from "@/lib/imports/types";
import {
  FOUNDATION_ENTITY_TYPES,
  FOUNDATION_REASON,
  LIVE_ENTITY_TYPES,
  RECOMMENDED_ORDER,
} from "@/lib/imports/catalog";
import { StartImportForm } from "@/components/imports/import-forms";
import { WizardSteps } from "@/components/imports/wizard-steps";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function ImportDataPage() {
  const ctx = await requirePermission("imports:manage");
  const [sessions, projects, customerCount] = await Promise.all([
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
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Import data</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Moving from another system? Upload the export you already have. We match columns, connect people and jobs, and
          write history only after you confirm.
        </p>
      </div>

      <WizardSteps current={1} />

      {customerCount === 0 ? (
        <section className="rounded-2xl border border-dashed border-[var(--cy-orange)]/40 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Start with your people
          </p>
          <h2 className="mt-2 font-display text-2xl">Bring your list with you</h2>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted-foreground)]">
            Housecall Pro, ServiceTitan, Jobber, QuickBooks, or a spreadsheet you built yourself. A file import is not a
            live connection to that software.
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-semibold text-[var(--cy-navy)]">Start an import</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          File upload is supported now. Direct sync with another software only appears when that connection actually
          exists.
        </p>
        <div className="mt-5">
          <StartImportForm
            canImport={can(ctx.role, "imports:manage")}
            projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-semibold text-[var(--cy-navy)]">Recommended order</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          You can import in any order. We recommend customers first so later files can attach to the right people.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          {RECOMMENDED_ORDER.map((type) => (
            <li key={type}>{RECORD_TYPE_LABELS[type]}</li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-semibold text-[var(--cy-navy)]">What you can import today</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {LIVE_ENTITY_TYPES.map((type) => (
            <div key={type} className="rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/40 px-4 py-3">
              <p className="font-medium">{RECORD_TYPE_LABELS[type]}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--cy-orange)]">Live</p>
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
    </div>
  );
}
