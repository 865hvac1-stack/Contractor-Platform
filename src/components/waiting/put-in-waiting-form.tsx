"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { putJobInWaitingAction } from "@/server/actions/waiting";
import { CADENCE_LABELS } from "@/lib/waiting/defaults";
import type { WaitingCadence } from "@prisma/client";

export type WaitingColumnOption = { id: string; key: string; name: string; kind: string };
export type WaitingOwnerOption = { id: string; name: string };
export type WaitingJobOption = {
  id: string;
  jobNumber: string;
  label: string;
};

export function PutInWaitingForm({
  columns,
  owners,
  jobs,
  defaultJobId,
  defaultColumnKey,
  compact,
  onSuccess,
  onCancel,
}: {
  columns: WaitingColumnOption[];
  owners: WaitingOwnerOption[];
  jobs?: WaitingJobOption[];
  defaultJobId?: string;
  defaultColumnKey?: string;
  compact?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const initial = columns.find((column) => column.key === defaultColumnKey) ?? columns[0];
  const [columnId, setColumnId] = useState(initial?.id ?? "");
  const column = useMemo(() => columns.find((row) => row.id === columnId), [columns, columnId]);
  const key = column?.key ?? "";

  return (
    <ActionForm action={putJobInWaitingAction} className="space-y-3" onSuccess={onSuccess}>
      {defaultJobId ? (
        <input type="hidden" name="jobId" value={defaultJobId} />
      ) : (
        <Field label="Job">
          <select
            name="jobId"
            required
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="">Select a job</option>
            {(jobs ?? []).map((job) => (
              <option key={job.id} value={job.id}>
                {job.jobNumber} · {job.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Waiting status">
        <select
          name="columnId"
          value={columnId}
          onChange={(event) => setColumnId(event.target.value)}
          className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
        >
          {columns.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What are we waiting for?">
        <Input name="waitingFor" placeholder={placeholderFor(key)} />
      </Field>
      {key === "WAITING_ON_PART" || (!compact && !key) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Part / item">
            <Input name="partName" placeholder="Blower motor" />
          </Field>
          <Field label="Part number">
            <Input name="partNumber" />
          </Field>
          <Field label="Vendor / supplier">
            <Input name="vendor" />
          </Field>
          <Field label="PO / order #">
            <Input name="poNumber" />
          </Field>
          <Field label="Date ordered">
            <Input name="dateOrdered" type="date" />
          </Field>
          <Field label="Quantity">
            <Input name="quantity" inputMode="numeric" />
          </Field>
        </div>
      ) : null}
      {key === "WAITING_ON_WARRANTY" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Manufacturer / provider">
            <Input name="manufacturer" />
          </Field>
          <Field label="Claim / reference">
            <Input name="claimNumber" />
          </Field>
          <Field label="Submitted">
            <Input name="submittedAt" type="date" />
          </Field>
        </div>
      ) : null}
      {key === "WAITING_ON_APPROVAL" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Estimate / approval #">
            <Input name="estimateNumber" />
          </Field>
          <Field label="Amount if known">
            <Input name="approvalAmount" inputMode="decimal" placeholder="Only if linked" />
          </Field>
        </div>
      ) : null}
      {key === "WAITING_ON_THIRD_PARTY" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor / sub / utility">
            <Input name="thirdParty" />
          </Field>
          <Field label="Contact / reference">
            <Input name="thirdPartyReference" />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expected date">
          <Input name="expectedResolutionAt" type="date" />
        </Field>
        <Field label="Follow-up owner">
          <select
            name="assignedOwnerUserId"
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer update cadence">
          <select
            name="cadence"
            defaultValue="EVERY_3_DAYS"
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            {(Object.keys(CADENCE_LABELS) as WaitingCadence[]).map((value) => (
              <option key={value} value={value}>
                {CADENCE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer communication">
          <select
            name="communicationEnabled"
            defaultValue="yes"
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="yes">Send updates</option>
            <option value="no">Manual only — do not text</option>
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <Textarea name="notes" rows={2} placeholder="Internal only" />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" className="h-11 sm:min-w-24" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" className="h-11 bg-[var(--cy-orange)] text-white hover:bg-[var(--cy-orange)]/90 sm:min-w-40">
          Put in Waiting
        </Button>
      </div>
    </ActionForm>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[var(--muted-foreground)]">{label}</Label>
      {children}
    </div>
  );
}

function placeholderFor(key: string) {
  if (key === "WAITING_ON_PART") return "Blower motor";
  if (key === "WAITING_ON_WARRANTY") return "Manufacturer claim";
  if (key === "WAITING_ON_CUSTOMER") return "Decision, access, or payment";
  if (key === "WAITING_ON_APPROVAL") return "Estimate approval";
  if (key === "WAITING_ON_THIRD_PARTY") return "Permit, utility, or sub";
  return "What is blocking this job?";
}
