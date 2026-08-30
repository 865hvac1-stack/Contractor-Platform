import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { FileAnalysis, ImportMapping, PreviewSummary, RowIssue } from "@/lib/imports/types";
import { RECORD_TYPE_LABELS, SOURCE_LABELS } from "@/lib/imports/types";
import { WizardSteps } from "@/components/imports/wizard-steps";
import {
  CancelImportForm,
  ConfirmImportForm,
  ContinueImportForm,
  MappingForm,
  PreviewForm,
  RollbackForm,
  RowActionForm,
} from "@/components/imports/import-forms";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function stepForStatus(status: string, hasPreview: boolean): number {
  if (status === "MAPPING_REQUIRED" || status === "UPLOADED" || status === "ANALYZING") return 5;
  if (status === "READY_FOR_PREVIEW") return 6;
  if (status === "READY_TO_IMPORT") return hasPreview ? 8 : 6;
  if (status === "IMPORTING") return 8;
  if (status === "COMPLETED" || status === "PARTIAL") return 9;
  return 4;
}

export default async function ImportSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("imports:manage");
  const { id } = await params;
  const session = await prisma.importSession.findFirst({
    where: { id, companyId: ctx.company.id },
  });
  if (!session) notFound();

  const analysis = session.analysis as FileAnalysis | null;
  const mapping = session.mapping as ImportMapping | null;
  const preview = session.previewSummary as PreviewSummary | null;
  const remaining = Math.max(0, session.rowCount - session.processedRows);
  const reviewRows = await prisma.importRow.findMany({
    where: {
      companyId: ctx.company.id,
      importSessionId: session.id,
      OR: [
        { status: { in: ["ERROR", "WARNING"] } },
        { duplicateVerdict: { in: ["EXACT_MATCH", "LIKELY_DUPLICATE", "NEEDS_REVIEW"] } },
      ],
    },
    orderBy: { rowNumber: "asc" },
    take: 80,
  });
  const sampleReady = await prisma.importRow.findMany({
    where: { companyId: ctx.company.id, importSessionId: session.id, action: { in: ["CREATE", "UPDATE"] } },
    orderBy: { rowNumber: "asc" },
    take: 8,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link href="/settings/import" className="text-sm text-[var(--muted-foreground)]">
          ← Import data
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-tight">
              {RECORD_TYPE_LABELS[session.recordType]} import
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {session.fileName} · {SOURCE_LABELS[session.sourceType]} · {session.rowCount.toLocaleString()} rows
            </p>
          </div>
          <StatusBadge status={session.status} />
        </div>
      </div>

      <WizardSteps current={stepForStatus(session.status, Boolean(preview))} />

      {analysis ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">What we found</h2>
          <p className="mt-2 text-sm">{analysis.message}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--muted-foreground)]">Columns</dt>
              <dd className="font-medium">{analysis.headers.length}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Rows</dt>
              <dd className="font-medium">{analysis.rowCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">File type</dt>
              <dd className="font-medium uppercase">{analysis.fileKind}</dd>
            </div>
          </dl>
          {analysis.blankHeaders.length ? (
            <p className="mt-3 text-sm text-amber-800">
              {analysis.blankHeaders.length} columns had no useful name. You can ignore them.
            </p>
          ) : null}
        </section>
      ) : null}

      {mapping && analysis && ["MAPPING_REQUIRED", "READY_FOR_PREVIEW", "READY_TO_IMPORT"].includes(session.status) ? (
        <section className="space-y-3">
          <div>
            <h2 className="font-semibold text-[var(--cy-navy)]">Tell us which column is which</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {mapping.columns.filter((column) => column.target === "ignore").length
                ? `We could not match ${mapping.columns.filter((column) => column.target === "ignore").length} columns. You can choose where they belong, or ignore them.`
                : "Review these matches before we preview the records."}
            </p>
          </div>
          <MappingForm sessionId={session.id} columns={analysis.columns} mapping={mapping.columns} />
        </section>
      ) : null}

      {session.status === "READY_FOR_PREVIEW" || session.status === "READY_TO_IMPORT" ? (
        <PreviewForm sessionId={session.id} defaultPolicy={session.duplicatePolicy} />
      ) : null}

      {preview ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Preview</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Total rows" value={preview.totalRows} />
            <Stat label="Ready" value={preview.ready} />
            <Stat label="Warnings" value={preview.warnings} />
            <Stat label="Errors" value={preview.errors} />
            <Stat label="Duplicates" value={preview.duplicates} />
            <Stat label="New customers" value={preview.newCustomers} />
            <Stat label="Existing" value={preview.existingCustomers} />
            <Stat label="Locations" value={preview.properties} />
          </div>
          {sampleReady.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Phone</th>
                    <th className="hidden py-2 pr-3 sm:table-cell">Email</th>
                    <th className="hidden py-2 md:table-cell">Locations</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleReady.map((row) => {
                    const mapped = row.mappedData as {
                      firstName?: string;
                      lastName?: string;
                      businessName?: string | null;
                      phone?: string | null;
                      email?: string | null;
                      properties?: unknown[];
                    } | null;
                    return (
                      <tr key={row.id} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3">
                          {mapped?.businessName || `${mapped?.firstName ?? ""} ${mapped?.lastName ?? ""}`.trim() || "—"}
                        </td>
                        <td className="py-2 pr-3">{mapped?.phone || "—"}</td>
                        <td className="hidden py-2 pr-3 sm:table-cell">{mapped?.email || "—"}</td>
                        <td className="hidden py-2 md:table-cell">{mapped?.properties?.length ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {reviewRows.length && preview ? (
        <section className="space-y-3">
          <h2 className="font-semibold text-[var(--cy-navy)]">Rows that need a look</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Errors should be skipped. Warnings can still import. We will not merge anyone unless you choose update.
          </p>
          <div className="space-y-3">
            {reviewRows.map((row) => {
              const issues = (row.issues as RowIssue[] | null) ?? [];
              return (
                <div key={row.id} className="rounded-xl border border-[var(--border)] bg-white p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">Row {row.rowNumber}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {issues[0]?.message || row.duplicateVerdict.replaceAll("_", " ").toLowerCase()}
                      </p>
                    </div>
                    <RowActionForm sessionId={session.id} rowId={row.id} defaultAction={row.action} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {session.status === "READY_TO_IMPORT" && preview ? (
        <ConfirmImportForm
          sessionId={session.id}
          customers={preview.newCustomers + preview.existingCustomers}
          properties={preview.properties}
          tags={preview.tags}
          skipped={preview.skippedByPolicy}
        />
      ) : null}

      {session.status === "IMPORTING" || (session.status === "PARTIAL" && remaining > 0 && session.confirmedAt) ? (
        <ContinueImportForm sessionId={session.id} remaining={remaining} />
      ) : null}

      {["COMPLETED", "PARTIAL"].includes(session.status) ? (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Import results</h2>
          {session.intelligence ? <p className="text-sm">{session.intelligence}</p> : null}
          {session.importSummary ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {Object.entries(session.importSummary as Record<string, number>).map(([key, value]) => (
                <div key={key}>
                  <dt className="capitalize text-[var(--muted-foreground)]">{key.replace(/[A-Z]/g, " $&")}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link href="/customers" className={cn(buttonVariants(), "h-9")}>
              View imported customers
            </Link>
            <Link
              href={`/settings/import/${session.id}/report`}
              className={cn(buttonVariants({ variant: "outline" }), "h-9")}
            >
              Download error and skip report
            </Link>
            <Link href="/settings/import" className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
              Start another import
            </Link>
          </div>
          {can(ctx.role, "imports:manage") && ctx.role === "COMPANY_OWNER" ? (
            <RollbackForm sessionId={session.id} />
          ) : null}
        </section>
      ) : null}

      {!["COMPLETED", "IMPORTING", "CANCELLED"].includes(session.status) ? (
        <CancelImportForm sessionId={session.id} />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--cy-gray)] px-3 py-3">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="text-xl font-semibold text-[var(--cy-navy)]">{value.toLocaleString()}</p>
    </div>
  );
}
