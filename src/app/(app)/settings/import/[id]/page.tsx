import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { FileAnalysis, ImportMapping, PreviewSummary, RowAccounting, RowIssue } from "@/lib/imports/types";
import { RECORD_TYPE_LABELS, SOURCE_LABELS } from "@/lib/imports/types";
import { accountedTotal } from "@/lib/imports/quality";
import type { QualityScore } from "@/lib/imports/quality";
import { WizardSteps } from "@/components/imports/wizard-steps";
import {
  CancelImportForm,
  ConfirmImportForm,
  ContinueImportForm,
  MappingForm,
  PreviewForm,
  RollbackForm,
  RowActionForm,
  SaveMappingForm,
} from "@/components/imports/import-forms";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const maxDuration = 120;

function stepForStatus(status: string, hasPreview: boolean): number {
  if (status === "MAPPING_REQUIRED" || status === "UPLOADED" || status === "ANALYZING") return 5;
  if (status === "READY_FOR_PREVIEW") return 6;
  if (status === "READY_TO_IMPORT") return hasPreview ? 8 : 6;
  if (status === "IMPORTING") return 8;
  if (status === "COMPLETED" || status === "PARTIAL") return 9;
  return 4;
}

function sampleLabel(mapped: Record<string, unknown> | null): string {
  if (!mapped) return "—";
  const values = mapped.values as Record<string, string> | undefined;
  if (values) {
    return (
      values.customerName ||
      values.equipmentName ||
      values.documentNumber ||
      values.jobNumber ||
      values.expenseVendor ||
      values.notes ||
      "—"
    );
  }
  return (
    (mapped.businessName as string) ||
    `${mapped.firstName ?? ""} ${mapped.lastName ?? ""}`.trim() ||
    "—"
  );
}

