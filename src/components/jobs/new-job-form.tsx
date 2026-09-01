"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { industries } from "@/lib/brand";
import { createJobFormAction } from "@/server/actions/job-form";
import { ServiceTypePicker, type ServiceTypeOption } from "@/components/service-type-picker";
import { CustomerJobPicker, type JobPickerCustomer } from "@/components/jobs/customer-job-picker";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type MemberOption = {
  id: string;
  label: string;
};

type PlaybookOption = {
  id: string;
  label: string;
};

export function NewJobForm({
  members,
  playbooks,
  serviceTypes,
  defaultCustomer,
  returnTo,
  canAssign = true,
  submitLabel = "Create job",
}: {
  members: MemberOption[];
  playbooks: PlaybookOption[];
  serviceTypes: ServiceTypeOption[];
  defaultCustomer?: JobPickerCustomer | null;
  returnTo?: string;
  canAssign?: boolean;
  submitLabel?: string;
}) {
  return (
    <ActionForm action={createJobFormAction} className="space-y-4">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <CustomerJobPicker defaultCustomer={defaultCustomer} />

      <ServiceTypePicker
        types={serviceTypes}
        descriptionName="description"
        descriptionLabel="Description"
        showPlaybookField
      />
      {playbooks.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No playbooks yet. Jobs still work without one.
        </p>
      ) : (
        <p className="text-xs text-[var(--muted-foreground)]">
          A service type can attach its playbook automatically. You can still choose a different playbook in Settings.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="trade">Trade</Label>
          <select id="trade" name="trade" className={selectClassName} defaultValue="">
            <option value="">Company default</option>
            {industries.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            name="priority"
            defaultValue="NORMAL"
            className={selectClassName}
          >
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="source">Source</Label>
          <Input id="source" name="source" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="customerNotes">Customer notes</Label>
          <Textarea id="customerNotes" name="customerNotes" rows={2} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="internalNotes">Internal notes</Label>
          <Textarea id="internalNotes" name="internalNotes" rows={2} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="scheduledStart">Scheduled start</Label>
          <Input id="scheduledStart" name="scheduledStart" type="datetime-local" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduledEnd">Scheduled end</Label>
          <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" />
        </div>
      </div>

      {canAssign && members.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Assignees</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="assigneeIds" value={m.id} className="rounded border" />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex justify-end pt-2">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </ActionForm>
  );
}
