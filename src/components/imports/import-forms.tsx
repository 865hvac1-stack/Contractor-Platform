"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LIVE_IMPORT_RECORD_TYPES,
  RECORD_TYPE_LABELS,
  SOURCE_LABELS,
  TARGET_FIELD_LABELS,
  TARGET_FIELDS,
  type ColumnMapping,
  type ImportRecordTypeId,
  type SampleColumn,
} from "@/lib/imports/types";
import { FOUNDATION_ENTITY_TYPES, fieldLabels, fieldsFor } from "@/lib/imports/catalog";
import {
  buildImportPreviewAction,
  cancelImportAction,
  confirmImportAction,
  continueImportAction,
  rollbackImportAction,
  saveCompanyMappingAction,
  saveImportMappingAction,
  updateRowActionAction,
  uploadImportFileAction,
  type ImportActionResult,
} from "@/server/actions/imports";

function FormError({ state }: { state: ImportActionResult | null }) {
  if (!state || state.ok) return null;
  return (
    <p className="text-sm text-rose-700" role="alert">
      {state.error}
    </p>
  );
}

export function StartImportForm({
  canImport,
  projects,
}: {
  canImport: boolean;
  projects: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(uploadImportFileAction, null);
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="recordType">What are you bringing in?</Label>
          <select
            id="recordType"
            name="recordType"
            required
            defaultValue="CUSTOMERS"
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            {LIVE_IMPORT_RECORD_TYPES.map((value) => (
              <option key={value} value={value}>
                {RECORD_TYPE_LABELS[value]}
              </option>
            ))}
            {FOUNDATION_ENTITY_TYPES.map((value) => (
              <option key={value} value={value} disabled>
                {RECORD_TYPE_LABELS[value]} — not open yet
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sourceType">Where did this file come from?</Label>
          <select
            id="sourceType"
            name="sourceType"
            defaultValue="UNKNOWN"
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted-foreground)]">
            Optional. Unknown or spreadsheet still works. This is a file import, not a live connection.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="migrationProjectId">Add to a migration</Label>
          <select
            id="migrationProjectId"
            name="migrationProjectId"
            defaultValue=""
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="">This file only</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="newMigrationName">Or start a new migration</Label>
          <Input id="newMigrationName" name="newMigrationName" placeholder="Housecall Pro, August 2026" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="file">Upload the export</Label>
        <Input id="file" name="file" type="file" accept=".csv,.xlsx,.xls,text/csv" required disabled={!canImport} />
        <p className="text-xs text-[var(--muted-foreground)]">
          CSV, XLSX, or XLS. Up to 20 MB and 25,000 rows. Nothing is written until you confirm.
        </p>
      </div>
      <FormError state={state} />
      <Button type="submit" disabled={!canImport || pending}>
        {pending ? "Reading file…" : "Analyze file"}
      </Button>
    </form>
  );
}

export function MappingForm({
  sessionId,
  recordType,
  columns,
  mapping,
}: {
  sessionId: string;
  recordType: ImportRecordTypeId;
  columns: SampleColumn[];
  mapping: ColumnMapping[];
}) {
  const [state, action, pending] = useActionState(saveImportMappingAction, null);
  const mapByHeader = new Map(mapping.map((column) => [column.sourceColumn, column]));
  const options =
    recordType === "CUSTOMERS"
      ? TARGET_FIELDS.map((field) => ({ value: field, label: TARGET_FIELD_LABELS[field] }))
      : [
          { value: "ignore", label: "Ignore this column" },
          ...fieldsFor(recordType).map((field) => ({ value: field.id, label: field.label })),
        ];
  const labels = recordType === "CUSTOMERS" ? TARGET_FIELD_LABELS : fieldLabels(recordType);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <p className="text-xs text-[var(--muted-foreground)] md:hidden">
        Column matching is easier on a larger screen, but you can still finish it here.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--cy-gray)]/70 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Your column</th>
              <th className="px-3 py-2 font-medium">Match to ContractorYou</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Example</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => {
              const mapped = mapByHeader.get(column.header);
              return (
                <tr key={column.header} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 align-top font-medium">{column.header}</td>
                  <td className="px-3 py-2 align-top">
                    <select
                      name={`map:${column.header}`}
                      defaultValue={mapped?.target ?? "ignore"}
                      className="h-9 w-full max-w-xs rounded-lg border border-[var(--border)] bg-white px-2"
                    >
                      {options.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                      {mapped && !options.some((field) => field.value === mapped.target) ? (
                        <option value={mapped.target}>{labels[mapped.target] ?? mapped.target}</option>
                      ) : null}
                    </select>
                    {mapped?.suggestedBy === "ai" ? (
                      <p className="mt-1 text-xs text-[var(--cy-orange)]">Suggested — please review</p>
                    ) : null}
                  </td>
                  <td className="hidden px-3 py-2 align-top text-[var(--muted-foreground)] sm:table-cell">
                    {column.samples[0] || "—"}
                  </td>
                  <td className="hidden px-3 py-2 align-top capitalize text-[var(--muted-foreground)] md:table-cell">
                    {mapped?.confidence === "none" ? "Unmatched" : mapped?.confidence ?? "Unmatched"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FormError state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving matches…" : "Preview records"}
        </Button>
      </div>
    </form>
  );
}

export function PreviewForm({
  sessionId,
  defaultPolicy,
  isCustomers,
}: {
  sessionId: string;
  defaultPolicy: string;
  isCustomers: boolean;
}) {
  const [state, action, pending] = useActionState(buildImportPreviewAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      {isCustomers ? (
        <div className="space-y-2">
          <Label htmlFor="duplicatePolicy">If a row looks like a customer you already have</Label>
          <select
            id="duplicatePolicy"
            name="duplicatePolicy"
            defaultValue={defaultPolicy}
            className="h-10 w-full max-w-md rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="SKIP">Skip it (safest)</option>
            <option value="CREATE_NEW">Import as a new customer anyway</option>
            <option value="UPDATE_EXACT">Update when the email or source ID matches exactly</option>
          </select>
        </div>
      ) : (
        <input type="hidden" name="duplicatePolicy" value="SKIP" />
      )}
      <FormError state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Checking rows…" : "Check for problems and matches"}
      </Button>
    </form>
  );
}

export function RowActionForm({
  sessionId,
  rowId,
  defaultAction,
}: {
  sessionId: string;
  rowId: string;
  defaultAction: string;
}) {
  const [state, action] = useActionState(updateRowActionAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="rowId" value={rowId} />
      <select
        name="action"
        defaultValue={defaultAction}
        className="h-8 rounded-md border border-[var(--border)] bg-white px-2 text-xs"
      >
        <option value="SKIP">Skip</option>
        <option value="CREATE">Import as new</option>
        <option value="UPDATE">Update existing</option>
      </select>
      <Button type="submit" variant="outline" className="h-8 text-xs">
        Save
      </Button>
      <FormError state={state} />
    </form>
  );
}

export function ConfirmImportForm({
  sessionId,
  recordLabel,
  ready,
  unmatchedCustomers,
  unmatchedProperties,
  unknownTechnicians,
  skipped,
}: {
  sessionId: string;
  recordLabel: string;
  ready: number;
  unmatchedCustomers: number;
  unmatchedProperties: number;
  unknownTechnicians: number;
  skipped: number;
}) {
  const [state, action, pending] = useActionState(confirmImportAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-[var(--cy-navy)]/20 bg-white p-5">
      <input type="hidden" name="sessionId" value={sessionId} />
      <h3 className="font-semibold text-[var(--cy-navy)]">You are about to import historical records</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>{ready.toLocaleString()} {recordLabel.toLowerCase()} ready</li>
        {unmatchedCustomers ? <li>{unmatchedCustomers} rows still need a customer match</li> : null}
        {unmatchedProperties ? <li>{unmatchedProperties} jobs do not have a service location yet</li> : null}
        {unknownTechnicians ? (
          <li>{unknownTechnicians} employee names will stay on the record without creating a login</li>
        ) : null}
        {skipped ? <li>{skipped} rows will be skipped</li> : null}
      </ul>
      <p className="text-sm text-[var(--muted-foreground)]">
        This is past work. ContractorYou will not text customers, send invoices, assign live playbooks, or charge a card.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" className="mt-1" required />
        I understand this writes historical records to my company and will not contact anyone.
      </label>
      <FormError state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Importing…" : "Confirm import"}
      </Button>
    </form>
  );
}

export function ContinueImportForm({ sessionId, remaining }: { sessionId: string; remaining: number }) {
  const [state, action, pending] = useActionState(continueImportAction, null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  useEffect(() => {
    if (remaining > 0 && !pending) {
      const timer = window.setTimeout(() => formRef.current?.requestSubmit(), 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [remaining, pending]);
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <p className="text-sm text-[var(--muted-foreground)]">
        Importing in batches so large files stay safe. {remaining} rows left.
      </p>
      <FormError state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Working…" : "Continue import"}
      </Button>
    </form>
  );
}

export function CancelImportForm({ sessionId }: { sessionId: string }) {
  const [state, action] = useActionState(cancelImportAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" variant="outline">
        Cancel this import
      </Button>
      <FormError state={state} />
    </form>
  );
}

export function RollbackForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState(rollbackImportAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-5">
      <input type="hidden" name="sessionId" value={sessionId} />
      <h3 className="font-semibold text-rose-900">Undo this import</h3>
      <p className="text-sm text-rose-900/80">
        This only removes records created by this import. It will not delete people or jobs that already had later work
        attached.
      </p>
      <Label htmlFor="confirmText">Type ROLLBACK to confirm</Label>
      <Input id="confirmText" name="confirmText" placeholder="ROLLBACK" />
      <FormError state={state} />
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Removing…" : "Remove records from this import"}
      </Button>
    </form>
  );
}

export function SaveMappingForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState(saveCompanyMappingAction, null);
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
      <input type="hidden" name="sessionId" value={sessionId} />
      <h3 className="font-semibold text-[var(--cy-navy)]">Save this mapping</h3>
      <p className="text-sm text-[var(--muted-foreground)]">
        Saves only column matches — never customer names or phone numbers — so the next file with the same headers is faster.
      </p>
      <Label htmlFor="mappingName">Name</Label>
      <Input id="mappingName" name="name" defaultValue="Our usual spreadsheet" />
      <FormError state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save mapping for future imports"}
      </Button>
    </form>
  );
}