export default async function ImportSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("imports:manage");
  const { id } = await params;
  const session = await prisma.importSession.findFirst({
    where: { id, companyId: ctx.company.id },
    include: { migrationProject: { select: { name: true } } },
  });
  if (!session) notFound();

  const analysis = session.analysis as FileAnalysis | null;
  const mapping = session.mapping as ImportMapping | null;
  const preview = session.previewSummary as PreviewSummary | null;
  const accounting = (session.rowAccounting as RowAccounting | null) ?? preview?.accounting ?? null;
  const quality = session.qualityScore as QualityScore | null;
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
  const warningRows = reviewRows.filter((row) => {
    const issues = (row.issues as RowIssue[] | null) ?? [];
    return row.status === "WARNING" || issues.some((issue) => issue.level === "WARNING");
  });
  const sampleReady = await prisma.importRow.findMany({
    where: { companyId: ctx.company.id, importSessionId: session.id, action: { in: ["CREATE", "UPDATE", "MERGE"] } },
    orderBy: { rowNumber: "asc" },
    take: 8,
  });
  const sourceLabel = SOURCE_LABELS[session.sourceType];
  const recordLabel = RECORD_TYPE_LABELS[session.recordType];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link href="/settings/import" className="text-sm text-[var(--muted-foreground)]">
          ← Import data
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-tight">{recordLabel} import</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {session.fileName} · Imported from {sourceLabel} · {session.rowCount.toLocaleString()} rows
              {session.migrationProject ? ` · ${session.migrationProject.name}` : ""}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              This is a file import, not a live connection to {sourceLabel}.
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
          {session.detectedRecordType && session.detectedRecordType !== session.recordType ? (
            <p className="mt-3 text-sm text-amber-800">
              This looked like {RECORD_TYPE_LABELS[session.detectedRecordType].toLowerCase()}. You chose{" "}
              {recordLabel.toLowerCase()}, and we will follow your choice.
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
          <MappingForm
            sessionId={session.id}
            recordType={session.recordType}
            columns={analysis.columns}
            mapping={mapping.columns}
          />
          <SaveMappingForm sessionId={session.id} />
        </section>
      ) : null}

      {["READY_FOR_PREVIEW", "READY_TO_IMPORT", "FAILED"].includes(session.status) ? (
        <PreviewForm
          sessionId={session.id}
          defaultPolicy={session.duplicatePolicy}
          isCustomers={session.recordType === "CUSTOMERS"}
        />
      ) : null}

      {preview ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Pre-flight check</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Source rows" value={preview.totalRows} />
            <Stat label="Ready" value={preview.ready} />
            <a href="#import-warnings" className="rounded-xl bg-[var(--cy-gray)] px-3 py-3 no-underline">
              <p className="text-xs text-[var(--muted-foreground)]">Warnings</p>
              <p className="text-xl font-semibold text-[var(--cy-navy)]">{preview.warnings.toLocaleString()}</p>
            </a>
            <Stat label="Errors" value={preview.errors} />
            <Stat label="Duplicates" value={preview.duplicates} />
            <Stat label="New records" value={preview.newCustomers || preview.ready} />
            <Stat label="Need a customer" value={preview.unmatchedCustomers ?? 0} />
            <Stat label="Unknown employees" value={preview.unknownTechnicians ?? 0} />
          </div>
          {preview.unmatchedCustomers ? (
            <p className="mt-4 text-sm text-amber-800">
              We recommend importing customers first so we can attach these {recordLabel.toLowerCase()} to the correct
              people. {preview.unmatchedCustomers} rows do not have a customer match yet.
            </p>
          ) : null}
          {sampleReady.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3">Row</th>
                    <th className="py-2 pr-3">Looks like</th>
                    <th className="hidden py-2 pr-3 sm:table-cell">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleReady.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-3">{row.rowNumber}</td>
                      <td className="py-2 pr-3">{sampleLabel(row.mappedData as Record<string, unknown> | null)}</td>
                      <td className="hidden py-2 pr-3 capitalize sm:table-cell">{row.action.toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {accounting ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Every source row</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {accounting.sourceRows.toLocaleString()} source rows must equal created + updated + merged + duplicate +
            skipped + warning-imported + error + other.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Created" value={accounting.created} />
            <Stat label="Updated" value={accounting.updated} />
            <Stat label="Merged into same record" value={accounting.merged} />
            <Stat label="Duplicates" value={accounting.duplicates} />
            <Stat label="Skipped" value={accounting.skipped} />
            <Stat label="Imported with warning" value={accounting.warningImported} />
            <Stat label="Errors" value={accounting.errors} />
            <Stat label="Other explained" value={accounting.other} />
          </div>
          <p className="mt-3 text-sm">
            Accounted: {accountedTotal(accounting).toLocaleString()} / {accounting.sourceRows.toLocaleString()}
            {accountedTotal(accounting) === accounting.sourceRows ? " — every row has an outcome." : " — review the leftover rows."}
          </p>
        </section>
      ) : null}

      {quality ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Data quality</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Rows accounted" value={quality.rowsAccountedPct} suffix="%" />
            <Stat label="Ready" value={quality.readyPct} suffix="%" />
            <Stat label="Customer match" value={quality.customerMatchPct ?? 0} suffix="%" />
            <Stat label="Location match" value={quality.propertyMatchPct ?? 0} suffix="%" />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
            {quality.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section id="import-warnings" className="space-y-3">
        <h2 className="font-semibold text-[var(--cy-navy)]">
          {warningRows.length ? `${warningRows.length} warnings` : "Warnings"}
        </h2>
        {reviewRows.length && preview ? (
          <>
            <p className="text-sm text-[var(--muted-foreground)]">
              Errors should be skipped. Warnings can still import. We will not guess a customer or employee match.
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
                        {issues.length > 1 ? (
                          <ul className="mt-1 list-disc pl-5 text-xs text-[var(--muted-foreground)]">
                            {issues.slice(1).map((issue) => (
                              <li key={issue.code}>{issue.message}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <RowActionForm sessionId={session.id} rowId={row.id} defaultAction={row.action} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">Preview the file to inspect warnings row by row.</p>
        )}
      </section>

      {session.status === "READY_TO_IMPORT" && preview ? (
        <ConfirmImportForm
          sessionId={session.id}
          recordLabel={recordLabel}
          ready={preview.ready}
          unmatchedCustomers={preview.unmatchedCustomers ?? 0}
          unmatchedProperties={preview.unmatchedProperties ?? 0}
          unknownTechnicians={preview.unknownTechnicians ?? 0}
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
              {Object.entries(session.importSummary as Record<string, unknown>)
                .filter(([, value]) => typeof value === "number")
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="capitalize text-[var(--muted-foreground)]">{key.replace(/[A-Z]/g, " $&")}</dt>
                    <dd className="font-medium">{Number(value).toLocaleString()}</dd>
                  </div>
                ))}
            </dl>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link href="/customers" className={cn(buttonVariants(), "h-9")}>
              View customers
            </Link>
            <Link
              href={`/settings/import/${session.id}/report`}
              className={cn(buttonVariants({ variant: "outline" }), "h-9")}
            >
              Download row report
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

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-xl bg-[var(--cy-gray)] px-3 py-3">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="text-xl font-semibold text-[var(--cy-navy)]">
        {value.toLocaleString()}
        {suffix ?? ""}
      </p>
    </div>
  );
}
